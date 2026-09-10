import { Worker, Job } from 'bullmq';
import { bullMqConnectionOptions } from '../config/redis';
import { EMAIL_QUEUE_NAME, EmailJobData } from '../services/queue.service';
import { mailerService } from '../services/mailer.service';
import { db } from '../config/db';

export const startEmailWorker = (): Worker<EmailJobData> => {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      const { id, recipient, subject, body } = job.data;
      console.log(`\n⏳ [Worker] Processing Job ID: ${job.id} | Email ID: ${id} | To: ${recipient}`);

      // Update state to 'processing'
      await db.updateEmail(id, { status: 'processing' });

      try {
        const result = await mailerService.sendMail({
          to: recipient,
          subject,
          body,
        });

        console.log(`✅ [Worker] Email delivered successfully to ${recipient}`);
        if (result.previewUrl) {
          console.log(`🔗 [Preview URL]: ${result.previewUrl}`);
        }

        // Update state to 'sent'
        await db.updateEmail(id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
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

        // If this is the final attempt or no attempts left
        if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
          await db.updateEmail(id, {
            status: 'failed',
            error_message: error.message || 'Unknown delivery failure',
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
