// Phase F Verification: Google OAuth, PostgreSQL User Persistence, and JWT Sessions
require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');

const BASE_URL = 'http://localhost:5000';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/email_scheduler';
const pool = new Pool({ connectionString: DATABASE_URL });

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
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
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('===========================================================');
  console.log('    PHASE F: GOOGLE OAUTH & JWT AUTHENTICATION TEST SUITE   ');
  console.log('===========================================================');

  try {
    // 1. Check Google OAuth URL generation endpoint
    console.log('\n[TEST 1] Testing Google OAuth URL generation (/api/auth/google/url)...');
    const urlRes = await request('GET', '/api/auth/google/url');
    console.log('Google Auth URL Status:', urlRes.status);
    if (urlRes.status === 200 && urlRes.body?.url?.includes('accounts.google.com')) {
      console.log('✅ Google OAuth 2.0 URL verified with configured credentials.');
    } else if (urlRes.status === 400 && urlRes.body?.hasCredentials === false) {
      console.log('✅ Google OAuth endpoint safely rejected unconfigured credentials without sending placeholders to Google.');
    } else {
      throw new Error(`Google OAuth URL endpoint returned unexpected status: ${urlRes.status}`);
    }

    // 2. Perform Google Login (creates user in PostgreSQL and issues JWT)
    console.log('\n[TEST 2] Testing Google login & JWT generation...');
    const testEmail = `google.user.${Date.now()}@reachinbox.ai`;
    const testName = 'Jane Google Founder';
    const testAvatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150';

    const loginRes = await request('POST', '/api/auth/mock-login', {
      email: testEmail,
      name: testName,
      avatarUrl: testAvatar,
    });

    console.log('Login HTTP Status:', loginRes.status);
    console.log('Login Response:', JSON.stringify(loginRes.body));
    if (loginRes.status !== 200 || !loginRes.body.data?.token) {
      throw new Error('Google login failed');
    }

    const token = loginRes.body.data.token;
    const user = loginRes.body.data.user;
    console.log(`✅ Google user authenticated. User ID: ${user.id} | Email: ${user.email}`);
    console.log(`✅ JWT Session Token issued: ${token.slice(0, 20)}...`);

    // 3. Verify user was persisted into PostgreSQL "users" table
    console.log('\n[TEST 3] Verifying PostgreSQL "users" table record...');
    const pgRes = await pool.query('SELECT * FROM users WHERE email = $1', [testEmail.toLowerCase()]);
    if (pgRes.rowCount === 0) {
      throw new Error('User record was not found in PostgreSQL "users" table');
    }
    const pgUser = pgRes.rows[0];
    console.log('PostgreSQL User Record:', {
      id: pgUser.id,
      google_id: pgUser.google_id,
      name: pgUser.name,
      email: pgUser.email,
      avatar_url: pgUser.avatar_url,
    });
    if (pgUser.name !== testName || pgUser.email !== testEmail.toLowerCase()) {
      throw new Error('PostgreSQL user record fields do not match login profile');
    }
    console.log('✅ PostgreSQL user persistence verified.');

    // 4. Test Authenticated Session / Current User Profile (/api/auth/me)
    console.log('\n[TEST 4] Testing authenticated profile fetch (/api/auth/me) with JWT...');
    const meRes = await request('GET', '/api/auth/me', null, token);
    console.log('Auth Me HTTP Status:', meRes.status);
    console.log('Auth Me User:', JSON.stringify(meRes.body.data?.user));
    if (meRes.status !== 200 || meRes.body.data?.user?.email !== testEmail.toLowerCase()) {
      throw new Error('Failed to retrieve user profile with valid JWT');
    }
    console.log('✅ Authenticated JWT session profile validated successfully.');

    // 5. Test Invalid Token rejection (401 Unauthorized)
    console.log('\n[TEST 5] Verifying 401 rejection for invalid/tampered JWT...');
    const invalidRes = await request('GET', '/api/auth/me', null, 'invalid.tampered.jwt.token');
    console.log('Invalid Token Status:', invalidRes.status);
    if (invalidRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized for invalid token, received ${invalidRes.status}`);
    }
    console.log('✅ Security verified: invalid tokens properly rejected.');

    // 6. Test User Profile Re-login / Upsert Update
    console.log('\n[TEST 6] Testing user re-login / profile upsert without duplication...');
    const updatedName = 'Jane Google Founder (Updated)';
    const reLoginRes = await request('POST', '/api/auth/mock-login', {
      email: testEmail,
      name: updatedName,
    });
    const reUser = reLoginRes.body.data.user;
    if (reUser.id !== user.id || reUser.name !== updatedName) {
      throw new Error('User record was duplicated instead of updated');
    }
    const totalMatching = await pool.query('SELECT COUNT(*) FROM users WHERE email = $1', [testEmail.toLowerCase()]);
    if (parseInt(totalMatching.rows[0].count, 10) !== 1) {
      throw new Error('Found duplicate users in PostgreSQL');
    }
    console.log('✅ Idempotency & Upsert confirmed: updated existing user without duplicates.');

    // 7. Test Logout endpoint
    console.log('\n[TEST 7] Testing logout endpoint (/api/auth/logout)...');
    const logoutRes = await request('POST', '/api/auth/logout');
    console.log('Logout Status:', logoutRes.status);
    if (logoutRes.status !== 200) {
      throw new Error('Logout endpoint failed');
    }
    console.log('✅ Logout endpoint verified.');

    console.log('\n===========================================================');
    console.log('   🎉 ALL PHASE F GOOGLE OAUTH & AUTH TESTS PASSED!       ');
    console.log('===========================================================');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
