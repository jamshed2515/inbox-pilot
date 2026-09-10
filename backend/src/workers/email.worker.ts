import { Worker, Job } from 'bullmq';
import { bullMqConnectionOptions } from '../config/redis';
import { EMAIL_QUEUE_NAME, EmailJobData } from '../services/queue.service';
import { mailerService } from '../services/mailer.service';
import { db } from '../config/db';
import { elasticsearchService } from '../services/elasticsearch.service';

export const startEmailWorker = (): Worker<EmailJobData> => {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      const { id, senderId, recipient, subject, body } = job.data;

      // Resolve assigned sender
      let sender = null;
      if (senderId) {
        sender = await db.getSenderById(senderId);
      }
      if (!sender) {
        const record = await db.getEmailById(id);
        if (record?.sender_id) {
          sender = await db.getSenderById(record.sender_id);
        }
      }
      if (!sender) {
        sender = await db.getDefaultSender();
      }

      const senderDisplay = sender ? `"${sender.name}" <${sender.email}>` : 'Default Sender';
      console.log(`\n⏳ [Worker] Processing Job ID: ${job.id} | Email ID: ${id} | From: ${senderDisplay} | To: ${recipient}`);

      // 1. Update state to 'processing' in PostgreSQL and Elasticsearch
      await db.updateEmail(id, { status: 'processing' });
      await elasticsearchService.updateEmailStatus(id, { status: 'processing' });

      try {
        const result = await mailerService.sendMailFromSender(sender, {
          to: recipient,
          subject,
          body,
        });

        console.log(`✅ [Worker] Email delivered successfully from ${senderDisplay} to ${recipient}`);
        if (result.previewUrl) {
          console.log(`🔗 [Preview URL]: ${result.previewUrl}`);
        }

        const sentAt = new Date().toISOString();

        // 2. Update state to 'sent' in PostgreSQL and Elasticsearch
        await db.updateEmail(id, {
          status: 'sent',
          sent_at: sentAt,
          preview_url: result.previewUrl,
          error_message: null,
        });
        await elasticsearchService.updateEmailStatus(id, {
          status: 'sent',
          sent_at: sentAt,
          preview_url: result.previewUrl,
          error_message: null,
        });

        return {
          success: true,
          previewUrl: result.previewUrl,
          messageId: result.messageId,
        };
      } catch (error: any) {
        console.error(`❌ [Worker] Delivery failed for ${recipient} (Attempt ${job.attemptsMade + 1}/${job.opts.attempts}):`, error.message);

        // 3. If this is the final attempt or no attempts left, update state to 'failed'
        if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
          const errorMessage = error.message || 'Unknown delivery failure';
          await db.updateEmail(id, {
            status: 'failed',
            error_message: errorMessage,
          });
          await elasticsearchService.updateEmailStatus(id, {
            status: 'failed',
            error_message: errorMessage,
          });
        }

        throw error; // Rethrow to let BullMQ handle retry and backoff
      }
    },
    {
      connection: bullMqConnectionOptions,
      concurrency: 5, // Process up to 5 emails in parallel
      limiter: {
        max: 10, // Max 10 emails
        duration: 1000, // per 1000ms (Rate Limiting)
      },
    }
  );


  worker.on('completed', (job) => {
    console.log(`🎉 [Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`💥 [Worker] Job ${job?.id} failed with error:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('⚠️ [Worker] Worker error event:', err.message);
  });

  console.log('👷 BullMQ Email Worker started [Concurrency: 5, Rate Limit: 10/sec]');
  return worker;
};
