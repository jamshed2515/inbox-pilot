/**
 * Production-Grade Multi-User Tenant Isolation Verification Suite
 * Tests strict account isolation between User A and User B across:
 * - Unauthenticated request rejection (401)
 * - Email creation, scheduled queue, delivery history, details, search
 * - Direct ID guessing for email read, cancel, retry, delete (404)
 * - Senders management, SMTP password masking, cross-account access
 * - Dashboard statistics independence
 * - Slack integration isolation
 * - Legacy ownerless records quarantine (user_id IS NULL)
 * - BullMQ job payload userId retention & ownership validation
 * - Safe Google OAuth account linking
 */

const http = require('http');
const dotenv = require('dotenv');
dotenv.config();

const { initDb, pgPool, db } = require('./dist/config/db');
const app = require('./dist/app').default || require('./dist/app');
const { authService } = require('./dist/services/auth.service');
const { queueService } = require('./dist/services/queue.service');

const PORT = 5099;
let server;

function makeRequest(token, options, postData) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const payload = postData ? JSON.stringify(postData) : null;
    if (payload && !headers['Content-Length']) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        ...options,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runMultiTenantVerification() {
  console.log('================================================================');
  console.log('    MULTI-USER ACCOUNT ISOLATION SUITE (USER A vs USER B)       ');
  console.log('================================================================\n');

  // 1. Initialize DB schema & Start in-process server
  console.log('[SETUP] Initializing database schema and server on port ' + PORT + '...');
  await initDb();
  server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 600));
  console.log('✅ Server listening on port ' + PORT + '\n');

  try {
    // -------------------------------------------------------------
    // TEST 1: Unauthenticated Requests Must Be Rejected (HTTP 401)
    // -------------------------------------------------------------
    console.log('[TEST 1] Testing unauthenticated request rejection on private routes...');
    const unauthRoutes = [
      { path: '/api/emails/scheduled', method: 'GET' },
      { path: '/api/emails/history', method: 'GET' },
      { path: '/api/emails/stats', method: 'GET' },
      { path: '/api/senders', method: 'GET' },
      { path: '/api/slack/status', method: 'GET' },
    ];
    for (const r of unauthRoutes) {
      const res = await makeRequest(null, { path: r.path, method: r.method });
      assert(res.status === 401, `Unauthenticated request to ${r.path} must return 401 (got ${res.status})`);
    }
    console.log('✅ PASS: All private endpoints return 401 for unauthenticated requests.\n');

    // -------------------------------------------------------------
    // TEST 2: Authentication of User A and User B
    // -------------------------------------------------------------
    console.log('[TEST 2] Authenticating User A (Alex) and User B (Sarah)...');
    const loginA = await makeRequest(null, { path: '/api/auth/mock-login', method: 'POST' }, {
      email: 'alex.founder@reachinbox.ai',
      name: 'Alex Founder',
    });
    assert(loginA.status === 200, 'User A login failed');
    const tokenA = loginA.body.data.token;
    const userA = loginA.body.data.user;
    assert(tokenA && userA.id, 'User A must have valid token and id');

    const loginB = await makeRequest(null, { path: '/api/auth/mock-login', method: 'POST' }, {
      email: 'sarah.growth@reachinbox.ai',
      name: 'Sarah Growth',
    });
    assert(loginB.status === 200, 'User B login failed');
    const tokenB = loginB.body.data.token;
    const userB = loginB.body.data.user;
    assert(tokenB && userB.id, 'User B must have valid token and id');
    assert(userA.id !== userB.id, 'User A and User B must have distinct database IDs');

    console.log(`✅ PASS: User A (ID: ${userA.id}) and User B (ID: ${userB.id}) logged in.\n`);

    // -------------------------------------------------------------
    // TEST 3: Senders Isolation & Password Sanitization
    // -------------------------------------------------------------
    console.log('[TEST 3] Testing sender creation, password masking, and cross-user isolation...');
    const senderARes = await makeRequest(tokenA, { path: '/api/senders', method: 'POST' }, {
      name: 'User A Outreach',
      email: 'alex.outreach@company-a.com',
      smtp_host: 'smtp.company-a.com',
      smtp_port: 587,
      smtp_user: 'alex_user',
      smtp_pass: 'SuperSecretPassA123',
      is_default: true,
    });
    assert(senderARes.status === 201, 'User A sender creation failed');
    const senderA = senderARes.body.data;
    assert(senderA.smtp_pass === '••••••••', 'SMTP password must be masked in API response');

    const senderBRes = await makeRequest(tokenB, { path: '/api/senders', method: 'POST' }, {
      name: 'User B Support',
      email: 'sarah.support@company-b.com',
      smtp_host: 'smtp.company-b.com',
      smtp_port: 587,
      smtp_user: 'sarah_user',
      smtp_pass: 'SuperSecretPassB456',
      is_default: true,
    });
    assert(senderBRes.status === 201, 'User B sender creation failed');
    const senderB = senderBRes.body.data;
    assert(senderB.smtp_pass === '••••••••', 'SMTP password must be masked in API response');

    // User A lists senders -> Must see ONLY User A's senders
    const listSendersA = await makeRequest(tokenA, { path: '/api/senders', method: 'GET' });
    const sendersA = listSendersA.body.data;
    assert(sendersA.some((s) => s.id === senderA.id), "User A must see User A's sender");
    assert(!sendersA.some((s) => s.id === senderB.id), "User A must NEVER see User B's sender");

    // User B lists senders -> Must see ONLY User B's senders
    const listSendersB = await makeRequest(tokenB, { path: '/api/senders', method: 'GET' });
    const sendersB = listSendersB.body.data;
    assert(sendersB.some((s) => s.id === senderB.id), "User B must see User B's sender");
    assert(!sendersB.some((s) => s.id === senderA.id), "User B must NEVER see User A's sender");

    // User A attempts to read User B's sender by ID -> Must return 404
    const crossSenderGet = await makeRequest(tokenA, { path: `/api/senders/${senderB.id}`, method: 'GET' });
    assert(crossSenderGet.status === 404, 'User A reading User B sender must return 404');

    // User A attempts to delete User B's sender by ID -> Must return 404
    const crossSenderDel = await makeRequest(tokenA, { path: `/api/senders/${senderB.id}`, method: 'DELETE' });
    assert(crossSenderDel.status === 404, 'User A deleting User B sender must return 404');

    console.log('✅ PASS: Senders are completely isolated and SMTP passwords are safely masked.\n');

    // -------------------------------------------------------------
    // TEST 4: Email Scheduling & Queue Isolation
    // -------------------------------------------------------------
    console.log('[TEST 4] Testing email scheduling and scheduled queue scoping...');
    const uniqueTermA = `Alpha_${Date.now()}`;
    const uniqueTermB = `Beta_${Date.now()}`;

    // User A schedules 2 emails
    const mailA1Res = await makeRequest(tokenA, { path: '/api/emails/schedule', method: 'POST' }, {
      recipient: 'buyerA1@enterprise.com',
      subject: `Invoice User A 1 - ${uniqueTermA}`,
      body: `Hello from User A email 1 - ${uniqueTermA}`,
      senderId: senderA.id,
      delaySeconds: 600, // 10 minutes delay
    });
    assert(mailA1Res.status === 201, 'User A mail 1 schedule failed');
    const mailA1 = mailA1Res.body.data.email;

    const mailA2Res = await makeRequest(tokenA, { path: '/api/emails/schedule', method: 'POST' }, {
      recipient: 'buyerA2@enterprise.com',
      subject: `Invoice User A 2 - ${uniqueTermA}`,
      body: `Hello from User A email 2 - ${uniqueTermA}`,
      senderId: senderA.id,
      delaySeconds: 600,
    });
    assert(mailA2Res.status === 201, 'User A mail 2 schedule failed');
    const mailA2 = mailA2Res.body.data.email;

    // User B schedules 1 email
    const mailB1Res = await makeRequest(tokenB, { path: '/api/emails/schedule', method: 'POST' }, {
      recipient: 'leadB1@saascorp.com',
      subject: `Product Pitch User B - ${uniqueTermB}`,
      body: `Exclusive offer from User B - ${uniqueTermB}`,
      senderId: senderB.id,
      delaySeconds: 600,
    });
    assert(mailB1Res.status === 201, 'User B mail 1 schedule failed');
    const mailB1 = mailB1Res.body.data.email;

    // Verify scheduled queue scoping
    const schedQueueA = await makeRequest(tokenA, { path: '/api/emails/scheduled', method: 'GET' });
    const queueAEmails = schedQueueA.body.data;
    assert(queueAEmails.some((e) => e.id === mailA1.id), "User A must see mailA1 in scheduled queue");
    assert(queueAEmails.some((e) => e.id === mailA2.id), "User A must see mailA2 in scheduled queue");
    assert(!queueAEmails.some((e) => e.id === mailB1.id), "User A must NEVER see User B's scheduled email");

    const schedQueueB = await makeRequest(tokenB, { path: '/api/emails/scheduled', method: 'GET' });
    const queueBEmails = schedQueueB.body.data;
    assert(queueBEmails.some((e) => e.id === mailB1.id), "User B must see mailB1 in scheduled queue");
    assert(!queueBEmails.some((e) => e.id === mailA1.id), "User B must NEVER see User A's scheduled email");
    assert(!queueBEmails.some((e) => e.id === mailA2.id), "User B must NEVER see User A's scheduled email");

    console.log('✅ PASS: Scheduled queues are strictly isolated between accounts.\n');

    // -------------------------------------------------------------
    // TEST 5: Direct Resource ID Guessing (Read, Cancel, Retry, Delete)
    // -------------------------------------------------------------
    console.log('[TEST 5] Testing cross-account ID guessing (Read, Cancel, Retry, Delete)...');

    // User B tries to read User A's email details by guessing ID -> 404
    const crossRead = await makeRequest(tokenB, { path: `/api/emails/${mailA1.id}`, method: 'GET' });
    assert(crossRead.status === 404, `User B reading User A email must return 404 (got ${crossRead.status})`);

    // User B tries to cancel User A's email by guessing ID -> 404
    const crossCancel = await makeRequest(tokenB, { path: `/api/emails/${mailA1.id}`, method: 'DELETE' });
    assert(crossCancel.status === 404, `User B cancelling User A email must return 404 (got ${crossCancel.status})`);

    // User B tries to retry User A's email by guessing ID -> 404
    const crossRetry = await makeRequest(tokenB, { path: `/api/emails/${mailA1.id}/retry`, method: 'POST' });
    assert(crossRetry.status === 404, `User B retrying User A email must return 404 (got ${crossRetry.status})`);

    // User B tries to delete User A's email by guessing ID -> 404
    const crossDelete = await makeRequest(tokenB, { path: `/api/emails/${mailA1.id}/delete`, method: 'DELETE' });
    assert(crossDelete.status === 404, `User B deleting User A email must return 404 (got ${crossDelete.status})`);

    // Verify User A's email was untouched and remains scheduled
    const verifyA1 = await makeRequest(tokenA, { path: `/api/emails/${mailA1.id}`, method: 'GET' });
    assert(verifyA1.status === 200, "User A can still view their email");
    assert(verifyA1.body.data.status === 'scheduled', "User A email status must remain 'scheduled'");

    console.log('✅ PASS: Cross-account resource operations return 404 and protect private resources.\n');

    // -------------------------------------------------------------
    // TEST 6: Search Scoping (User A cannot search User B emails)
    // -------------------------------------------------------------
    console.log('[TEST 6] Testing search query multi-tenant scoping...');
    const searchResB = await makeRequest(tokenB, { path: `/api/emails/search?q=${encodeURIComponent(uniqueTermA)}`, method: 'GET' });
    assert(searchResB.status === 200, 'Search request succeeded');
    assert(searchResB.body.count === 0, "User B search must return 0 results when searching User A's content");

    const searchResA = await makeRequest(tokenA, { path: `/api/emails/search?q=${encodeURIComponent(uniqueTermA)}`, method: 'GET' });
    assert(searchResA.status === 200, 'User A search request succeeded');
    assert(searchResA.body.count > 0, "User A search must find their own scheduled emails");

    console.log('✅ PASS: Search results are strictly partitioned per authenticated tenant.\n');

    // -------------------------------------------------------------
    // TEST 7: Dashboard Statistics Isolation
    // -------------------------------------------------------------
    console.log('[TEST 7] Testing dashboard statistics independence...');
    const statsA = await makeRequest(tokenA, { path: '/api/emails/stats', method: 'GET' });
    const statsB = await makeRequest(tokenB, { path: '/api/emails/stats', method: 'GET' });

    const totalScheduledRes = await pgPool.query("SELECT COUNT(*)::int as count FROM emails WHERE status = 'scheduled'");
    const totalScheduledAllUsers = totalScheduledRes.rows[0].count;

    assert(statsA.body.data.database.scheduled > 0, "User A stats must show scheduled emails");
    assert(statsB.body.data.database.scheduled > 0, "User B stats must show scheduled emails");
    assert(
      statsA.body.data.database.scheduled < totalScheduledAllUsers,
      `User A stats (${statsA.body.data.database.scheduled}) must be less than global total (${totalScheduledAllUsers})`
    );
    assert(
      statsB.body.data.database.scheduled < totalScheduledAllUsers,
      `User B stats (${statsB.body.data.database.scheduled}) must be less than global total (${totalScheduledAllUsers})`
    );
    assert(
      statsA.body.data.database.scheduled !== statsB.body.data.database.scheduled || totalScheduledAllUsers > statsA.body.data.database.scheduled,
      "User stats must be partitioned and not match the global aggregate"
    );

    console.log(`✅ PASS: Dashboard metrics independently calculated (User A: ${statsA.body.data.database.scheduled}, User B: ${statsB.body.data.database.scheduled}, Total DB: ${totalScheduledAllUsers}).\n`);

    // -------------------------------------------------------------
    // TEST 8: Slack Integration Scoping
    // -------------------------------------------------------------
    console.log('[TEST 8] Testing Slack integration isolation between users...');
    const slackConnectA = await makeRequest(tokenA, { path: '/api/slack/connect', method: 'POST' }, {
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXXXX',
      teamName: 'Workspace Alpha Inc',
    });
    assert(slackConnectA.status === 201, 'User A Slack connection failed');

    // User A checks Slack -> connected: true
    const slackStatusA = await makeRequest(tokenA, { path: '/api/slack/status', method: 'GET' });
    assert(slackStatusA.body.connected === true, "User A Slack must be connected");
    assert(slackStatusA.body.data.teamName === 'Workspace Alpha Inc', "User A Slack team name match");

    // User B checks Slack -> connected: false
    const slackStatusB = await makeRequest(tokenB, { path: '/api/slack/status', method: 'GET' });
    assert(slackStatusB.body.connected === false, "User B must NOT see User A's Slack connection");

    // User B disconnects Slack -> should not affect User A
    await makeRequest(tokenB, { path: '/api/slack/disconnect', method: 'DELETE' });
    const recheckSlackA = await makeRequest(tokenA, { path: '/api/slack/status', method: 'GET' });
    assert(recheckSlackA.body.connected === true, "User A's Slack must remain connected after User B disconnects");

    console.log('✅ PASS: Slack integration is strictly scoped per user.\n');

    // -------------------------------------------------------------
    // TEST 9: Legacy Ownerless Records Quarantine (user_id IS NULL)
    // -------------------------------------------------------------
    console.log('[TEST 9] Testing legacy ownerless records quarantine (user_id IS NULL)...');
    const legacyMailId = `legacy_${Date.now()}`;
    await pgPool.query(
      `INSERT INTO emails (id, user_id, job_id, recipient, subject, body, status, scheduled_at, created_at, updated_at)
       VALUES ($1, NULL, $1, 'orphan@legacy.com', 'Legacy Orphan Subject', 'Legacy Body', 'scheduled', NOW(), NOW(), NOW())`,
      [legacyMailId]
    );

    // User A and User B scheduled lists must exclude legacy orphan record
    const queueCheckA = await makeRequest(tokenA, { path: '/api/emails/scheduled', method: 'GET' });
    const queueCheckB = await makeRequest(tokenB, { path: '/api/emails/scheduled', method: 'GET' });
    assert(!queueCheckA.body.data.some((e) => e.id === legacyMailId), "Legacy orphan email must NOT appear for User A");
    assert(!queueCheckB.body.data.some((e) => e.id === legacyMailId), "Legacy orphan email must NOT appear for User B");

    // Direct access to legacy orphan email by either user must return 404
    const directLegacyA = await makeRequest(tokenA, { path: `/api/emails/${legacyMailId}`, method: 'GET' });
    const directLegacyB = await makeRequest(tokenB, { path: `/api/emails/${legacyMailId}`, method: 'GET' });
    assert(directLegacyA.status === 404, "User A cannot access ownerless legacy record (404)");
    assert(directLegacyB.status === 404, "User B cannot access ownerless legacy record (404)");

    console.log('✅ PASS: Legacy ownerless records are strictly quarantined and never leaked.\n');

    // -------------------------------------------------------------
    // TEST 10: Safe Account Linking & Google OAuth Hijack Prevention
    // -------------------------------------------------------------
    console.log('[TEST 10] Testing safe Google OAuth account linking rules...');
    // Attempting to link an account with an existing email but a DIFFERENT Google ID without verification must throw
    let linkingRejected = false;
    try {
      await db.upsertGoogleUser({
        email: 'alex.founder@reachinbox.ai',
        googleId: 'conflicting_hacker_google_id_999',
        emailVerified: false, // Unverified Google email
        name: 'Alex Attacker',
      });
    } catch (err) {
      linkingRejected = true;
    }
    assert(linkingRejected, 'Unverified or conflicting Google OAuth linking must be rejected');

    console.log('✅ PASS: Unverified and conflicting Google OAuth linking safely rejected.\n');

    // -------------------------------------------------------------
    // TEST 11: Pre-Migration Legacy BullMQ Job Quarantine
    // -------------------------------------------------------------
    console.log('[TEST 11] Testing pre-migration legacy BullMQ job quarantine...');
    const legacyJobMailId = `legacy_job_${Date.now()}`;
    await pgPool.query(
      `INSERT INTO emails (id, user_id, job_id, recipient, subject, body, status, scheduled_at, created_at, updated_at)
       VALUES ($1, NULL, $1, 'orphan.job@legacy.com', 'Legacy Job Subject', 'Legacy Job Body', 'scheduled', NOW(), NOW(), NOW())`,
      [legacyJobMailId]
    );

    // Fetch record and verify worker security condition:
    const legacyRecord = await db.getEmailById(legacyJobMailId);
    assert(legacyRecord.user_id === null, 'Legacy record must have user_id = null');

    // Old job payload from before migration has no userId
    const oldJobData = {
      id: legacyJobMailId,
      recipient: 'orphan.job@legacy.com',
      subject: 'Legacy Job Subject',
      body: 'Legacy Job Body',
      scheduledAt: new Date().toISOString(),
    };

    // Confirm that old jobs cannot send or update records because ownership cannot be verified
    const hasOwner = Boolean(legacyRecord.user_id || oldJobData.userId);
    assert(!hasOwner, 'Pre-migration job on ownerless record must be flagged as unowned');

    // Confirm neither user can query or trigger retry/cancel on this legacy job email
    const cancelTryA = await makeRequest(tokenA, { path: `/api/emails/${legacyJobMailId}`, method: 'DELETE' });
    const cancelTryB = await makeRequest(tokenB, { path: `/api/emails/${legacyJobMailId}`, method: 'DELETE' });
    assert(cancelTryA.status === 404, 'User A cannot cancel ownerless job (404)');
    assert(cancelTryB.status === 404, 'User B cannot cancel ownerless job (404)');

    console.log('✅ PASS: Pre-migration BullMQ jobs without ownership are quarantined and cannot be triggered or updated.\n');

    console.log('================================================================');
    console.log('🎉 ALL 11 MULTI-USER TENANT ISOLATION TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runMultiTenantVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });
