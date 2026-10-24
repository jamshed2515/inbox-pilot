import { Router } from 'express';
import {
  scheduleEmail,
  batchScheduleEmails,
  getScheduledEmails,
  getEmailHistory,
  getEmailById,
  cancelEmail,
  retryEmail,
  deleteEmail,
  getStats,
  searchEmails,
} from '../controllers/email.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Protect all email endpoints with JWT authentication
router.use(requireAuth);

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

// Get single email details (scoped to owner)
router.get('/:id', getEmailById);

// Delete an email record (scoped to owner)
router.delete('/:id/delete', deleteEmail);

// Cancel a scheduled email
router.delete('/:id', cancelEmail);

// Retry a failed email
router.post('/:id/retry', retryEmail);

export default router;
