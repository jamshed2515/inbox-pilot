import app from './app';
import { env } from './config/env';
import { initDb, pgPool, db } from './config/db';
import { startEmailWorker } from './workers/email.worker';
import { redisConnection, redisSummary } from './config/redis';
import { initElasticsearch, esClient } from './services/elasticsearch.service';
import { authService } from './services/auth.service';

let worker: ReturnType<typeof startEmailWorker> | null = null;

const startServer = async () => {
  // 1. Initialize PostgreSQL Relational Database Schema
  await initDb();

  // Seed default dynamic senders if none exist
  const existingSenders = await db.getSenders();
  if (existingSenders.length === 0) {
    console.log('🌱 Initializing dynamic default email senders...');
    const now = new Date().toISOString();
    await db.createSender({
      id: `sender_primary_${Date.now()}`,
      name: 'Default Outreach Team',
      email: 'outreach@reachinbox-scheduler.io',
      is_default: true,
      created_at: now,
      updated_at: now,
    });
    await db.createSender({
      id: `sender_support_${Date.now()}`,
      name: 'Customer Support Desk',
      email: 'support@reachinbox-scheduler.io',
      is_default: false,
      created_at: now,
      updated_at: now,
    });
    console.log('✅ Dynamic default email senders provisioned.');
  }

  // 2. Initialize Elasticsearch Index & Connectivity
  await initElasticsearch();

  // 3. Start BullMQ Worker
  worker = startEmailWorker();

  const server = app.listen(env.PORT, () => {
    const isGoogleConfigured = authService.isGoogleOAuthConfigured();
    const rawClientId = env.GOOGLE_CLIENT_ID?.trim() || '';
    const maskedClientId =
      rawClientId.length > 15
        ? `${rawClientId.slice(0, 8)}...${rawClientId.slice(-12)}`
        : rawClientId || 'None';

    console.log(`=========================================`);
    console.log(`🚀 Email Scheduler Backend Server Started`);
    console.log(`📍 Port:            ${env.PORT}`);
    console.log(`🌍 Environment:     ${env.NODE_ENV}`);
    console.log(`🩺 Health:          http://localhost:${env.PORT}/api/health`);
    console.log(`✉️  Scheduler:       http://localhost:${env.PORT}/api/emails/stats`);
    console.log(`📦 Redis Target:    ${redisSummary}`);
    if (isGoogleConfigured) {
      console.log(`🔑 Google OAuth:    ✅ Configured (Client ID: ${maskedClientId})`);
      console.log(`🔗 Redirect URI:    ${env.GOOGLE_REDIRECT_URI}`);
    } else {
      console.log(`🔑 Google OAuth:    ⚠️  Not Configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in backend/.env)`);
      console.log(`✨ Demo Auth:       ✅ Active ("One-Click Demo Google Login" available without credentials)`);
    }
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

      console.log('Closing Elasticsearch connection...');
      await esClient.close();

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

