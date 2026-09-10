// Verification script for full authentication lifecycle requirements
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

async function runE2EAuthTests() {
  console.log('===========================================================');
  console.log('    AUTH FLOW & ROUTE PROTECTION E2E VERIFICATION SUITE    ');
  console.log('===========================================================');

  // TEST 1: Public endpoint accessible without token
  console.log('\n[TEST 1] Public endpoint (/api/health) without token...');
  const healthRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/health',
    method: 'GET',
  });
  if (healthRes.status !== 200) throw new Error('Health check failed: ' + healthRes.status);
  console.log('✅ Public endpoint accessible (Status 200)');

  // TEST 2: Protected endpoints MUST return 401 without Bearer token
  console.log('\n[TEST 2] Protected endpoints without token must return 401 Unauthorized...');
  const protectedRoutes = [
    { path: '/api/emails/stats', method: 'GET' },
    { path: '/api/emails/scheduled', method: 'GET' },
    { path: '/api/emails/history', method: 'GET' },
    { path: '/api/emails/schedule', method: 'POST', body: { recipient: 'test@example.com' } },
    { path: '/api/senders', method: 'GET' },
    { path: '/api/slack/status', method: 'GET' },
    { path: '/api/auth/me', method: 'GET' },
  ];

  for (const route of protectedRoutes) {
    const res = await request(
      {
        hostname: '127.0.0.1',
        port: 5000,
        path: route.path,
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
      },
      route.body
    );
    if (res.status !== 401) {
      throw new Error(`Expected 401 on ${route.method} ${route.path}, got ${res.status}`);
    }
    if (!res.body || res.body.success !== false || !res.body.error?.message) {
      throw new Error(`Expected standard error structure on ${route.path}, got: ` + JSON.stringify(res.body));
    }
    console.log(`✅ ${route.method} ${route.path} -> 401 Unauthorized (${res.body.error.message})`);
  }

  // TEST 3: One-Click Demo Google Login creates user, returns token
  console.log('\n[TEST 3] One-Click Demo Google Login (/api/auth/mock-login)...');
  const demoRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/mock-login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email: 'demo.founder@reachinbox.ai', name: 'Demo Founder' }
  );
  if (demoRes.status !== 200 || !demoRes.body?.data?.token) {
    throw new Error('Demo login failed: ' + JSON.stringify(demoRes.body));
  }
  const token = demoRes.body.data.token;
  console.log(`✅ Demo login succeeded. User: ${demoRes.body.data.user.name} (${demoRes.body.data.user.email})`);
  console.log(`✅ JWT generated: ${token.slice(0, 30)}...`);

  // TEST 4: Session validation with token (/api/auth/me)
  console.log('\n[TEST 4] Session validation with JWT (/api/auth/me)...');
  const meRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (meRes.status !== 200 || meRes.body?.data?.user?.email !== 'demo.founder@reachinbox.ai') {
    throw new Error('Session validation failed: ' + JSON.stringify(meRes.body));
  }
  console.log('✅ Session validated successfully for ' + meRes.body.data.user.name);

  // TEST 5: Protected dashboard endpoints succeed with valid JWT
  console.log('\n[TEST 5] Protected dashboard endpoints succeed with valid JWT...');
  const statsRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/emails/stats',
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (statsRes.status !== 200) throw new Error('Failed to fetch stats with token: ' + statsRes.status);
  console.log('✅ /api/emails/stats -> 200 OK (Scheduled: ' + statsRes.body.data.database.scheduled + ')');

  const sendersRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/senders',
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (sendersRes.status !== 200) throw new Error('Failed to fetch senders with token: ' + sendersRes.status);
  console.log(`✅ /api/senders -> 200 OK (${sendersRes.body.data.length} senders found)`);

  // TEST 6: Scheduling email succeeds with valid JWT
  console.log('\n[TEST 6] Scheduling email with valid JWT...');
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
      recipient: 'auth.client@reachinbox.ai',
      subject: 'Auth E2E Verification Email',
      body: '<p>Testing scheduling after authenticating with JWT.</p>',
      delaySeconds: 120,
    }
  );
  if (schedRes.status !== 201) throw new Error('Scheduling failed: ' + JSON.stringify(schedRes.body));
  console.log('✅ Email scheduled successfully. ID: ' + schedRes.body.data.email.id);

  // TEST 7: Invalid or tampered token returns 401
  console.log('\n[TEST 7] Invalid or tampered token returns 401...');
  const badRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/emails/stats',
    method: 'GET',
    headers: { Authorization: 'Bearer bad_tampered_token_xyz' },
  });
  if (badRes.status !== 401) throw new Error('Expected 401 for bad token, got: ' + badRes.status);
  console.log('✅ Bad token rejected with 401 Unauthorized (' + badRes.body.error.message + ')');

  console.log('\n===========================================================');
  console.log('   🎉 ALL 7 AUTHENTICATION LIFECYCLE TESTS PASSED!        ');
  console.log('===========================================================');
}

runE2EAuthTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
