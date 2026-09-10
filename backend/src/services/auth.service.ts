import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { db, UserRecord } from '../config/db';

export interface GoogleUserProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface JwtAuthPayload {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  iat?: number;
  exp?: number;
}

export const authService = {
  /**
   * Generates official Google OAuth 2.0 authorization URL
   */
  getGoogleAuthUrl(state?: string): string {
    const clientId = env.GOOGLE_CLIENT_ID || 'dummy_google_client_id';
    const redirectUri = env.GOOGLE_REDIRECT_URI;
    const scope = 'openid email profile';

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
    });

    if (state) {
      params.append('state', state);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  /**
   * Exchanges Google OAuth authorization code for Google user profile
   */
  async exchangeCodeForGoogleUser(code: string): Promise<GoogleUserProfile> {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const redirectUri = env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth Client ID or Client Secret not configured');
    }

    // 1. Exchange code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange authorization code');
    }

    // 2. Fetch user profile with access token
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userData = (await userRes.json()) as any;
    if (!userRes.ok || !userData.email) {
      throw new Error(userData.error?.message || 'Failed to retrieve Google user profile');
    }

    return {
      googleId: userData.id,
      email: userData.email,
      name: userData.name || userData.email.split('@')[0],
      avatarUrl: userData.picture || undefined,
    };
  },

  /**
   * Upserts or finds Google user in PostgreSQL
   */
  async syncGoogleUser(profile: GoogleUserProfile): Promise<UserRecord> {
    const user = await db.upsertGoogleUser({
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    });
    return user;
  },

  /**
   * Issues a signed JWT token for a given user
   */
  generateToken(user: UserRecord): string {
    const payload: JwtAuthPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: (env.JWT_EXPIRES_IN || '7d') as any,
    });
  },

  /**
   * Verifies and decodes a JWT token
   */
  verifyToken(token: string): JwtAuthPayload | null {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtAuthPayload;
      return decoded;
    } catch {
      return null;
    }
  },

  /**
   * Mock / Sandbox Google login (creates or retrieves real user in PostgreSQL)
   */
  async createOrGetMockGoogleUser(email?: string, name?: string, avatarUrl?: string): Promise<{ user: UserRecord; token: string }> {
    const targetEmail = email || 'alex.founder@reachinbox.ai';
    const targetName = name || 'Alex Founder';
    const targetAvatar =
      avatarUrl ||
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';
    const targetGoogleId = `goog_${Buffer.from(targetEmail).toString('hex').slice(0, 16)}`;

    const user = await db.upsertGoogleUser({
      googleId: targetGoogleId,
      email: targetEmail,
      name: targetName,
      avatarUrl: targetAvatar,
    });

    const token = this.generateToken(user);
    return { user, token };
  },
};
