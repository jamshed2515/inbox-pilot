import { Router } from 'express';
import {
  getSlackStatus,
  startSlackOAuth,
  handleSlackOAuthCallback,
  connectDirectSlack,
  sendTestAlert,
  disconnectSlack,
} from '../controllers/slack.controller';

const router = Router();

// Get connection status & OAuth URL
router.get('/status', getSlackStatus);

// Start Slack OAuth
router.get('/oauth/start', startSlackOAuth);

// Slack OAuth redirect callback
router.get('/oauth/callback', handleSlackOAuthCallback);

// Connect direct webhook / bot token
router.post('/connect', connectDirectSlack);

// Send test rate-limit alert
router.post('/test', sendTestAlert);

// Disconnect
router.delete('/disconnect', disconnectSlack);

export default router;
