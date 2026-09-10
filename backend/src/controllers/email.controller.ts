import { Request, Response } from 'express';
import { z } from 'zod';
import { db, EmailRecord } from '../config/db';
import { queueService } from '../services/queue.service';
import { mailerService } from '../services/mailer.service';

const singleEmailSchema = z.object({
  recipient: z.string().email('Please provide a valid recipient email address'),
  subject: z.string().min(1, 'Subject cannot be empty'),
  body: z.string().min(1, 'Email body cannot be empty'),
  scheduledAt: z.string().optional(),
  delaySeconds: z.coerce.number().min(0).optional(),
});

const batchEmailSchema = z.object({
  emails: z.array(
    z.object({
      recipient: z.string().email(),
      subject: z.string().min(1),
      body: z.string().min(1),
      scheduledAt: z.string().optional(),
      delaySeconds: z.coerce.number().min(0).optional(),
    })
  ).min(1, 'At least one email is required for batch scheduling'),
  staggerSeconds: z.coerce.number().min(0).default(0),
});

export const scheduleEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = singleEmailSchema.parse(req.body);

    const now = Date.now();
    let scheduledTimeMs = now;
    let delayMs = 0;

    if (validated.delaySeconds !== undefined && validated.delaySeconds > 0) {
      delayMs = validated.delaySeconds * 1000;
      scheduledTimeMs = now + delayMs;
    } else if (validated.scheduledAt) {
      const parsedDate = new Date(validated.scheduledAt).getTime();
      if (!isNaN(parsedDate)) {
        scheduledTimeMs = parsedDate;
        delayMs = Math.max(0, parsedDate - now);
      }
    }

    const scheduledDateIso = new Date(scheduledTimeMs).toISOString();
    const emailId = `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const newRecord: EmailRecord = {
      id: emailId,
      job_id: emailId,
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

    // 1. Save to Database
    await db.insertEmail(newRecord);

    // 2. Add to BullMQ Queue
    const job = await queueService.addEmailJob(
      {
        id: emailId,
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
    const validated = batchEmailSchema.parse(req.body);
    const results: EmailRecord[] = [];
    const now = Date.now();

    for (let i = 0; i < validated.emails.length; i++) {
      const item = validated.emails[i];
      const staggerDelayMs = i * validated.staggerSeconds * 1000;
      
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
        job_id: emailId,
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
      await queueService.addEmailJob(
        {
          id: emailId,
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

export const getScheduledEmails = async (_req: Request, res: Response): Promise<void> => {
  try {
    const scheduled = await db.getScheduledEmails();
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
    const status = req.query.status as string | undefined;
    const limit = Number(req.query.limit) || 100;
    const history = await db.getEmailHistory(limit, status);
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

export const cancelEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const email = await db.getEmailById(id);

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

    // Update DB
    const updated = await db.updateEmail(id, {
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
    const { id } = req.params;
    const email = await db.getEmailById(id);

    if (!email) {
      res.status(404).json({
        success: false,
        error: { message: `Email with ID ${id} not found` },
      });
      return;
    }

    // Re-schedule immediately
    await db.updateEmail(id, {
      status: 'scheduled',
      error_message: null,
      scheduled_at: new Date().toISOString(),
    });

    await queueService.addEmailJob(
      {
        id: email.id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        scheduledAt: new Date().toISOString(),
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

export const getStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [dbStats, queueStats] = await Promise.all([
      db.getStats(),
      queueService.getQueueStats().catch(() => ({
        waiting: 0,
        active: 0,
        delayed: 0,
        completed: 0,
        failed: 0,
        total: 0,
      })),
    ]);

    res.json({
      success: true,
      data: {
        database: dbStats,
        queue: queueStats,
        mailer: mailerService.getAccountInfo(),
        storageType: db.isPostgres() ? 'PostgreSQL 16' : 'Resilient JSON Store',
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
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ success: true, count: 0, data: [] });
      return;
    }

    const results = await db.searchEmails(q);
    res.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to search emails' },
    });
  }
};
