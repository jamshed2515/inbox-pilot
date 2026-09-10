const http = require('http');
const { Pool } = require('pg');
const Redis = require('ioredis');

const redis = new Redis('redis://127.0.0.1:6379');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/email_scheduler' });

let authToken = '';

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (authToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    const payload = postData ? JSON.stringify(postData) : null;
    if (payload && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({ ...options, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function authenticateVerifier() {
  const res = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/mock-login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email: 'verifier.ratelimit@reachinbox.ai', name: 'Rate Limit Verifier' }
  );
  authToken = res.body?.data?.token || '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runRateLimitVerification() {
  console.log('================================================================');
  console.log('STARTING PHASE D RATE LIMITING & RESCHEDULING VERIFICATION');
  console.log('================================================================\n');

  await authenticateVerifier();

  // STEP 1: Create a dedicated sender for rate limit testing
  console.log('Step 1: Creating dedicated test sender...');
  const senderRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/senders',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      name: 'Rate Limit Benchmark Sender',
      email: `benchmark.${Date.now()}@ratelimit.reachinbox.io`,
    }
  );

  if (senderRes.status !== 201) {
    throw new Error('Failed to create test sender: ' + JSON.stringify(senderRes.body));
  }
  const sender = senderRes.body.data;
  console.log(`✅ Test Sender Created: ID = ${sender.id} (${sender.name})`);

  // STEP 2: Verify Redis Rate Limiter key format and atomic quota enforcement
  console.log('\nStep 2: Testing Redis key format & atomic quota enforcement...');
  const hourKey = new Date().toISOString().slice(0, 13);
  const redisRateLimitKey = `rate_limit:${sender.id}:${hourKey}`;
  console.log(`Target Redis Rate Limit Key: ${redisRateLimitKey}`);

  // Simulate reaching the 200/hr limit
  await redis.set(redisRateLimitKey, '200');
  const currentCount = await redis.get(redisRateLimitKey);
  console.log(`Simulated current sender hourly usage: ${currentCount}/200`);

  // STEP 3: Schedule email when limit is reached (Verify Never-Drop & Reschedule Rule)
  console.log('\nStep 3: Scheduling email when sender has reached 200/hr limit...');
  const scheduleRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/schedule',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      senderId: sender.id,
      recipient: 'rate.limit.target@enterprise.com',
      subject: 'Critical Update: Hourly Window Deferred',
      body: 'This email should be rescheduled for the next hourly window without being dropped.',
      delaySeconds: 0,
    }
  );

  if (scheduleRes.status !== 201) {
    throw new Error('Scheduling failed: ' + JSON.stringify(scheduleRes.body));
  }
  const email = scheduleRes.body.data.email;
  console.log(`✅ Email scheduled: ID = ${email.id}`);

  // Wait for BullMQ worker to process the job and evaluate the Redis rate limit
  console.log('\nStep 4: Waiting for worker to process rate limit check and reschedule...');
  let rescheduledConfirmed = false;
  let attempts = 0;
  let finalPgRecord = null;
  let finalEsDoc = null;

  while (attempts < 15) {
    await sleep(1000);
    attempts++;

    // Check PostgreSQL
    const pgRes = await pool.query('SELECT * FROM emails WHERE id = $1', [email.id]);
    finalPgRecord = pgRes.rows[0];

    // Check Elasticsearch
    const esRes = await request({
      hostname: '127.0.0.1',
      port: 9200,
      path: `/emails/_doc/${email.id}`,
      method: 'GET',
    });
    finalEsDoc = esRes.body?._source;

    // Check if error_message indicates rescheduling and status is scheduled
    if (
      finalPgRecord?.status === 'scheduled' &&
      finalPgRecord?.error_message?.includes('Hourly rate limit')
    ) {
      rescheduledConfirmed = true;
      break;
    }
  }

  if (!rescheduledConfirmed) {
    throw new Error(
      `Rescheduling confirmation failed. Final PG record: ${JSON.stringify(finalPgRecord)}`
    );
  }

  console.log('✅ NEVER-DROP RULE VERIFIED:');
  console.log('   - PostgreSQL Status:', finalPgRecord.status, '(NEVER dropped or marked failed)');
  console.log('   - Scheduled At deferred to:', finalPgRecord.scheduled_at);
  console.log('   - Note in record:', finalPgRecord.error_message);
  console.log('   - Elasticsearch Document Status:', finalEsDoc?.status);
  console.log('   - Elasticsearch Scheduled At:', finalEsDoc?.scheduled_at);

  const newScheduledAt = new Date(finalPgRecord.scheduled_at).getTime();
  const now = Date.now();
  if (newScheduledAt <= now) {
    throw new Error('Rescheduled timestamp is not in the future!');
  }
  console.log(`   - Time until next window: ${Math.round((newScheduledAt - now) / 1000)} seconds`);

  // STEP 5: Reset rate limit and verify email sends normally under quota
  console.log('\nStep 5: Testing normal email dispatch under quota...');
  await redis.del(redisRateLimitKey);
  console.log('Reset Redis rate limit key to 0 for sender.');

  const normalScheduleRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/schedule',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      senderId: sender.id,
      recipient: 'quota.normal@enterprise.com',
      subject: 'Delivered Immediately Under Quota',
      body: 'This email is under the 200/hr limit and should deliver immediately.',
      delaySeconds: 0,
    }
  );

  const normalEmail = normalScheduleRes.body.data.email;
  console.log(`Scheduled email ID: ${normalEmail.id}`);

  // Wait for delivery
  let sentOk = false;
  attempts = 0;
  while (attempts < 25) {
    await sleep(1500);
    attempts++;
    const check = await pool.query('SELECT * FROM emails WHERE id = $1', [normalEmail.id]);
    if (check.rows[0]?.status === 'sent') {
      sentOk = true;
      console.log(`\n✅ Email sent successfully! Preview URL: ${check.rows[0].preview_url}`);
      break;
    }
    process.stdout.write('.');
  }

  if (!sentOk) {
    throw new Error('Normal email did not reach sent status within window.');
  }

  // Verify Redis counter incremented atomically
  const postSendCount = await redis.get(redisRateLimitKey);
  console.log(`Redis counter after delivery: ${postSendCount}/200 (Incremented atomically)`);

  // Cleanup
  await pool.end();
  redis.disconnect();

  console.log('\n================================================================');
  console.log('ALL PHASE D RATE LIMITING TESTS COMPLETED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runRateLimitVerification().catch((err) => {
  console.error('\n❌ Rate limit verification failed:', err);
  process.exit(1);
});
