import { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { slackService } from '../services/slack.service';
import { db } from '../config/db';
import { env } from '../config/env';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const connectSchema = z.object({
  webhookUrl: z.string().url().optional(),
  botToken: z.string().optional(),
  channel: z.string().optional(),
  teamName: z.string().optional(),
});

export const getSlackStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const integration = await slackService.getActiveIntegration(userId);
    res.json({
      success: true,
      connected: !!integration,
      data: integration
        ? {
            teamName: integration.team_name,
            channel: integration.channel_name || integration.channel_id,
            hasWebhook: !!integration.incoming_webhook_url,
            hasToken: !!integration.access_token,
            updatedAt: integration.updated_at,
          }
        : null,
      oauthUrl: slackService.getOAuthAuthorizeUrl(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to fetch Slack status' },
    });
  }
};

export const startSlackOAuth = (req: Request, res: Response): void => {
  if (!env.SLACK_CLIENT_ID || env.SLACK_CLIENT_ID === 'dummy_client_id') {
    res.redirect(`${env.CLIENT_URL}/?slack_error=missing_credentials`);
    return;
  }
  const userId = (req as AuthenticatedRequest).user!.id;
  const state = jwt.sign({ userId, type: 'slack_oauth' }, env.JWT_SECRET, { expiresIn: '15m' });
  const authUrl = slackService.getOAuthAuthorizeUrl(state);
  res.redirect(authUrl);
};

export const handleSlackOAuthCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, error, state } = req.query;
    if (error) {
      res.redirect(`${env.CLIENT_URL}/?slack_error=${encodeURIComponent(String(error))}`);
      return;
    }
    if (!code) {
      res.redirect(`${env.CLIENT_URL}/?slack_error=no_code_provided`);
      return;
    }

    if (!state || typeof state !== 'string') {
      res.redirect(`${env.CLIENT_URL}/?slack_error=missing_state`);
      return;
    }

    let userId: string;
    try {
      const decoded = jwt.verify(state, env.JWT_SECRET) as any;
      if (!decoded.userId) throw new Error('Invalid state token');
      userId = decoded.userId;
    } catch {
      res.redirect(`${env.CLIENT_URL}/?slack_error=invalid_or_expired_state`);
      return;
    }

    await slackService.exchangeCodeForToken(String(code), userId);
    res.redirect(`${env.CLIENT_URL}/?slack=connected`);
  } catch (err: any) {
    console.error('Error handling Slack OAuth callback:', err.message);
    res.redirect(`${env.CLIENT_URL}/?slack_error=${encodeURIComponent(err.message)}`);
  }
};

export const connectDirectSlack = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const validated = connectSchema.parse(req.body);
    if (!validated.webhookUrl && !validated.botToken) {
      res.status(400).json({
        success: false,
        error: { message: 'Either webhookUrl or botToken must be provided' },
      });
      return;
    }

    const saved = await slackService.saveDirectCredentials(validated, userId);
    res.status(201).json({
      success: true,
      message: 'Slack credentials connected and saved successfully',
      data: {
        teamName: saved.team_name,
        channel: saved.channel_name,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: { message: 'Validation failed', issues: error.errors },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to connect Slack' },
    });
  }
};

export const sendTestAlert = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const result = await slackService.sendRateLimitAlert({
      userId,
      senderId: 'demo_sender_99',
      senderName: 'VIP Growth Outbound',
      senderEmail: 'growth.vip@reachinbox-scheduler.io',
      currentCount: 200,
      maxLimit: 200,
      nextHourIso: new Date(Date.now() + 3600000).toISOString(),
      emailId: `mail_test_${Date.now()}`,
      recipient: 'enterprise.buyer@globalfortune.com',
    });

    res.json({
      success: true,
      message: 'Test Slack alert triggered successfully',
      result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to send test alert' },
    });
  }
};

export const disconnectSlack = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    await db.deleteSlackIntegration(userId);
    res.json({
      success: true,
      message: 'Slack integration disconnected successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || 'Failed to disconnect Slack' },
    });
  }
};
