import { Router } from 'express';
import {
  scheduleEmail,
  batchScheduleEmails,
  getScheduledEmails,
  getEmailHistory,
  cancelEmail,
  retryEmail,
  getStats,
  searchEmails,
} from '../controllers/email.controller';

const router = Router();

// Schedule single email
router.post('/schedule', scheduleEmail);

// Schedule batch of emails
router.post('/batch', batchScheduleEmails);

// Get currently scheduled / delayed emails
router.get('/scheduled', getScheduledEmails);

// Get sent & failed history
router.get('/history', getEmailHistory);

// Get stats & queue counts
router.get('/stats', getStats);

// Search emails
router.get('/search', searchEmails);

// Cancel a scheduled email
router.delete('/:id', cancelEmail);

// Retry a failed email
router.post('/:id/retry', retryEmail);

export default router;
