import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { EmailRecord, db } from '../config/db';

const INDEX_NAME = env.ELASTICSEARCH_INDEX || 'emails';

export const esClient = new Client({
  node: env.ELASTICSEARCH_NODE,
  maxRetries: 3,
  requestTimeout: 5000,
});

let isEsConnected = false;

/**
 * Initializes the Elasticsearch client, checks cluster connectivity,
 * and creates the 'emails' index with full-text mappings if it does not exist.
 */
export const initElasticsearch = async (): Promise<boolean> => {
  try {
    const health = await esClient.cluster.health({});
    isEsConnected = true;
    console.log(`🔎 Elasticsearch connected successfully. Cluster status: ${health.status}`);

    const indexExists = await esClient.indices.exists({ index: INDEX_NAME });

    if (!indexExists) {
      await esClient.indices.create({
        index: INDEX_NAME,
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
        mappings: {
          properties: {
            id: { type: 'keyword' },
            job_id: { type: 'keyword' },
            recipient: {
              type: 'text',
              fields: {
                keyword: { type: 'keyword' },
              },
            },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduled_at: { type: 'date' },
            sent_at: { type: 'date' },
            error_message: { type: 'text' },
            preview_url: { type: 'keyword' },
            created_at: { type: 'date' },
            updated_at: { type: 'date' },
          },
        },
      });
      console.log(`📦 Elasticsearch index '${INDEX_NAME}' created with full-text search mappings.`);
    } else {
      console.log(`📦 Elasticsearch index '${INDEX_NAME}' verified.`);
    }

    return true;
  } catch (error: any) {
    isEsConnected = false;
    console.warn(`⚠️ Elasticsearch is unreachable at ${env.ELASTICSEARCH_NODE}: ${error.message}`);
    console.warn('Elasticsearch indexing & search will operate with resilient degradation. PostgreSQL remains active.');
    return false;
  }
};

export const elasticsearchService = {
  isAvailable(): boolean {
    return isEsConnected;
  },

  /**
   * Index a new email document in Elasticsearch.
   * Gracefully catches and logs errors so PostgreSQL data is never lost.
   */
  async indexEmail(email: EmailRecord): Promise<boolean> {
    try {
      await esClient.index({
        index: INDEX_NAME,
        id: email.id,
        document: {
          id: email.id,
          job_id: email.job_id,
          recipient: email.recipient,
          subject: email.subject,
          body: email.body,
          status: email.status,
          scheduled_at: email.scheduled_at,
          sent_at: email.sent_at,
          error_message: email.error_message,
          preview_url: email.preview_url,
          created_at: email.created_at,
          updated_at: email.updated_at,
        },
        refresh: true, // Immediate refresh so document is instantly searchable
      });
      console.log(`🔍 [Elasticsearch] Indexed email document ID: ${email.id} (Status: ${email.status})`);
      return true;
    } catch (error: any) {
      console.error(`⚠️ [Elasticsearch] Failed to index email ${email.id}:`, error.message);
      return false;
    }
  },

  /**
   * Update an existing email document's status and metadata in Elasticsearch.
   * Supports 'processing', 'sent', 'failed', 'cancelled' status updates.
   */
  async updateEmailStatus(id: string, updates: Partial<EmailRecord>): Promise<boolean> {
    try {
      const updatedAt = new Date().toISOString();
      await esClient.update({
        index: INDEX_NAME,
        id,
        doc: {
          ...updates,
          updated_at: updatedAt,
        },
        doc_as_upsert: true,
        refresh: true,
      });
      console.log(`🔍 [Elasticsearch] Updated document ID: ${id} with status: ${updates.status || 'updated'}`);
      return true;
    } catch (error: any) {
      console.error(`⚠️ [Elasticsearch] Failed to update email ${id}:`, error.message);
      return false;
    }
  },

  /**
   * Retrieve a specific email document from Elasticsearch by ID.
   */
  async getEmailDocument(id: string): Promise<EmailRecord | null> {
    try {
      const res = await esClient.get<EmailRecord>({
        index: INDEX_NAME,
        id,
      });
      if (res.found && res._source) {
        return res._source;
      }
      return null;
    } catch (error: any) {
      if (error.statusCode === 404) return null;
      console.error(`⚠️ [Elasticsearch] Error fetching document ${id}:`, error.message);
      return null;
    }
  },

  /**
   * Search emails using Elasticsearch full-text query across recipient, subject, and body.
   * Falls back to PostgreSQL search if Elasticsearch is temporarily unavailable.
   */
  async searchEmails(searchTerm: string): Promise<{ data: EmailRecord[]; source: 'elasticsearch' | 'postgresql' }> {
    try {
      const response = await esClient.search<EmailRecord>({
        index: INDEX_NAME,
        query: {
          multi_match: {
            query: searchTerm,
            fields: ['recipient^3', 'recipient.keyword', 'subject^2', 'body'],
            fuzziness: 'AUTO',
          },
        },
        sort: [{ created_at: { order: 'desc' } }],
        size: 50,
      });

      const hits = response.hits.hits.map((hit) => hit._source as EmailRecord);
      return { data: hits, source: 'elasticsearch' };
    } catch (error: any) {
      console.warn(`⚠️ [Elasticsearch] Search failed (${error.message}). Falling back to PostgreSQL search.`);
      const pgResults = await db.searchEmails(searchTerm);
      return { data: pgResults, source: 'postgresql' };
    }
  },
};
