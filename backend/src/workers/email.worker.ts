import { Worker, Job } from 'bullmq';
import { bullMqConnectionOptions } from '../config/redis';
import { EMAIL_QUEUE_NAME, EmailJobData, queueService } from '../services/queue.service';
import { mailerService } from '../services/mailer.service';
import { db } from '../config/db';
import { elasticsearchService } from '../services/elasticsearch.service';
import { rateLimiterService } from '../services/rateLimiter.service';
import { slackService } from '../services/slack.service';
import { env } from '../config/env';

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
      console.log(`\n⏳ [Worker] Job ready: ID ${job.id} | Email: ${id} | Sender: ${senderDisplay} | To: ${recipient}`);

      // Rate limit check in Redis: rate_limit:senderId:currentHour
      if (sender) {
        const rateCheck = await rateLimiterService.checkAndIncrementSenderLimit(sender.id);
        console.log(`🔍 [Worker] Rate check for sender ${sender.id}:`, JSON.stringify(rateCheck));
        if (!rateCheck.allowed) {
          const nextHourIso = rateCheck.nextHourIso!;
          const delayMs = rateCheck.delayMs!;
          console.log(
            `🚫 [Worker] Rate limit reached for sender ${senderDisplay} (${rateCheck.currentCount}/${rateCheck.maxLimit} per hour).`
          );
          console.log(`⏱️ [Worker] Rescheduling email ${id} for next hour window (${nextHourIso}) in ${Math.round(delayMs / 1000)}s...`);

          // The important rule: Never drop the email when the limit is reached.
          // It must remain scheduled and eventually be sent.
          await db.updateEmail(id, {
            status: 'scheduled',
            scheduled_at: nextHourIso,
            error_message: `Hourly rate limit of ${rateCheck.maxLimit}/hr exceeded for sender. Rescheduled for next hour window.`,
          });

          await elasticsearchService.updateEmailStatus(id, {
            status: 'scheduled',
            scheduled_at: nextHourIso,
            error_message: `Hourly rate limit of ${rateCheck.maxLimit}/hr exceeded for sender. Rescheduled for next hour window.`,
          });

          // Send real Slack notification
          await slackService.sendRateLimitAlert({
            senderId: sender.id,
            senderName: sender.name,
            senderEmail: sender.email,
            currentCount: rateCheck.currentCount,
            maxLimit: rateCheck.maxLimit,
            nextHourIso,
            emailId: id,
            recipient,
          });

          // Re-schedule in queue for the calculated next-hour window
          await queueService.addEmailJob(
            {
              ...job.data,
              scheduledAt: nextHourIso,
            },
            delayMs
          );

          return {
            rateLimited: true,
            rescheduled: true,
            nextWindow: nextHourIso,
          };
        }

        // Under limit: Enforce MIN_EMAIL_DELAY_SECONDS spacing
        await rateLimiterService.enforceMinDelay(sender.id);
      }

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
      concurrency: env.WORKER_CONCURRENCY,
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

  console.log(`👷 BullMQ Email Worker started [Concurrency: ${env.WORKER_CONCURRENCY}, Min Delay: ${env.MIN_EMAIL_DELAY_SECONDS}s, Hourly Quota: ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}/sender]`);
  return worker;
};
