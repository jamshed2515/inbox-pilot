import { Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { db } from '../config/db';
import { env } from '../config/env';

export const getGoogleAuthUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const isConfigured = authService.isGoogleOAuthConfigured();
    if (!isConfigured) {
      res.status(400).json({
        success: false,
        hasCredentials: false,
        error: {
          message:
            'Google OAuth credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET) are not configured in backend/.env. Please configure them or use One-Click Demo Google Login.',
        },
      });
      return;
    }

    const url = authService.getGoogleAuthUrl();
    res.json({
      success: true,
      url,
      hasCredentials: true,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      hasCredentials: false,
      error: { message: error.message || 'Failed to generate Google OAuth URL' },
    });
  }
};

export const redirectToGoogle = (req: Request, res: Response): void => {
  if (!authService.isGoogleOAuthConfigured()) {
    const errorMsg =
      'Google OAuth credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET) are not configured in backend/.env. Please configure them or use "One-Click Demo Google Login".';
    console.warn(`⚠️ [Auth] Redirect to Google aborted: ${errorMsg}`);
    res.redirect(`${env.CLIENT_URL}/?auth_error=${encodeURIComponent(errorMsg)}`);
    return;
  }

  try {
    const url = authService.getGoogleAuthUrl();
    res.redirect(url);
  } catch (err: any) {
    res.redirect(`${env.CLIENT_URL}/?auth_error=${encodeURIComponent(err.message)}`);
  }
};

export const handleGoogleCallback = async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error || !code) {
    console.error('⚠️ [Auth] Google OAuth callback error or cancelled:', error);
    res.redirect(`${env.CLIENT_URL}/?auth_error=${encodeURIComponent(error || 'missing_authorization_code')}`);
    return;
  }

  if (!authService.isGoogleOAuthConfigured()) {
    console.error('⚠️ [Auth] Google OAuth callback exchange aborted: credentials not configured');
    res.redirect(
      `${env.CLIENT_URL}/?auth_error=${encodeURIComponent('Google OAuth is not configured on server')}`
    );
    return;
  }

  try {
    // 1. Exchange code for Google user profile
    const profile = await authService.exchangeCodeForGoogleUser(code);

    // 2. Create or find user in PostgreSQL
    const user = await authService.syncGoogleUser(profile);

    // 3. Issue Session / JWT
    const token = authService.generateToken(user);

    // 4. Redirect to Frontend Dashboard with Token
    res.redirect(`${env.CLIENT_URL}/?token=${encodeURIComponent(token)}`);
  } catch (err: any) {
    console.error('❌ [Auth] Google OAuth callback exchange failed:', err.message);
    res.redirect(`${env.CLIENT_URL}/?auth_error=${encodeURIComponent(err.message || 'oauth_exchange_failed')}`);
  }
};

export const mockLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, name, avatarUrl } = req.body || {};
    const { user, token } = await authService.createOrGetMockGoogleUser(email, name, avatarUrl);

    res.json({
      success: true,
      message: 'Logged in successfully via Google OAuth simulation',
      data: {
        user,
        token,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Mock login failed' },
    });
  }
};

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.query.token) {
      token = req.query.token as string;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: { message: 'Authentication token is required' },
      });
      return;
    }

    const payload = authService.verifyToken(token);
    if (!payload) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid or expired session token' },
      });
      return;
    }

    // Refresh user state from PostgreSQL
    const user = await db.findUserById(payload.userId);
    if (!user) {
      res.status(404).json({
        success: false,
        error: { message: 'User record not found in database' },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          google_id: user.google_id,
          email: user.email,
          name: user.name,
          avatar_url: user.avatar_url,
          created_at: user.created_at,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to authenticate user' },
    });
  }
};

export const logout = (req: Request, res: Response): void => {
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
};
