import { Request, Response } from 'express';
import { z } from 'zod';
import { db, EmailRecord } from '../config/db';
import { queueService } from '../services/queue.service';
import { mailerService } from '../services/mailer.service';
import { elasticsearchService } from '../services/elasticsearch.service';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const singleEmailSchema = z.object({
  recipient: z.string().email('Please provide a valid recipient email address'),
  subject: z.string().min(1, 'Subject cannot be empty'),
  body: z.string().min(1, 'Email body cannot be empty'),
  senderId: z.string().optional(),
  scheduledAt: z.string().optional(),
  delaySeconds: z.coerce.number().min(0).optional(),
});

const batchEmailSchema = z.object({
  senderId: z.string().optional(),
  emails: z.array(
    z.object({
      recipient: z.string().email(),
      subject: z.string().min(1),
      body: z.string().min(1),
      senderId: z.string().optional(),
      scheduledAt: z.string().optional(),
      delaySeconds: z.coerce.number().min(0).optional(),
    })
  ).min(1, 'At least one email is required for batch scheduling'),
  staggerSeconds: z.coerce.number().min(0).default(0),
});

export const scheduleEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const validated = singleEmailSchema.parse(req.body);

    // Resolve sender scoped to authenticated user
    let resolvedSenderId = validated.senderId || null;
    if (resolvedSenderId) {
      const sender = await db.getSenderById(resolvedSenderId, userId);
      if (!sender) {
        res.status(400).json({
          success: false,
          error: { message: `Sender with ID '${resolvedSenderId}' does not exist or does not belong to your account` },
        });
        return;
      }
    } else {
      const defaultSender = await db.getDefaultSender(userId);
      resolvedSenderId = defaultSender?.id || null;
    }

    const now = Date.now();
    let scheduledTimeMs = now;
    let delayMs = 0;

    if (validated.delaySeconds !== undefined && validated.delaySeconds > 0) {
      delayMs = validated.delaySeconds * 1000;
      scheduledTimeMs = now + delayMs;
    } else if (validated.scheduledAt) {
      const parsedDate = new Date(validated.scheduledAt).getTime();
      if (!isNaN(parsedDate)) {
        if (parsedDate < now - 60000) {
          res.status(400).json({
            success: false,
            error: { message: 'Scheduled time cannot be in the past. Please select a future date and time.' },
          });
          return;
        }
        scheduledTimeMs = parsedDate;
        delayMs = Math.max(0, parsedDate - now);
      }
    }

    const scheduledDateIso = new Date(scheduledTimeMs).toISOString();
    const emailId = `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const newRecord: EmailRecord = {
      id: emailId,
      user_id: userId,
      job_id: emailId,
      sender_id: resolvedSenderId,
      recipient: validated.recipient,
      subject: validated.subject,
      body: validated.body,
      status: 'scheduled',
      scheduled_at: scheduledDateIso,
      sent_at: null,
      error_message: null,
      preview_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 1. Save to Database (PostgreSQL is source of truth)
    await db.insertEmail(newRecord);

    // 2. Index in Elasticsearch
    await elasticsearchService.indexEmail(newRecord);

    // 3. Add to BullMQ Queue with userId
    const job = await queueService.addEmailJob(
      {
        id: emailId,
        userId,
        senderId: resolvedSenderId,
        recipient: validated.recipient,
        subject: validated.subject,
        body: validated.body,
        scheduledAt: scheduledDateIso,
      },
      delayMs
    );

    res.status(201).json({
      success: true,
      message: delayMs > 0 ? `Email scheduled to be sent in ${Math.round(delayMs / 1000)}s` : 'Email queued for immediate delivery',
      data: {
        email: newRecord,
        jobId: job.id,
        delayMs,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          issues: error.errors,
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to schedule email' },
    });
  }
};

export const batchScheduleEmails = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const validated = batchEmailSchema.parse(req.body);
    const results: EmailRecord[] = [];
    const now = Date.now();

    const defaultSender = await db.getDefaultSender(userId);

    for (let i = 0; i < validated.emails.length; i++) {
      const item = validated.emails[i];
      const staggerDelayMs = i * validated.staggerSeconds * 1000;
      const itemSenderId = item.senderId || validated.senderId || defaultSender?.id || null;
      
      let baseDelayMs = 0;
      if (item.delaySeconds !== undefined && item.delaySeconds > 0) {
        baseDelayMs = item.delaySeconds * 1000;
      } else if (item.scheduledAt) {
        const parsed = new Date(item.scheduledAt).getTime();
        if (!isNaN(parsed)) {
          baseDelayMs = Math.max(0, parsed - now);
        }
      }

      const totalDelayMs = baseDelayMs + staggerDelayMs;
      const scheduledTimeIso = new Date(now + totalDelayMs).toISOString();
      const emailId = `batch_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

      const record: EmailRecord = {
        id: emailId,
        user_id: userId,
        job_id: emailId,
        sender_id: itemSenderId,
        recipient: item.recipient,
        subject: item.subject,
        body: item.body,
        status: 'scheduled',
        scheduled_at: scheduledTimeIso,
        sent_at: null,
        error_message: null,
        preview_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await db.insertEmail(record);
      await elasticsearchService.indexEmail(record);
      await queueService.addEmailJob(
        {
          id: emailId,
          userId,
          senderId: itemSenderId,
          recipient: item.recipient,
          subject: item.subject,
          body: item.body,
          scheduledAt: scheduledTimeIso,
        },
        totalDelayMs
      );

      results.push(record);
    }

    res.status(201).json({
      success: true,
      message: `Successfully scheduled batch of ${results.length} emails`,
      count: results.length,
      data: results,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: { message: 'Validation failed', issues: error.errors },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to schedule batch emails' },
    });
  }
};

export const getScheduledEmails = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const scheduled = await db.getScheduledEmails(userId);
    res.json({
      success: true,
      count: scheduled.length,
      data: scheduled,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to fetch scheduled emails' },
    });
  }
};

export const getEmailHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const status = req.query.status as string | undefined;
    const limit = Number(req.query.limit) || 100;
    const history = await db.getEmailHistory(userId, limit, status);
    res.json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to fetch email history' },
    });
  }
};

export const getEmailById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const email = await db.getEmailById(id, userId);

    if (!email) {
      res.status(404).json({
        success: false,
        error: { message: `Email with ID ${id} not found` },
      });
      return;
    }

    res.json({
      success: true,
      data: email,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to retrieve email' },
    });
  }
};

export const cancelEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const email = await db.getEmailById(id, userId);

    if (!email) {
      res.status(404).json({
        success: false,
        error: { message: `Email with ID ${id} not found` },
      });
      return;
    }

    if (email.status !== 'scheduled') {
      res.status(400).json({
        success: false,
        error: { message: `Cannot cancel an email with status '${email.status}'` },
      });
      return;
    }

    // Cancel in BullMQ
    await queueService.removeEmailJob(email.job_id || id);

    // Update DB with userId ownership check
    const updated = await db.updateEmail(
      id,
      {
        status: 'cancelled',
        error_message: 'Cancelled by user',
      },
      userId
    );

    // Update Elasticsearch
    await elasticsearchService.updateEmailStatus(id, {
      status: 'cancelled',
      error_message: 'Cancelled by user',
    });

    res.json({
      success: true,
      message: 'Scheduled email cancelled successfully',
      data: updated,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to cancel email' },
    });
  }
};

export const retryEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const email = await db.getEmailById(id, userId);

    if (!email) {
      res.status(404).json({
        success: false,
        error: { message: `Email with ID ${id} not found` },
      });
      return;
    }

    const scheduledAt = new Date().toISOString();

    // Re-schedule immediately with userId ownership check
    await db.updateEmail(
      id,
      {
        status: 'scheduled',
        error_message: null,
        scheduled_at: scheduledAt,
      },
      userId
    );

    // Update Elasticsearch
    await elasticsearchService.updateEmailStatus(id, {
      status: 'scheduled',
      error_message: null,
      scheduled_at: scheduledAt,
    });

    await queueService.addEmailJob(
      {
        id: email.id,
        userId,
        senderId: email.sender_id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        scheduledAt: scheduledAt,
      },
      0
    );

    res.json({
      success: true,
      message: 'Email re-queued for immediate delivery',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to retry email' },
    });
  }
};

export const deleteEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deleted = await db.deleteEmail(id, userId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { message: `Email with ID ${id} not found` },
      });
      return;
    }

    await queueService.removeEmailJob(id).catch(() => {});

    res.json({
      success: true,
      message: 'Email record deleted successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to delete email' },
    });
  }
};

export const getStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const [dbStats, queueStats, userSenders] = await Promise.all([
      db.getStats(userId),
      queueService.getQueueStats().catch(() => ({
        waiting: 0,
        active: 0,
        delayed: 0,
        completed: 0,
        failed: 0,
        total: 0,
      })),
      db.getSenders(userId),
    ]);

    res.json({
      success: true,
      data: {
        database: dbStats,
        queue: queueStats,
        mailer: mailerService.getAccountInfo(),
        storageType: 'PostgreSQL 16',
        sendersCount: userSenders.length,
        elasticsearch: {
          available: elasticsearchService.isAvailable(),
          index: process.env.ELASTICSEARCH_INDEX || 'emails',
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to fetch stats' },
    });
  }
};

export const searchEmails = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ success: true, count: 0, source: 'elasticsearch', data: [] });
      return;
    }

    // Query Elasticsearch scoped strictly to user
    const { data: results, source } = await elasticsearchService.searchEmails(userId, q);
    res.json({
      success: true,
      count: results.length,
      source,
      data: results,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to search emails' },
    });
  }
};

