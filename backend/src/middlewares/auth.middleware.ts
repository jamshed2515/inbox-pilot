import { Request, Response, NextFunction } from 'express';
import { authService, JwtAuthPayload } from '../services/auth.service';
import { db, UserRecord } from '../config/db';

export interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  jwtPayload?: JwtAuthPayload;
}

/**
 * Authentication Middleware
 * Enforces valid JWT session tokens on protected API routes.
 * Rejects unauthenticated requests with HTTP 401 Unauthorized.
 */
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query.token && typeof req.query.token === 'string') {
      token = req.query.token.trim();
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: { message: 'Authentication required. Missing or empty Bearer token.' },
      });
      return;
    }

    const payload = authService.verifyToken(token);
    if (!payload || !payload.userId) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid or expired authentication session token.' },
      });
      return;
    }

    const user = await db.findUserById(payload.userId);
    if (!user) {
      res.status(401).json({
        success: false,
        error: { message: 'Authentication failed. User record not found.' },
      });
      return;
    }

    req.user = user;
    req.jwtPayload = payload;
    next();
  } catch (error: any) {
    res.status(401).json({
      success: false,
      error: { message: error.message || 'Unauthorized access.' },
    });
  }
};
