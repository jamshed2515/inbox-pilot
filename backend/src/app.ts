import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import apiRouter from './routes';
import { bullBoardAdapter } from './config/bull-board';
import { errorHandler } from './middlewares/errorHandler';

const app: Application = express();

// Global Middlewares
const allowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!requestOrigin) {
        return callback(null, true);
      }

      const configuredOrigins = (env.CLIENT_URL || '')
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean);

      const isAllowed =
        configuredOrigins.includes(requestOrigin) ||
        allowedOrigins.includes(requestOrigin) ||
        /^https:\/\/.*\.vercel\.app$/.test(requestOrigin);

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root Route
app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Email Job Scheduler API is running',
    health: '/api/health',
    bullBoard: '/admin/queues',
  });
});

// BullMQ Queue Monitoring Dashboard (Phase G - Bull Board)
app.use('/admin/queues', bullBoardAdapter.getRouter());

// API Routes
app.use('/api', apiRouter);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
});

// Centralized Error Handling
app.use(errorHandler);

export default app;
