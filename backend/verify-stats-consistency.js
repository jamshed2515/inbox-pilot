// Verifies that Total Processed = Delivered + Failed and queue lifecycle metrics are consistent
const http = require('http');

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
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
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runStatsVerification() {
  console.log('===========================================================');
  console.log('   DASHBOARD STATISTICS CONSISTENCY VERIFICATION SUITE    ');
  console.log('===========================================================');

  // 1. Authenticate to obtain token
  console.log('\n[STEP 1] Authenticating test session...');
  const authRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/mock-login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email: 'stats.verifier@reachinbox.ai', name: 'Stats Verifier' }
  );
  const token = authRes.body?.data?.token;
  if (!token) throw new Error('Authentication failed');
  console.log('✅ Authenticated successfully.');

  // 2. Fetch initial stats
  console.log('\n[STEP 2] Inspecting baseline statistics...');
  const statsRes1 = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/emails/stats',
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const s1 = statsRes1.body?.data?.database;
  console.log(`Initial Stats -> Scheduled: ${s1.scheduled}, Delivered (Sent): ${s1.sent}, Failed: ${s1.failed}, Total Processed: ${s1.total}`);

  // Check rule: Total Processed = Delivered + Failed
  if (s1.total !== s1.sent + s1.failed) {
    throw new Error(`Inconsistent stats! total (${s1.total}) != sent (${s1.sent}) + failed (${s1.failed})`);
  }
  console.log(`✅ Rule Verified: Total Processed (${s1.total}) === Delivered (${s1.sent}) + Failed (${s1.failed})`);

  // 3. Schedule a new email with a 3-second delay
  console.log('\n[STEP 3] Scheduling a new email with 3s delay...');
  const schedRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/schedule',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
    {
      recipient: 'stats.target@reachinbox.ai',
      subject: 'Stats Consistency Test Email',
      body: '<p>Testing statistics tracking consistency.</p>',
      delaySeconds: 3,
    }
  );
  if (schedRes.status !== 201) throw new Error('Failed to schedule email: ' + JSON.stringify(schedRes.body));
  console.log('✅ Email scheduled. ID:', schedRes.body.data.email.id);

  // 4. Verify Scheduled Queue increases while pending; Total Processed does NOT increase yet
  console.log('\n[STEP 4] Verifying pending state metrics...');
  const statsRes2 = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/emails/stats',
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const s2 = statsRes2.body?.data?.database;
  console.log(`Pending Stats -> Scheduled: ${s2.scheduled}, Delivered: ${s2.sent}, Failed: ${s2.failed}, Total Processed: ${s2.total}`);
  if (s2.scheduled !== s1.scheduled + 1) {
    throw new Error(`Expected scheduled count to increase from ${s1.scheduled} to ${s1.scheduled + 1}, got ${s2.scheduled}`);
  }
  if (s2.total !== s1.total) {
    throw new Error(`Total Processed should NOT increase while email is pending! Was ${s1.total}, now ${s2.total}`);
  }
  console.log('✅ Scheduled Queue increased by 1.');
  console.log('✅ Total Processed remained unchanged while email is pending.');

  // 5. Wait for worker to deliver email
  console.log('\n[STEP 5] Waiting for BullMQ worker to deliver email...');
  let s3 = null;
  const startTime = Date.now();
  while (Date.now() - startTime < 12000) {
    await sleep(1000);
    const statsRes3 = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/stats',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    s3 = statsRes3.body?.data?.database;
    if (s3 && s3.sent === s1.sent + 1) break;
  }

  console.log(`Final Stats -> Scheduled: ${s3.scheduled}, Delivered: ${s3.sent}, Failed: ${s3.failed}, Total Processed: ${s3.total}`);

  if (s3.scheduled !== s1.scheduled) {
    throw new Error(`Scheduled Queue should have decreased back to ${s1.scheduled}, got ${s3.scheduled}`);
  }
  if (s3.sent !== s1.sent + 1) {
    throw new Error(`Delivered should have increased from ${s1.sent} to ${s1.sent + 1}, got ${s3.sent}`);
  }
  if (s3.total !== s3.sent + s3.failed) {
    throw new Error(`Total Processed (${s3.total}) does not equal Delivered (${s3.sent}) + Failed (${s3.failed})`);
  }
  console.log('✅ Scheduled Queue decreased by 1.');
  console.log('✅ Delivered count increased by 1.');
  console.log(`✅ Total Processed increased to ${s3.total}, exactly matching Delivered (${s3.sent}) + Failed (${s3.failed}).`);

  console.log('\n===========================================================');
  console.log('   🎉 ALL DASHBOARD STATS CONSISTENCY CRITERIA VERIFIED!   ');
  console.log('===========================================================');
}

runStatsVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
