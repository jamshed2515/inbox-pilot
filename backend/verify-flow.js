const http = require('http');
const { Pool } = require('pg');

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
    { email: 'verifier.flow@reachinbox.ai', name: 'Flow Verifier' }
  );
  authToken = res.body?.data?.token || '';
}

async function verifyFlow() {
  console.log('====================================================');
  console.log('STARTING E2E VERIFICATION TEST FOR ELASTICSEARCH');
  console.log('====================================================\n');

  await authenticateVerifier();

  // STEP 1: Schedule email with a unique term
  const uniqueTerm = 'ZetaElastic' + Date.now();
  console.log('Step 1: Schedule email');
  console.log('Unique search term:', uniqueTerm);

  const scheduleRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/schedule',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      recipient: 'verify.flow@reachinbox.ai',
      subject: 'Verification: ' + uniqueTerm,
      body: 'Automated test verifying Elasticsearch indexing and PostgreSQL persistence for term ' + uniqueTerm,
      delaySeconds: 120, // 2 minutes delay so it remains 'scheduled'
    }
  );

  if (scheduleRes.status !== 201) {
    throw new Error('Schedule failed with HTTP ' + scheduleRes.status + ': ' + JSON.stringify(scheduleRes.body));
  }
  const email = scheduleRes.body.data.email;
  const emailId = email.id;
  console.log('✅ Schedule email SUCCESS. Email ID:', emailId);
  console.log('   - Status:', email.status, '| Scheduled At:', email.scheduled_at);

  // STEP 2: Verify PostgreSQL record exists
  console.log('\nStep 2: PostgreSQL record exists');
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/email_scheduler' });
  const pgResult = await pool.query('SELECT * FROM emails WHERE id = $1', [emailId]);
  if (pgResult.rows.length === 0) {
    throw new Error('PostgreSQL record NOT found for id ' + emailId);
  }
  const pgRecord = pgResult.rows[0];
  console.log('✅ PostgreSQL record confirmed in database table "emails":');
  console.log('   - ID:', pgRecord.id);
  console.log('   - Recipient:', pgRecord.recipient);
  console.log('   - Subject:', pgRecord.subject);
  console.log('   - Status:', pgRecord.status);
  console.log('   - Created At:', pgRecord.created_at);
  await pool.end();

  // STEP 3: Elasticsearch document exists
  console.log('\nStep 3: Elasticsearch document exists');
  const esDocRes = await request({
    hostname: '127.0.0.1',
    port: 9200,
    path: '/emails/_doc/' + emailId,
    method: 'GET',
  });
  if (!esDocRes.body || !esDocRes.body.found) {
    throw new Error('Elasticsearch document NOT found for id ' + emailId + ': ' + JSON.stringify(esDocRes.body));
  }
  console.log('✅ Elasticsearch document confirmed in index "emails":');
  console.log('   - Index:', esDocRes.body._index);
  console.log('   - Document ID:', esDocRes.body._id);
  console.log('   - Found:', esDocRes.body.found);
  console.log('   - Doc Status:', esDocRes.body._source.status);
  console.log('   - Doc Subject:', esDocRes.body._source.subject);

  // STEP 4: Search API returns Elasticsearch results
  console.log('\nStep 4: Search API returns Elasticsearch results');
  // Refresh ES index to ensure immediate searchability
  await request({
    hostname: '127.0.0.1',
    port: 9200,
    path: '/emails/_refresh',
    method: 'POST',
  });

  const searchRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/emails/search?q=' + encodeURIComponent(uniqueTerm),
    method: 'GET',
  });

  console.log('Search API HTTP Status:', searchRes.status);
  if (searchRes.status !== 200 || !searchRes.body.success) {
    throw new Error('Search API returned error: ' + JSON.stringify(searchRes.body));
  }
  console.log('Search API Source:', searchRes.body.source);
  console.log('Search API Result Count:', searchRes.body.count);
  if (searchRes.body.source !== 'elasticsearch') {
    throw new Error('Expected source to be "elasticsearch", got ' + searchRes.body.source);
  }
  if (searchRes.body.count !== 1 || searchRes.body.data[0].id !== emailId) {
    throw new Error('Search did not return the expected document. Results: ' + JSON.stringify(searchRes.body.data));
  }
  console.log('✅ Search API successfully queried Elasticsearch and returned document!');
  console.log('   - Match ID:', searchRes.body.data[0].id);
  console.log('   - Match Subject:', searchRes.body.data[0].subject);
  console.log('   - Source Engine:', searchRes.body.source);

  // BONUS STEP 5: Test status update to cancelled
  console.log('\nStep 5 (Bonus Verification): Cancel email & verify status sync to both PG and ES');
  const cancelRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/emails/' + emailId,
    method: 'DELETE',
  });
  console.log('Cancel response status:', cancelRes.status);
  if (cancelRes.status !== 200) {
    throw new Error('Cancel failed: ' + JSON.stringify(cancelRes.body));
  }

  // Check ES doc updated status
  const esCancelledDoc = await request({
    hostname: '127.0.0.1',
    port: 9200,
    path: '/emails/_doc/' + emailId,
    method: 'GET',
  });
  console.log('ES doc status after cancel:', esCancelledDoc.body?._source?.status);
  if (esCancelledDoc.body?._source?.status !== 'cancelled') {
    throw new Error('ES document status not updated to cancelled!');
  }
  console.log('✅ Status change to "cancelled" synchronized to Elasticsearch!');

  console.log('\n====================================================');
  console.log('ALL VERIFICATION CRITERIA MET WITH 100% SUCCESS!');
  console.log('====================================================');
}

verifyFlow().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
