import { Request, Response } from 'express';
import { z } from 'zod';
import { db, EmailSenderRecord } from '../config/db';
import { mailerService } from '../services/mailer.service';

const createSenderSchema = z.object({
  name: z.string().min(1, 'Sender display name is required'),
  email: z.string().email('Valid sender email is required'),
  smtp_host: z.string().optional(),
  smtp_port: z.coerce.number().optional(),
  smtp_user: z.string().optional(),
  smtp_pass: z.string().optional(),
  is_default: z.boolean().optional().default(false),
});

const provisionSenderSchema = z.object({
  name: z.string().min(1).default('Ethereal Test Sender'),
  is_default: z.boolean().optional().default(false),
});

export const listSenders = async (_req: Request, res: Response): Promise<void> => {
  try {
    const senders = await db.getSenders();
    res.json({
      success: true,
      count: senders.length,
      data: senders,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to list email senders' },
    });
  }
};

export const createSender = async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = createSenderSchema.parse(req.body);

    const now = new Date().toISOString();
    const senderId = `sender_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const newSender: EmailSenderRecord = {
      id: senderId,
      name: validated.name,
      email: validated.email,
      smtp_host: validated.smtp_host || null,
      smtp_port: validated.smtp_port || null,
      smtp_user: validated.smtp_user || null,
      smtp_pass: validated.smtp_pass || null,
      is_default: validated.is_default || false,
      created_at: now,
      updated_at: now,
    };

    const saved = await db.createSender(newSender);
    res.status(201).json({
      success: true,
      message: 'Sender created successfully',
      data: saved,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: { message: 'Validation failed', details: error.errors },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to create sender' },
    });
  }
};

export const provisionTestSender = async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = provisionSenderSchema.parse(req.body || {});
    const credentials = await mailerService.provisionTestAccount(validated.name);

    const now = new Date().toISOString();
    const senderId = `sender_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const newSender: EmailSenderRecord = {
      id: senderId,
      name: credentials.name,
      email: credentials.email,
      smtp_host: credentials.smtp_host,
      smtp_port: credentials.smtp_port,
      smtp_user: credentials.smtp_user,
      smtp_pass: credentials.smtp_pass,
      is_default: validated.is_default || false,
      created_at: now,
      updated_at: now,
    };

    const saved = await db.createSender(newSender);
    res.status(201).json({
      success: true,
      message: 'Dynamic test sender provisioned successfully via Ethereal',
      data: saved,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to provision test sender' },
    });
  }
};

export const getSender = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const sender = await db.getSenderById(id);
    if (!sender) {
      res.status(404).json({
        success: false,
        error: { message: `Sender with ID '${id}' not found` },
      });
      return;
    }
    res.json({
      success: true,
      data: sender,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to fetch sender' },
    });
  }
};

export const deleteSender = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deleted = await db.deleteSender(id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { message: `Sender with ID '${id}' not found` },
      });
      return;
    }
    res.json({
      success: true,
      message: 'Sender deleted successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to delete sender' },
    });
  }
};
