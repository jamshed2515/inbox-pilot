import { Request, Response } from 'express';
import { env } from '../config/env';

export const getHealth = (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'email-scheduler-backend',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
};
