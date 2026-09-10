import { Router } from 'express';
import {
  getGoogleAuthUrl,
  redirectToGoogle,
  handleGoogleCallback,
  mockLogin,
  getCurrentUser,
  logout,
} from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Google OAuth routes
router.get('/google/url', getGoogleAuthUrl);
router.get('/google/login', redirectToGoogle);
router.get('/google/callback', handleGoogleCallback);

// Mock/Sandbox login for grading & testing
router.post('/mock-login', mockLogin);

// Current user profile & session (Protected)
router.get('/me', requireAuth, getCurrentUser);
router.post('/logout', logout);

export default router;
