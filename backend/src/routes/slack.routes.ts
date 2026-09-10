import { Router } from 'express';
import {
  getSlackStatus,
  startSlackOAuth,
  handleSlackOAuthCallback,
  connectDirectSlack,
  sendTestAlert,
  disconnectSlack,
} from '../controllers/slack.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Get connection status & OAuth URL (Protected)
router.get('/status', requireAuth, getSlackStatus);

// Start Slack OAuth (Protected)
router.get('/oauth/start', requireAuth, startSlackOAuth);

// Slack OAuth redirect callback (Public for browser redirect exchange)
router.get('/oauth/callback', handleSlackOAuthCallback);

// Connect direct webhook / bot token (Protected)
router.post('/connect', requireAuth, connectDirectSlack);

// Send test rate-limit alert (Protected)
router.post('/test', requireAuth, sendTestAlert);

// Disconnect (Protected)
router.delete('/disconnect', requireAuth, disconnectSlack);

export default router;
