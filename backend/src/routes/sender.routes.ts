import { Router } from 'express';
import {
  listSenders,
  createSender,
  provisionTestSender,
  getSender,
  deleteSender,
} from '../controllers/sender.controller';

const router = Router();

// List all senders
router.get('/', listSenders);

// Create custom sender
router.post('/', createSender);

// Provision dynamic test sender with Ethereal credentials
router.post('/provision', provisionTestSender);

// Get single sender
router.get('/:id', getSender);

// Delete sender
router.delete('/:id', deleteSender);

export default router;
