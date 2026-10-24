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
      const { id, userId, senderId, recipient, subject, body } = job.data;

      // 1. Fetch persisted database email record to verify existence and ownership
      const record = await db.getEmailById(id);
      if (!record) {
        console.warn(`⚠️ [Worker] Job ${job.id} aborted: Database record for email ${id} not found.`);
        return { aborted: true, reason: 'Record not found' };
      }

      // Security Check: Enforce verified ownership. Old jobs or records without established ownership must be quarantined.
      if (!record.user_id && !userId) {
        console.warn(
          `⚠️ [Worker] Job ${job.id} quarantined: Email record ${id} has no established owner (user_id IS NULL). Aborting to prevent cross-account exposure.`
        );
        return { aborted: true, reason: 'Ownerless legacy record quarantined' };
      }

      // Security Check: If both job and record have ownership, ensure they match
      if (job.data.userId && record.user_id && job.data.userId !== record.user_id) {
        console.error(
          `🚨 [Worker] Security abort: Job userId (${job.data.userId}) does not match record owner (${record.user_id}) for email ${id}!`
        );
        return { aborted: true, reason: 'Ownership mismatch' };
      }

      const effectiveUserId = record.user_id || userId!;

      // 2. Resolve assigned sender scoped to the verified user
      let sender = null;
      const targetSenderId = senderId || record.sender_id;
      if (targetSenderId) {
        sender = await db.getSenderById(targetSenderId, effectiveUserId);
      }
      if (!sender && effectiveUserId) {
        sender = await db.getDefaultSender(effectiveUserId);
      }

      const senderDisplay = sender ? `"${sender.name}" <${sender.email}>` : 'Default System Sender';
      console.log(`\n⏳ [Worker] Job ready: ID ${job.id} | Email: ${id} | Owner: ${effectiveUserId || 'legacy'} | Sender: ${senderDisplay} | To: ${recipient}`);

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
          await db.updateEmail(
            id,
            {
              status: 'scheduled',
              scheduled_at: nextHourIso,
              error_message: `Hourly rate limit of ${rateCheck.maxLimit}/hr exceeded for sender. Rescheduled for next hour window.`,
            },
            effectiveUserId
          );

          await elasticsearchService.updateEmailStatus(id, {
            status: 'scheduled',
            scheduled_at: nextHourIso,
            error_message: `Hourly rate limit of ${rateCheck.maxLimit}/hr exceeded for sender. Rescheduled for next hour window.`,
          });

          // Send real Slack notification scoped to the user's Slack integration
          await slackService.sendRateLimitAlert({
            userId: effectiveUserId || null,
            senderId: sender.id,
            senderName: sender.name,
            senderEmail: sender.email,
            currentCount: rateCheck.currentCount,
            maxLimit: rateCheck.maxLimit,
            nextHourIso,
            emailId: id,
            recipient,
          });

          // Re-schedule in queue preserving userId and ownership
          await queueService.addEmailJob(
            {
              ...job.data,
              userId: effectiveUserId,
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

      // 3. Update state to 'processing' in PostgreSQL and Elasticsearch
      await db.updateEmail(id, { status: 'processing' }, effectiveUserId);
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

        // 4. Update state to 'sent' in PostgreSQL and Elasticsearch
        await db.updateEmail(
          id,
          {
            status: 'sent',
            sent_at: sentAt,
            preview_url: result.previewUrl,
            error_message: null,
          },
          effectiveUserId
        );
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
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts || 3;
        console.error(`❌ [Worker] Delivery failed for ${recipient} (Attempt ${attempt}/${maxAttempts}):`, error.message);

        // If this is the final attempt or no attempts left, update state to 'failed'
        if (attempt >= maxAttempts) {
          const errorMessage = error.message || 'Unknown delivery failure';
          await db.updateEmail(
            id,
            {
              status: 'failed',
              error_message: errorMessage,
            },
            effectiveUserId
          ).catch(() => {});
          await elasticsearchService.updateEmailStatus(id, {
            status: 'failed',
            error_message: errorMessage,
          }).catch(() => {});
        } else {
          // While BullMQ retries with backoff, record attempt info in error_message
          await db.updateEmail(
            id,
            {
              status: 'scheduled',
              error_message: `Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying...`,
            },
            effectiveUserId
          ).catch(() => {});
        }

        throw error; // Rethrow to let BullMQ handle retry and backoff
      }
    },
    {
      connection: bullMqConnectionOptions,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: 60000, // 60s lock gives ample time for cloud SMTP delivery
      lockRenewTime: 20000, // renew lock every 20s
      stalledInterval: 15000, // check for stalled jobs every 15s to recover fast from restarts
      maxStalledCount: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`🎉 [Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', async (job, err) => {
    console.error(`💥 [Worker] Job ${job?.id} failed with error:`, err.message);
    if (job?.data?.id) {
      const emailId = job.data.id;
      const errorMessage = err.message || 'Delivery failed after all retry attempts';
      await db.updateEmail(emailId, {
        status: 'failed',
        error_message: errorMessage,
      }).catch((e) => console.error(`Failed to update failed status for ${emailId}:`, e.message));
      await elasticsearchService.updateEmailStatus(emailId, {
        status: 'failed',
        error_message: errorMessage,
      }).catch(() => {});
    }
  });

  worker.on('stalled', (jobId) => {
    console.warn(`⚠️ [Worker] Job ${jobId} was detected as stalled. BullMQ will reprocess it.`);
  });

  worker.on('error', (err) => {
    console.error('⚠️ [Worker] Worker error event:', err.message);
  });

  console.log(`👷 BullMQ Email Worker started [Concurrency: ${env.WORKER_CONCURRENCY}, Min Delay: ${env.MIN_EMAIL_DELAY_SECONDS}s, Hourly Quota: ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}/sender]`);
  return worker;
};
