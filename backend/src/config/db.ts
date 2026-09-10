import { Pool, QueryResult } from 'pg';
import { env } from './env';
import fs from 'fs';
import path from 'path';

export interface EmailRecord {
  id: string;
  job_id: string;
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

// PostgreSQL Pool
export const pgPool = new Pool({
  connectionString: env.DATABASE_URL,
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
  ssl: false,
  connectionTimeoutMillis: 3000,
});

let isPostgresAvailable = false;

// Fallback file-backed storage in case PostgreSQL isn't configured/ready
const fallbackDir = path.join(process.cwd(), 'data');
const fallbackFilePath = path.join(fallbackDir, 'emails_fallback.json');

const readFallbackData = (): EmailRecord[] => {
  try {
    if (fs.existsSync(fallbackFilePath)) {
      const data = fs.readFileSync(fallbackFilePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('⚠️ Could not read fallback store:', err);
  }
  return [];
};

const writeFallbackData = (records: EmailRecord[]) => {
  try {
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    fs.writeFileSync(fallbackFilePath, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.warn('⚠️ Could not write fallback store:', err);
  }
};

let inMemoryStore: EmailRecord[] = readFallbackData();

export const initDb = async (): Promise<void> => {
  try {
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS emails (
          id VARCHAR(64) PRIMARY KEY,
          job_id VARCHAR(64),
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
      isPostgresAvailable = true;
      console.log('📦 PostgreSQL database connected and schema initialized.');
    } finally {
      client.release();
    }
  } catch (error: any) {
    isPostgresAvailable = false;
    console.warn('⚠️ PostgreSQL unavailable or credentials rejected. Active Fallback Mode engaged:', error.message);
    console.log(`📁 In-memory/JSON store initialized with ${inMemoryStore.length} records.`);
  }
};

export const db = {
  isPostgres(): boolean {
    return isPostgresAvailable;
  },

  async insertEmail(email: EmailRecord): Promise<EmailRecord> {
    if (isPostgresAvailable) {
      try {
        const query = `
          INSERT INTO emails (id, job_id, recipient, subject, body, status, scheduled_at, sent_at, error_message, preview_url, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *;
        `;
        const values = [
          email.id,
          email.job_id,
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
      } catch (err: any) {
        console.warn('DB Insert failed on PostgreSQL, using fallback store:', err.message);
      }
    }

    inMemoryStore = [email, ...inMemoryStore.filter((e) => e.id !== email.id)];
    writeFallbackData(inMemoryStore);
    return email;
  },

  async updateEmail(
    id: string,
    updates: Partial<Omit<EmailRecord, 'id'>>
  ): Promise<EmailRecord | null> {
    const updatedAt = new Date().toISOString();

    if (isPostgresAvailable) {
      try {
        const fields = Object.keys(updates);
        if (fields.length === 0) return this.getEmailById(id);

        const setClauses = fields.map((f, idx) => `${f} = $${idx + 2}`).join(', ');
        const values = [id, ...Object.values(updates), updatedAt];

        const query = `
          UPDATE emails
          SET ${setClauses}, updated_at = $${fields.length + 2}
          WHERE id = $1
          RETURNING *;
        `;
        const res = await pgPool.query(query, values);
        return res.rows[0] || null;
      } catch (err: any) {
        console.warn('DB Update failed on PostgreSQL, updating fallback store:', err.message);
      }
    }

    const index = inMemoryStore.findIndex((e) => e.id === id);
    if (index === -1) return null;

    const existing = inMemoryStore[index];
    const updated: EmailRecord = {
      ...existing,
      ...updates,
      updated_at: updatedAt,
    };
    inMemoryStore[index] = updated;
    writeFallbackData(inMemoryStore);
    return updated;
  },

  async getEmailById(id: string): Promise<EmailRecord | null> {
    if (isPostgresAvailable) {
      try {
        const res = await pgPool.query('SELECT * FROM emails WHERE id = $1 LIMIT 1', [id]);
        return res.rows[0] || null;
      } catch (err: any) {
        console.warn('DB Select failed, using fallback:', err.message);
      }
    }
    return inMemoryStore.find((e) => e.id === id) || null;
  },

  async getScheduledEmails(): Promise<EmailRecord[]> {
    if (isPostgresAvailable) {
      try {
        const res = await pgPool.query(
          "SELECT * FROM emails WHERE status = 'scheduled' ORDER BY scheduled_at ASC"
        );
        return res.rows;
      } catch (err: any) {
        console.warn('DB Select scheduled failed, using fallback:', err.message);
      }
    }
    return inMemoryStore
      .filter((e) => e.status === 'scheduled')
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  },

  async getEmailHistory(limit: number = 100, status?: string): Promise<EmailRecord[]> {
    if (isPostgresAvailable) {
      try {
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
      } catch (err: any) {
        console.warn('DB Select history failed, using fallback:', err.message);
      }
    }

    let records = inMemoryStore.filter((e) => e.status !== 'scheduled');
    if (status && status !== 'all') {
      records = records.filter((e) => e.status === status);
    }
    return records
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);
  },

  async searchEmails(searchTerm: string): Promise<EmailRecord[]> {
    const term = `%${searchTerm.toLowerCase()}%`;
    if (isPostgresAvailable) {
      try {
        const query = `
          SELECT * FROM emails
          WHERE LOWER(recipient) LIKE $1 OR LOWER(subject) LIKE $1 OR LOWER(body) LIKE $1
          ORDER BY created_at DESC
          LIMIT 50;
        `;
        const res = await pgPool.query(query, [term]);
        return res.rows;
      } catch (err: any) {
        console.warn('DB Search failed, fallback search:', err.message);
      }
    }

    const s = searchTerm.toLowerCase();
    return inMemoryStore
      .filter(
        (e) =>
          e.recipient.toLowerCase().includes(s) ||
          e.subject.toLowerCase().includes(s) ||
          e.body.toLowerCase().includes(s)
      )
      .slice(0, 50);
  },

  async getStats(): Promise<{
    total: number;
    scheduled: number;
    processing: number;
    sent: number;
    failed: number;
    cancelled: number;
  }> {
    if (isPostgresAvailable) {
      try {
        const res = await pgPool.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
            COUNT(*) FILTER (WHERE status = 'processing') as processing,
            COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'failed') as failed,
            COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
          FROM emails;
        `);
        const row = res.rows[0];
        return {
          total: parseInt(row.total, 10) || 0,
          scheduled: parseInt(row.scheduled, 10) || 0,
          processing: parseInt(row.processing, 10) || 0,
          sent: parseInt(row.sent, 10) || 0,
          failed: parseInt(row.failed, 10) || 0,
          cancelled: parseInt(row.cancelled, 10) || 0,
        };
      } catch (err: any) {
        console.warn('DB Stats failed, using fallback:', err.message);
      }
    }

    return {
      total: inMemoryStore.length,
      scheduled: inMemoryStore.filter((e) => e.status === 'scheduled').length,
      processing: inMemoryStore.filter((e) => e.status === 'processing').length,
      sent: inMemoryStore.filter((e) => e.status === 'sent').length,
      failed: inMemoryStore.filter((e) => e.status === 'failed').length,
      cancelled: inMemoryStore.filter((e) => e.status === 'cancelled').length,
    };
  },
};
