import { Pool } from 'pg';
import { env } from './env';

export interface EmailSenderRecord {
  id: string;
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

// PostgreSQL Connection Pool
export const pgPool = new Pool({
  connectionString: env.DATABASE_URL,
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
  ssl: false,
  connectionTimeoutMillis: 5000,
});

/**
 * Initializes the PostgreSQL database connection and verifies/creates the table schema.
 * If PostgreSQL is unreachable or authentication fails, this function throws an error
 * to halt server startup immediately with a clear diagnostic message.
 */
export const initDb = async (): Promise<void> => {
  let client;
  try {
    client = await pgPool.connect();
    // 1. Create email_senders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_senders (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
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

    // 2. Create emails table
    await client.query(`
      CREATE TABLE IF NOT EXISTS emails (
        id VARCHAR(64) PRIMARY KEY,
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

    // 3. Ensure sender_id column and index exist in existing emails table
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='emails' AND column_name='sender_id'
        ) THEN
          ALTER TABLE emails ADD COLUMN sender_id VARCHAR(64) REFERENCES email_senders(id) ON DELETE SET NULL;
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_emails_sender_id ON emails(sender_id);
    `);

    // 4. Create slack_integrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS slack_integrations (
        id VARCHAR(64) PRIMARY KEY,
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

    // 5. Create users table for Google OAuth & authentication
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

    console.log('📦 PostgreSQL database connected and relational schema verified.');
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
        id, job_id, sender_id, recipient, subject, body, status, 
        scheduled_at, sent_at, error_message, preview_url, 
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;
    const values = [
      email.id,
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

  // Senders operations
  async createSender(sender: EmailSenderRecord): Promise<EmailSenderRecord> {
    const query = `
      INSERT INTO email_senders (
        id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass, is_default, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;
    const values = [
      sender.id,
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

  async getSenders(): Promise<EmailSenderRecord[]> {
    const res = await pgPool.query(
      'SELECT * FROM email_senders ORDER BY is_default DESC, created_at ASC'
    );
    return res.rows;
  },

  async getSenderById(id: string): Promise<EmailSenderRecord | null> {
    const res = await pgPool.query(
      'SELECT * FROM email_senders WHERE id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] || null;
  },

  async getDefaultSender(): Promise<EmailSenderRecord | null> {
    const res = await pgPool.query(
      'SELECT * FROM email_senders ORDER BY is_default DESC, created_at ASC LIMIT 1'
    );
    return res.rows[0] || null;
  },

  async deleteSender(id: string): Promise<boolean> {
    const res = await pgPool.query('DELETE FROM email_senders WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  },

  async updateEmail(
    id: string,
    updates: Partial<Omit<EmailRecord, 'id'>>
  ): Promise<EmailRecord | null> {
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return this.getEmailById(id);
    }

    const updatedAt = new Date().toISOString();
    const setClauses = fields.map((f, idx) => `"${f}" = $${idx + 2}`).join(', ');
    const values = [id, ...Object.values(updates), updatedAt];

    const query = `
      UPDATE emails
      SET ${setClauses}, updated_at = $${fields.length + 2}
      WHERE id = $1
      RETURNING *;
    `;
    const res = await pgPool.query(query, values);
    return res.rows[0] || null;
  },

  async getEmailById(id: string): Promise<EmailRecord | null> {
    const res = await pgPool.query('SELECT * FROM emails WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  },

  async getScheduledEmails(): Promise<EmailRecord[]> {
    const res = await pgPool.query(
      "SELECT * FROM emails WHERE status = 'scheduled' ORDER BY scheduled_at ASC"
    );
    return res.rows;
  },

  async getEmailHistory(limit: number = 100, status?: string): Promise<EmailRecord[]> {
    let query = "SELECT * FROM emails WHERE status != 'scheduled'";
    const params: any[] = [];
    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    params.push(limit);
    query += ` ORDER BY updated_at DESC LIMIT $${params.length}`;

    const res = await pgPool.query(query, params);
    return res.rows;
  },

  async searchEmails(searchTerm: string): Promise<EmailRecord[]> {
    const term = `%${searchTerm.toLowerCase()}%`;
    const query = `
      SELECT * FROM emails
      WHERE LOWER(recipient) LIKE $1 OR LOWER(subject) LIKE $1 OR LOWER(body) LIKE $1
      ORDER BY created_at DESC
      LIMIT 50;
    `;
    const res = await pgPool.query(query, [term]);
    return res.rows;
  },

  async getStats(): Promise<{
    total: number;
    scheduled: number;
    processing: number;
    sent: number;
    failed: number;
    cancelled: number;
  }> {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
      FROM emails;
    `;
    const res = await pgPool.query(query);
    const row = res.rows[0];
    return {
      total: parseInt(row.total, 10) || 0,
      scheduled: parseInt(row.scheduled, 10) || 0,
      processing: parseInt(row.processing, 10) || 0,
      sent: parseInt(row.sent, 10) || 0,
      failed: parseInt(row.failed, 10) || 0,
      cancelled: parseInt(row.cancelled, 10) || 0,
    };
  },

  async getSlackIntegration(): Promise<SlackIntegrationRecord | null> {
    const res = await pgPool.query(
      'SELECT * FROM slack_integrations WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1'
    );
    return res.rows[0] || null;
  },

  async saveSlackIntegration(record: SlackIntegrationRecord): Promise<SlackIntegrationRecord> {
    // Upsert or insert new active integration
    await pgPool.query('UPDATE slack_integrations SET is_active = FALSE');
    const query = `
      INSERT INTO slack_integrations (
        id, team_id, team_name, access_token, bot_user_id, channel_id, channel_name, incoming_webhook_url, is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;
    const values = [
      record.id,
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

  async deleteSlackIntegration(): Promise<boolean> {
    const res = await pgPool.query('DELETE FROM slack_integrations');
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
    name: string;
    avatarUrl?: string | null;
  }): Promise<UserRecord> {
    const existing = userData.googleId
      ? await this.findUserByGoogleId(userData.googleId)
      : await this.findUserByEmail(userData.email);

    const now = new Date().toISOString();

    if (existing) {
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
        existing.id,
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
        userData.email.toLowerCase(),
        userData.name,
        userData.avatarUrl || null,
        now,
        now,
      ]);
      return res.rows[0];
    }
  },
};
