import { Request, Response } from 'express';
import { z } from 'zod';
import { slackService } from '../services/slack.service';
import { db } from '../config/db';
import { env } from '../config/env';

const connectSchema = z.object({
  webhookUrl: z.string().url().optional(),
  botToken: z.string().optional(),
  channel: z.string().optional(),
  teamName: z.string().optional(),
});

export const getSlackStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const integration = await slackService.getActiveIntegration();
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

export const startSlackOAuth = (_req: Request, res: Response): void => {
  if (!env.SLACK_CLIENT_ID || env.SLACK_CLIENT_ID === 'dummy_client_id') {
    // If not configured in environment, redirect to frontend with info or inform user
    res.redirect(`${env.CLIENT_URL}/?slack_error=missing_credentials`);
    return;
  }
  const authUrl = slackService.getOAuthAuthorizeUrl();
  res.redirect(authUrl);
};

export const handleSlackOAuthCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, error } = req.query;
    if (error) {
      res.redirect(`${env.CLIENT_URL}/?slack_error=${encodeURIComponent(String(error))}`);
      return;
    }
    if (!code) {
      res.redirect(`${env.CLIENT_URL}/?slack_error=no_code_provided`);
      return;
    }

    await slackService.exchangeCodeForToken(String(code));
    res.redirect(`${env.CLIENT_URL}/?slack=connected`);
  } catch (err: any) {
    console.error('Error handling Slack OAuth callback:', err.message);
    res.redirect(`${env.CLIENT_URL}/?slack_error=${encodeURIComponent(err.message)}`);
  }
};

export const connectDirectSlack = async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = connectSchema.parse(req.body);
    if (!validated.webhookUrl && !validated.botToken) {
      res.status(400).json({
        success: false,
        error: { message: 'Either webhookUrl or botToken must be provided' },
      });
      return;
    }

    const saved = await slackService.saveDirectCredentials(validated);
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

export const sendTestAlert = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await slackService.sendRateLimitAlert({
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

export const disconnectSlack = async (_req: Request, res: Response): Promise<void> => {
  try {
    await db.deleteSlackIntegration();
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
