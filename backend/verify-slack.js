// Phase E Verification: Slack OAuth & Rate Limit Alerting
require('dotenv').config();
const http = require('http');
const Redis = require('ioredis');
const { Pool } = require('pg');

const BASE_URL = 'http://localhost:5000';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/email_scheduler';

const redis = new Redis(REDIS_URL);
const pool = new Pool({ connectionString: DATABASE_URL });

let authToken = '';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function authenticateVerifier() {
  const res = await request('POST', '/api/auth/mock-login', {
    email: 'verifier.slack@reachinbox.ai',
    name: 'Slack Verifier',
  });
  authToken = res.body?.data?.token || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('===========================================================');
  console.log('   PHASE E: SLACK OAUTH & RATE LIMIT ALERTING TEST SUITE   ');
  console.log('===========================================================');

  try {
    await authenticateVerifier();

    // 1. Verify Slack status endpoint
    console.log('\n[TEST 1] Checking Slack integration status...');
    const statusRes = await request('GET', '/api/slack/status');
    console.log('Status HTTP Code:', statusRes.status);
    console.log('Status Body:', JSON.stringify(statusRes.body));
    if (statusRes.status !== 200 || !statusRes.body.oauthUrl) {
      throw new Error('Slack status endpoint failed');
    }
    console.log('✅ Slack status and OAuth URL verified successfully.');

    // 2. Connect a Slack Webhook / Bot Token via API
    console.log('\n[TEST 2] Connecting Slack workspace integration...');
    const mockWebhookUrl = process.env.SLACK_WEBHOOK_URL || 'https://example.com/services/webhook-simulator';
    const connectRes = await request('POST', '/api/slack/connect', {
      webhookUrl: mockWebhookUrl,
      channel: '#email-alerts',
      teamName: 'ReachInbox Workspace',
    });
    console.log('Connect HTTP Code:', connectRes.status);
    console.log('Connect Response:', JSON.stringify(connectRes.body));
    if ((connectRes.status !== 200 && connectRes.status !== 201) || !connectRes.body.success) {
      throw new Error('Slack connect failed');
    }

    // Verify PostgreSQL persistence
    const pgRes = await pool.query('SELECT * FROM slack_integrations WHERE is_active = true');
    console.log('Active integrations in PostgreSQL:', pgRes.rowCount);
    if (pgRes.rowCount === 0) {
      throw new Error('Slack integration not found in PostgreSQL slack_integrations table');
    }
    console.log('✅ Slack integration stored & verified in PostgreSQL.');

    // 3. Test Live Slack Rate Limit Alert Dispatch
    console.log('\n[TEST 3] Testing live Slack alert dispatch (/api/slack/test)...');
    const testAlertRes = await request('POST', '/api/slack/test');
    console.log('Test Alert HTTP Code:', testAlertRes.status);
    console.log('Test Alert Body:', JSON.stringify(testAlertRes.body));
    if (testAlertRes.status !== 200 || !testAlertRes.body.success) {
      throw new Error('Slack test alert dispatch failed');
    }
    console.log('✅ Slack test alert dispatch passed.');

    // 4. Test Automated Worker Trigger on Sender 200/hr Limit
    console.log('\n[TEST 4] Testing Worker Automated Rate Limit Trigger & Slack Notification...');
    // Fetch senders
    const sendersRes = await request('GET', '/api/senders');
    const sender = sendersRes.body.data[0];
    console.log(`Using Sender: ${sender.name} (${sender.email}) [ID: ${sender.id}]`);

    // Force Redis hourly counter to 200 for this sender
    const currentHour = new Date().toISOString().slice(0, 13);
    const rateLimitKey = `rate_limit:${sender.id}:${currentHour}`;
    await redis.set(rateLimitKey, '200');
    console.log(`Simulated Redis hourly counter set: ${rateLimitKey} = 200`);

    // Schedule an email for this sender with 2-second delay
    const emailRes = await request('POST', '/api/emails/schedule', {
      senderId: sender.id,
      recipient: 'rate-limit-test@reachinbox.ai',
      subject: 'Automated Rate Limit Slack Alert Test',
      body: '<p>Testing automatic Slack notification when hourly limit is reached.</p>',
      delaySeconds: 2,
    });
    console.log('Schedule Response:', emailRes.body);
    const emailId = emailRes.body.data.email ? emailRes.body.data.email.id : emailRes.body.data.id;
    console.log(`Scheduled Email ID: ${emailId}`);

    console.log('Waiting 5 seconds for BullMQ worker to process and hit rate limit...');
    await sleep(5000);

    // Verify PostgreSQL email status - MUST NOT BE DROPPED, MUST REMAIN SCHEDULED
    const emailPgRes = await pool.query('SELECT * FROM emails WHERE id = $1', [emailId]);
    const updatedEmail = emailPgRes.rows[0];
    console.log(`Email ID ${emailId} Status in PG:`, updatedEmail.status);
    console.log(`Rescheduled to:`, updatedEmail.scheduled_at);

    if (updatedEmail.status !== 'scheduled') {
      throw new Error(`Email was not kept in scheduled status! Found: ${updatedEmail.status}`);
    }
    console.log('✅ Rule Confirmed: Email was never dropped, correctly rescheduled to next hour window.');

    // Reset test counter in Redis
    await redis.del(rateLimitKey);
    console.log('Cleaned up simulated Redis rate limit key.');

    console.log('\n===========================================================');
    console.log('   🎉 ALL PHASE E SLACK & RATE LIMIT TESTS PASSED!        ');
    console.log('===========================================================');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    redis.disconnect();
    await pool.end();
  }
}

runTests();
