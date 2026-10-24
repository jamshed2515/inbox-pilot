import { Pool } from 'pg';
import { env } from './env';

export interface EmailSenderRecord {
  id: string;
  user_id?: string | null;
  name: string;
  email: string;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_user?: string | null;
  smtp_pass?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailRecord {
  id: string;
  user_id?: string | null;
  job_id: string;
  sender_id?: string | null;
  recipient: string;
  subject: string;
  body: string;
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';
  scheduled_at: string;
  sent_at: string | null;
  error_message: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlackIntegrationRecord {
  id: string;
  user_id?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  access_token?: string | null;
  bot_user_id?: string | null;
  channel_id?: string | null;
  channel_name?: string | null;
  incoming_webhook_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRecord {
  id: string;
  google_id?: string | null;
  email: string;
  name: string;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

// Determine if connecting to a remote/cloud PostgreSQL instance (e.g. Render, Supabase, Neon)
const isCloudDatabase = Boolean(
  (env.DATABASE_URL &&
    !env.DATABASE_URL.includes('localhost') &&
    !env.DATABASE_URL.includes('127.0.0.1')) ||
  env.NODE_ENV === 'production'
);

// PostgreSQL Connection Pool Configuration
export const pgPool = env.DATABASE_URL && !env.DATABASE_URL.includes('localhost:5433')
  ? new Pool({
      connectionString: env.DATABASE_URL,
      ssl: isCloudDatabase ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : new Pool({
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
      ssl: false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

pgPool.on('error', (err) => {
  console.error('⚠️ [PostgreSQL Pool] Unexpected error on idle client:', err.message);
});

/**
 * Initializes the PostgreSQL database connection and verifies/creates the table schema.
 * Performs idempotent migrations adding user_id ownership columns and indexes.
 */
export const initDb = async (): Promise<void> => {
  let client;
  try {
    client = await pgPool.connect();

    // 1. Create users table first for foreign key references
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        google_id VARCHAR(128) UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // 2. Create email_senders table with user_id
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_senders (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        smtp_host VARCHAR(255),
        smtp_port INTEGER,
        smtp_user VARCHAR(255),
        smtp_pass VARCHAR(255),
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_senders_email ON email_senders(email);
    `);

    // Idempotent migration for email_senders
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='email_senders' AND column_name='user_id'
        ) THEN
          ALTER TABLE email_senders ADD COLUMN user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_name = 'email_senders' AND constraint_type = 'UNIQUE' AND constraint_name = 'email_senders_email_key'
        ) THEN
          ALTER TABLE email_senders DROP CONSTRAINT email_senders_email_key;
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_senders_user_id ON email_senders(user_id);
    `);

    // 3. Create emails table with user_id
    await client.query(`
      CREATE TABLE IF NOT EXISTS emails (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
        job_id VARCHAR(64),
        sender_id VARCHAR(64) REFERENCES email_senders(id) ON DELETE SET NULL,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
        scheduled_at TIMESTAMPTZ NOT NULL,
        sent_at TIMESTAMPTZ,
        error_message TEXT,
        preview_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
      CREATE INDEX IF NOT EXISTS idx_emails_scheduled_at ON emails(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC);
    `);

    // Idempotent migration for emails
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='emails' AND column_name='user_id'
        ) THEN
          ALTER TABLE emails ADD COLUMN user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='emails' AND column_name='sender_id'
        ) THEN
          ALTER TABLE emails ADD COLUMN sender_id VARCHAR(64) REFERENCES email_senders(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='emails' AND column_name='preview_url'
        ) THEN
          ALTER TABLE emails ADD COLUMN preview_url TEXT;
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
      CREATE INDEX IF NOT EXISTS idx_emails_user_status ON emails(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_emails_sender_id ON emails(sender_id);
    `);

    // 4. Create slack_integrations table with user_id
    await client.query(`
      CREATE TABLE IF NOT EXISTS slack_integrations (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
        team_id VARCHAR(64),
        team_name VARCHAR(255),
        access_token TEXT,
        bot_user_id VARCHAR(64),
        channel_id VARCHAR(64),
        channel_name VARCHAR(255),
        incoming_webhook_url TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_slack_active ON slack_integrations(is_active);
    `);

    // Idempotent migration for slack_integrations
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='slack_integrations' AND column_name='user_id'
        ) THEN
          ALTER TABLE slack_integrations ADD COLUMN user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_slack_user_id ON slack_integrations(user_id);
    `);

    console.log('📦 PostgreSQL database connected and multi-tenant schema verified.');
  } catch (error: any) {
    console.error('================================================================');
    console.error('❌ FATAL: PostgreSQL database connection failed!');
    console.error(`Reason: ${error.message}`);
    console.error('PostgreSQL is required as the persistent relational database.');
    console.error(`Target: postgresql://${env.POSTGRES_USER}:***@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`);
    console.error('Please verify your PostgreSQL service is running and .env credentials are correct.');
    console.error('================================================================');
    throw new Error(`PostgreSQL is required but unavailable: ${error.message}`);
  } finally {
    if (client) {
      client.release();
    }
  }
};

export const db = {
  isPostgres(): boolean {
    return true;
  },

  async insertEmail(email: EmailRecord): Promise<EmailRecord> {
    const query = `
      INSERT INTO emails (
        id, user_id, job_id, sender_id, recipient, subject, body, status, 
        scheduled_at, sent_at, error_message, preview_url, 
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;
    const values = [
      email.id,
      email.user_id || null,
      email.job_id,
      email.sender_id || null,
      email.recipient,
      email.subject,
      email.body,
      email.status,
      email.scheduled_at,
      email.sent_at,
      email.error_message,
      email.preview_url,
      email.created_at,
      email.updated_at,
    ];
    const res = await pgPool.query(query, values);
    return res.rows[0];
  },

  // Senders operations (Strictly scoped to user_id)
  async createSender(sender: EmailSenderRecord): Promise<EmailSenderRecord> {
    const query = `
      INSERT INTO email_senders (
        id, user_id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass, is_default, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;
    const values = [
      sender.id,
      sender.user_id || null,
      sender.name,
      sender.email,
      sender.smtp_host || null,
      sender.smtp_port || null,
      sender.smtp_user || null,
      sender.smtp_pass || null,
      sender.is_default || false,
      sender.created_at,
      sender.updated_at,
    ];
    const res = await pgPool.query(query, values);
    return res.rows[0];
  },

  async getSenders(userId?: string): Promise<EmailSenderRecord[]> {
    if (userId) {
      const res = await pgPool.query(
        'SELECT * FROM email_senders WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC',
        [userId]
      );
      return res.rows;
    }
    const res = await pgPool.query(
      'SELECT * FROM email_senders ORDER BY is_default DESC, created_at ASC'
    );
    return res.rows;
  },

  async getSenderById(id: string, userId?: string): Promise<EmailSenderRecord | null> {
    if (userId) {
      const res = await pgPool.query(
        'SELECT * FROM email_senders WHERE id = $1 AND user_id = $2 LIMIT 1',
        [id, userId]
      );
      return res.rows[0] || null;
    }
    const res = await pgPool.query('SELECT * FROM email_senders WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  },

  async getDefaultSender(userId: string): Promise<EmailSenderRecord | null> {
    const res = await pgPool.query(
      'SELECT * FROM email_senders WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
      [userId]
    );
    return res.rows[0] || null;
  },

  async deleteSender(id: string, userId: string): Promise<boolean> {
    const res = await pgPool.query('DELETE FROM email_senders WHERE id = $1 AND user_id = $2', [id, userId]);
    return (res.rowCount ?? 0) > 0;
  },

  async updateEmail(
    id: string,
    updates: Partial<Omit<EmailRecord, 'id'>>,
    userId?: string
  ): Promise<EmailRecord | null> {
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return this.getEmailById(id, userId);
    }

    const updatedAt = new Date().toISOString();
    const setClauses = fields.map((f, idx) => `"${f}" = $${idx + 2}`).join(', ');
    const values: any[] = [id, ...Object.values(updates), updatedAt];

    let query = `
      UPDATE emails
      SET ${setClauses}, updated_at = $${fields.length + 2}
      WHERE id = $1
    `;
    if (userId) {
      values.push(userId);
      query += ` AND user_id = $${values.length}`;
    }
    query += ' RETURNING *;';

    const res = await pgPool.query(query, values);
    return res.rows[0] || null;
  },

  async getEmailById(id: string, userId?: string): Promise<EmailRecord | null> {
    if (userId) {
      const res = await pgPool.query('SELECT * FROM emails WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
      return res.rows[0] || null;
    }
    const res = await pgPool.query('SELECT * FROM emails WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  },

  async deleteEmail(id: string, userId: string): Promise<boolean> {
    const res = await pgPool.query('DELETE FROM emails WHERE id = $1 AND user_id = $2', [id, userId]);
    return (res.rowCount ?? 0) > 0;
  },

  async getScheduledEmails(userId: string): Promise<EmailRecord[]> {
    const res = await pgPool.query(
      "SELECT * FROM emails WHERE status IN ('scheduled', 'processing') AND user_id = $1 ORDER BY scheduled_at ASC",
      [userId]
    );
    return res.rows;
  },

  async getEmailHistory(userId: string, limit: number = 100, status?: string): Promise<EmailRecord[]> {
    let query = "SELECT * FROM emails WHERE status != 'scheduled' AND user_id = $1";
    const params: any[] = [userId];
    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    params.push(limit);
    query += ` ORDER BY updated_at DESC LIMIT $${params.length}`;

    const res = await pgPool.query(query, params);
    return res.rows;
  },

  async searchEmails(userId: string, searchTerm: string): Promise<EmailRecord[]> {
    const term = `%${searchTerm.toLowerCase()}%`;
    const query = `
      SELECT * FROM emails
      WHERE user_id = $1 AND (LOWER(recipient) LIKE $2 OR LOWER(subject) LIKE $2 OR LOWER(body) LIKE $2)
      ORDER BY created_at DESC
      LIMIT 50;
    `;
    const res = await pgPool.query(query, [userId, term]);
    return res.rows;
  },

  async getStats(userId: string): Promise<{
    total: number;
    scheduled: number;
    processing: number;
    sent: number;
    failed: number;
    cancelled: number;
  }> {
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE status IN ('sent', 'failed')) as total,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
      FROM emails
      WHERE user_id = $1;
    `;
    const res = await pgPool.query(query, [userId]);
    const row = res.rows[0];
    return {
      total: parseInt(row?.total, 10) || 0,
      scheduled: parseInt(row?.scheduled, 10) || 0,
      processing: parseInt(row?.processing, 10) || 0,
      sent: parseInt(row?.sent, 10) || 0,
      failed: parseInt(row?.failed, 10) || 0,
      cancelled: parseInt(row?.cancelled, 10) || 0,
    };
  },

  async getSlackIntegration(userId: string): Promise<SlackIntegrationRecord | null> {
    const res = await pgPool.query(
      'SELECT * FROM slack_integrations WHERE user_id = $1 AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1',
      [userId]
    );
    return res.rows[0] || null;
  },

  async saveSlackIntegration(record: SlackIntegrationRecord, userId: string): Promise<SlackIntegrationRecord> {
    // Deactivate previous active integration for this user
    await pgPool.query('UPDATE slack_integrations SET is_active = FALSE WHERE user_id = $1', [userId]);
    const query = `
      INSERT INTO slack_integrations (
        id, user_id, team_id, team_name, access_token, bot_user_id, channel_id, channel_name, incoming_webhook_url, is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;
    const values = [
      record.id,
      userId,
      record.team_id || null,
      record.team_name || null,
      record.access_token || null,
      record.bot_user_id || null,
      record.channel_id || null,
      record.channel_name || null,
      record.incoming_webhook_url || null,
      record.is_active ?? true,
      record.created_at,
      record.updated_at,
    ];
    const res = await pgPool.query(query, values);
    return res.rows[0];
  },

  async deleteSlackIntegration(userId: string): Promise<boolean> {
    const res = await pgPool.query('DELETE FROM slack_integrations WHERE user_id = $1', [userId]);
    return (res.rowCount ?? 0) > 0;
  },

  // User Management
  async findUserById(id: string): Promise<UserRecord | null> {
    const res = await pgPool.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] || null;
  },

  async findUserByGoogleId(googleId: string): Promise<UserRecord | null> {
    const res = await pgPool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    return res.rows[0] || null;
  },

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const res = await pgPool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return res.rows[0] || null;
  },

  async upsertGoogleUser(userData: {
    googleId?: string | null;
    email: string;
    emailVerified?: boolean;
    name: string;
    avatarUrl?: string | null;
  }): Promise<UserRecord> {
    const now = new Date().toISOString();
    const normalizedEmail = userData.email.toLowerCase().trim();

    // 1. First, search by stable Google ID if available
    let existingUser: UserRecord | null = null;
    if (userData.googleId) {
      existingUser = await this.findUserByGoogleId(userData.googleId);
    }

    // 2. If not found by googleId, check by email with strict safe account linking rules
    if (!existingUser) {
      const userByEmail = await this.findUserByEmail(normalizedEmail);
      if (userByEmail) {
        // Safe Account Linking:
        // Only link if email is verified by Google OAuth AND existing account doesn't already belong to a different Google ID
        if (userData.emailVerified && (!userByEmail.google_id || userByEmail.google_id === userData.googleId)) {
          existingUser = userByEmail;
        } else if (userByEmail.google_id && userData.googleId && userByEmail.google_id !== userData.googleId) {
          throw new Error('Account linking rejected: this email is already bound to a different Google account.');
        } else if (!userData.emailVerified) {
          throw new Error('Account linking rejected: Google OAuth email is not verified.');
        }
      }
    }

    if (existingUser) {
      const updateQuery = `
        UPDATE users
        SET name = $1,
            avatar_url = COALESCE($2, avatar_url),
            google_id = COALESCE($3, google_id),
            updated_at = $4
        WHERE id = $5
        RETURNING *;
      `;
      const res = await pgPool.query(updateQuery, [
        userData.name,
        userData.avatarUrl || null,
        userData.googleId || null,
        now,
        existingUser.id,
      ]);
      return res.rows[0];
    } else {
      const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const insertQuery = `
        INSERT INTO users (id, google_id, email, name, avatar_url, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `;
      const res = await pgPool.query(insertQuery, [
        userId,
        userData.googleId || null,
        normalizedEmail,
        userData.name,
        userData.avatarUrl || null,
        now,
        now,
      ]);
      return res.rows[0];
    }
  },
};
