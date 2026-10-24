import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { EmailRecord, db } from '../config/db';

const INDEX_NAME = env.ELASTICSEARCH_INDEX || 'emails';

const isEsDisabled =
  env.ELASTICSEARCH_ENABLED === false ||
  (env.NODE_ENV === 'production' &&
    (!env.ELASTICSEARCH_NODE ||
      env.ELASTICSEARCH_NODE.includes('127.0.0.1') ||
      env.ELASTICSEARCH_NODE.includes('localhost')) &&
    env.ELASTICSEARCH_ENABLED !== true);

export const esClient = isEsDisabled
  ? null
  : new Client({
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
  if (isEsDisabled || !esClient) {
    isEsConnected = false;
    console.log('ℹ️ Elasticsearch is disabled or unconfigured in production. Operating in resilient PostgreSQL mode.');
    return false;
  }

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
            user_id: { type: 'keyword' },
            job_id: { type: 'keyword' },
            sender_id: { type: 'keyword' },
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
      // Ensure user_id & sender_id mappings are added to existing index
      try {
        await esClient.indices.putMapping({
          index: INDEX_NAME,
          properties: {
            user_id: { type: 'keyword' },
            sender_id: { type: 'keyword' },
          },
        });
      } catch {}
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
    if (!isEsConnected || !esClient) {
      return false;
    }
    try {
      await esClient.index({
        index: INDEX_NAME,
        id: email.id,
        document: {
          id: email.id,
          user_id: email.user_id || null,
          job_id: email.job_id,
          sender_id: email.sender_id || null,
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
    if (!isEsConnected || !esClient) {
      return false;
    }
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
  async getEmailDocument(id: string, userId?: string): Promise<EmailRecord | null> {
    if (!isEsConnected || !esClient) {
      return null;
    }
    try {
      const res = await esClient.get<EmailRecord>({
        index: INDEX_NAME,
        id,
      });
      if (res.found && res._source) {
        if (userId && res._source.user_id && res._source.user_id !== userId) {
          return null; // Tenant isolation check
        }
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
   * Search emails using Elasticsearch full-text query scoped strictly to the authenticated user.
   * Falls back to PostgreSQL search if Elasticsearch is temporarily unavailable.
   */
  async searchEmails(
    userId: string,
    searchTerm: string
  ): Promise<{ data: EmailRecord[]; source: 'elasticsearch' | 'postgresql' }> {
    if (!isEsConnected || !esClient) {
      const pgResults = await db.searchEmails(userId, searchTerm);
      return { data: pgResults, source: 'postgresql' };
    }
    try {
      const response = await esClient.search<EmailRecord>({
        index: INDEX_NAME,
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: searchTerm,
                  fields: ['recipient^3', 'recipient.keyword', 'subject^2', 'body'],
                  fuzziness: 'AUTO',
                },
              },
            ],
            filter: [
              {
                term: { user_id: userId },
              },
            ],
          },
        },
        sort: [{ created_at: { order: 'desc' } }],
        size: 50,
      });

      const hits = response.hits.hits.map((hit) => hit._source as EmailRecord);
      return { data: hits, source: 'elasticsearch' };
    } catch (error: any) {
      console.warn(`⚠️ [Elasticsearch] Search failed (${error.message}). Falling back to PostgreSQL search.`);
      const pgResults = await db.searchEmails(userId, searchTerm);
      return { data: pgResults, source: 'postgresql' };
    }
  },
};
