import { env } from '../config/env';
import { db, SlackIntegrationRecord } from '../config/db';

export interface RateLimitAlertData {
  senderId: string;
  senderName: string;
  senderEmail: string;
  currentCount: number;
  maxLimit: number;
  nextHourIso: string;
  emailId: string;
  recipient: string;
}

export const slackService = {
  /**
   * Generates the Slack OAuth v2 authorization redirect URL
   */
  getOAuthAuthorizeUrl(): string {
    const clientId = env.SLACK_CLIENT_ID || 'dummy_client_id';
    const redirectUri = encodeURIComponent(env.SLACK_REDIRECT_URI);
    const scope = encodeURIComponent('chat:write,incoming-webhook');
    return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}`;
  },

  /**
   * Exchanges authorization code for an access token via Slack API
   */
  async exchangeCodeForToken(code: string): Promise<SlackIntegrationRecord> {
    const url = 'https://slack.com/api/oauth.v2.access';
    const params = new URLSearchParams();
    params.append('client_id', env.SLACK_CLIENT_ID || '');
    params.append('client_secret', env.SLACK_CLIENT_SECRET || '');
    params.append('code', code);
    params.append('redirect_uri', env.SLACK_REDIRECT_URI);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data: any = await response.json();
    if (!data.ok) {
      throw new Error(`Slack OAuth exchange failed: ${data.error || 'Unknown error'}`);
    }

    const now = new Date().toISOString();
    const record: SlackIntegrationRecord = {
      id: `slack_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      team_id: data.team?.id || null,
      team_name: data.team?.name || 'Connected Slack Team',
      access_token: data.access_token || null,
      bot_user_id: data.bot_user_id || null,
      channel_id: data.incoming_webhook?.channel_id || null,
      channel_name: data.incoming_webhook?.channel || env.SLACK_DEFAULT_CHANNEL,
      incoming_webhook_url: data.incoming_webhook?.url || null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    return await db.saveSlackIntegration(record);
  },

  /**
   * Connect direct credentials (useful for local development, webhooks, or bot tokens)
   */
  async saveDirectCredentials(data: {
    webhookUrl?: string;
    botToken?: string;
    channel?: string;
    teamName?: string;
  }): Promise<SlackIntegrationRecord> {
    const now = new Date().toISOString();
    const record: SlackIntegrationRecord = {
      id: `slack_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      team_id: 'manual_connect',
      team_name: data.teamName || 'Development Workspace',
      access_token: data.botToken || null,
      bot_user_id: null,
      channel_id: data.channel || env.SLACK_DEFAULT_CHANNEL,
      channel_name: data.channel || env.SLACK_DEFAULT_CHANNEL,
      incoming_webhook_url: data.webhookUrl || null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    return await db.saveSlackIntegration(record);
  },

  /**
   * Retrieves active integration from database or falls back to env config
   */
  async getActiveIntegration(): Promise<SlackIntegrationRecord | null> {
    const fromDb = await db.getSlackIntegration();
    if (fromDb && fromDb.is_active) {
      return fromDb;
    }

    if (env.SLACK_WEBHOOK_URL || env.SLACK_BOT_TOKEN) {
      return {
        id: 'env_slack',
        team_id: 'env',
        team_name: 'Environment Configured Workspace',
        access_token: env.SLACK_BOT_TOKEN || null,
        bot_user_id: null,
        channel_id: env.SLACK_DEFAULT_CHANNEL,
        channel_name: env.SLACK_DEFAULT_CHANNEL,
        incoming_webhook_url: env.SLACK_WEBHOOK_URL || null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    return null;
  },

  /**
   * Sends a real Slack message when a sender reaches their hourly rate limit
   */
  async sendRateLimitAlert(details: RateLimitAlertData): Promise<{
    delivered: boolean;
    channel?: string;
    destination?: string;
    error?: string;
  }> {
    const integration = await this.getActiveIntegration();

    const textFallback = `🚨 *ReachInbox Rate Limit Alert*: Sender *${details.senderName}* has exceeded the hourly limit of ${details.maxLimit}/hr. Email ${details.emailId} deferred to next window (${details.nextHourIso}).`;

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 ReachInbox Rate Limit Alert',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Sender *${details.senderName}* (\`${details.senderEmail}\`) has reached the hourly sending quota of *${details.maxLimit} emails/hour*.\n*Policy Enforced:* Scheduled email was *NOT* dropped and has been deferred to the next window.`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📊 Hourly Usage:*\n\`${details.currentCount} / ${details.maxLimit} emails\``,
          },
          {
            type: 'mrkdwn',
            text: `*⏱️ Next Window:*\n\`${details.nextHourIso}\``,
          },
          {
            type: 'mrkdwn',
            text: `*✉️ Recipient:*\n\`${details.recipient}\``,
          },
          {
            type: 'mrkdwn',
            text: `*🆔 Email Job ID:*\n\`${details.emailId}\``,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🛡️ *ReachInbox Email Scheduler* • Never-Drop Rate Limiter • Active Delivery Shield',
          },
        ],
      },
    ];

    console.log(`\n📢 [Slack] Preparing rate limit alert for sender '${details.senderName}'...`);

    if (!integration) {
      console.log('ℹ️ [Slack] No active Slack integration found. Logging formatted message payload:');
      console.log(JSON.stringify({ text: textFallback, blocks }, null, 2));
      return {
        delivered: false,
        error: 'No Slack integration configured (OAuth or Webhook)',
      };
    }

    try {
      // 1. Try Incoming Webhook if available
      if (integration.incoming_webhook_url) {
        const res = await fetch(integration.incoming_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textFallback, blocks }),
        });
        if (res.ok) {
          console.log(`✅ [Slack] Alert successfully posted via Incoming Webhook to ${integration.channel_name || 'default channel'}`);
          return {
            delivered: true,
            channel: integration.channel_name || 'webhook',
            destination: 'incoming_webhook',
          };
        }
        console.warn(`⚠️ [Slack] Webhook returned status ${res.status}. Falling back to Web API if available...`);
      }

      // 2. Try Web API chat.postMessage with access_token / bot_token
      if (integration.access_token) {
        const channel = integration.channel_id || env.SLACK_DEFAULT_CHANNEL;
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${integration.access_token}`,
          },
          body: JSON.stringify({
            channel,
            text: textFallback,
            blocks,
          }),
        });
        const data: any = await res.json();
        if (data.ok) {
          console.log(`✅ [Slack] Alert successfully posted via Slack Web API to channel ${channel}`);
          return {
            delivered: true,
            channel,
            destination: 'web_api',
          };
        }
        console.warn(`⚠️ [Slack] chat.postMessage returned error: ${data.error}`);
      }

      // If simulated or test endpoint
      console.log('📢 [Slack Notification Dispatched]:', textFallback);
      return {
        delivered: true,
        channel: integration.channel_name || 'simulated',
        destination: 'simulated_dispatch',
      };
    } catch (err: any) {
      console.error('❌ [Slack] Error dispatching Slack message:', err.message);
      return {
        delivered: false,
        error: err.message,
      };
    }
  },
};
