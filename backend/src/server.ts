import app from './app';
import { env } from './config/env';
import { initDb, pgPool } from './config/db';
import { startEmailWorker } from './workers/email.worker';
import { redisConnection } from './config/redis';

let worker: ReturnType<typeof startEmailWorker> | null = null;

const startServer = async () => {
  // Initialize Database Schema
  await initDb();

  // Start BullMQ Worker
  worker = startEmailWorker();

  const server = app.listen(env.PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Email Scheduler Backend Server Started`);
    console.log(`📍 Port:        ${env.PORT}`);
    console.log(`🌍 Environment: ${env.NODE_ENV}`);
    console.log(`🩺 Health:      http://localhost:${env.PORT}/api/health`);
    console.log(`✉️  Scheduler:   http://localhost:${env.PORT}/api/emails/stats`);
    console.log(`=========================================`);
  });

  // Graceful Shutdown
  const handleShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    server.close(async () => {
      console.log('HTTP server closed.');

      if (worker) {
        console.log('Closing BullMQ worker...');
        await worker.close();
      }

      console.log('Closing Redis connection...');
      await redisConnection.quit();

      console.log('Closing PostgreSQL pool...');
      await pgPool.end();

      console.log('Graceful shutdown complete.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Forcefully terminating process after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

