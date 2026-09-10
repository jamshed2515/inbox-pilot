import { Queue, Job } from 'bullmq';
import { bullMqConnectionOptions } from '../config/redis';

export interface EmailJobData {
  id: string; // Database email record ID
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  attempt?: number;
}

export const EMAIL_QUEUE_NAME = 'email-scheduler-queue';

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: bullMqConnectionOptions,

  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 604800, // Keep failed jobs for 7 days
      count: 5000,
    },
  },
});

export const queueService = {
  /**
   * Schedule or enqueue an email job
   */
  async addEmailJob(data: EmailJobData, delayMs: number = 0): Promise<Job<EmailJobData>> {
    const job = await emailQueue.add(`send-email-${data.id}`, data, {
      delay: Math.max(0, delayMs),
      jobId: data.id, // Ensure idempotency by reusing the unique email record ID
    });
    return job;
  },

  /**
   * Cancel/remove a scheduled job from queue
   */
  async removeEmailJob(jobId: string): Promise<boolean> {
    const job = await emailQueue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === 'delayed' || state === 'waiting') {
        await job.remove();
        return true;
      }
    }
    return false;
  },

  /**
   * Get real-time BullMQ queue metrics
   */
  async getQueueStats() {
    const [waiting, active, delayed, completed, failed] = await Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount(),
      emailQueue.getDelayedCount(),
      emailQueue.getCompletedCount(),
      emailQueue.getFailedCount(),
    ]);

    return {
      waiting,
      active,
      delayed,
      completed,
      failed,
      total: waiting + active + delayed + completed + failed,
    };
  },

  /**
   * Get delayed jobs
   */
  async getDelayedJobs(start: number = 0, end: number = 50) {
    return await emailQueue.getDelayed(start, end);
  },

  /**
   * Force retry a failed job
   */
  async retryJob(jobId: string): Promise<boolean> {
    const job = await emailQueue.getJob(jobId);
    if (job) {
      await job.retry();
      return true;
    }
    return false;
  },
};
