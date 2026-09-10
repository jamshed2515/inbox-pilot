const http = require('http');
const { Pool } = require('pg');

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
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
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runMultiSenderVerification() {
  console.log('================================================================');
  console.log('STARTING MULTI-SENDER VERIFICATION TEST');
  console.log('================================================================\n');

  // STEP 1: Create/Provision Sender 1 & Sender 2
  console.log('Step 1: Creating two distinct persistent senders via API...');
  
  const sender1Res = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/senders',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      name: 'Alpha Outreach Engine',
      email: `alpha.${Date.now()}@outreach.reachinbox.io`,
      is_default: false,
    }
  );

  if (sender1Res.status !== 201) {
    throw new Error('Failed to create Sender 1: ' + JSON.stringify(sender1Res.body));
  }
  const sender1 = sender1Res.body.data;
  console.log('✅ Sender 1 Created:');
  console.log('   - ID:', sender1.id);
  console.log('   - Name:', sender1.name);
  console.log('   - Email:', sender1.email);

  const sender2Res = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/senders',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      name: 'Beta Executive Concierge',
      email: `beta.${Date.now()}@concierge.reachinbox.io`,
      is_default: false,
    }
  );

  if (sender2Res.status !== 201) {
    throw new Error('Failed to create Sender 2: ' + JSON.stringify(sender2Res.body));
  }
  const sender2 = sender2Res.body.data;
  console.log('✅ Sender 2 Created:');
  console.log('   - ID:', sender2.id);
  console.log('   - Name:', sender2.name);
  console.log('   - Email:', sender2.email);

  // STEP 2: Schedule email from Sender 1
  console.log('\nStep 2: Scheduling Email 1 using Sender 1 (' + sender1.name + ')...');
  const email1Res = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/schedule',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      senderId: sender1.id,
      recipient: 'lead.alpha@customer-enterprise.com',
      subject: 'Quarterly Strategic Partnership Opportunity',
      body: 'Hi, reaching out from Alpha Outreach Engine regarding our Q4 integration.',
      delaySeconds: 0, // Queue for immediate dispatch
    }
  );

  if (email1Res.status !== 201) {
    throw new Error('Failed to schedule Email 1: ' + JSON.stringify(email1Res.body));
  }
  const email1 = email1Res.body.data.email;
  console.log('✅ Email 1 scheduled: ID = ' + email1.id + ', Sender ID = ' + email1.sender_id);

  // STEP 3: Schedule email from Sender 2
  console.log('\nStep 3: Scheduling Email 2 using Sender 2 (' + sender2.name + ')...');
  const email2Res = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/schedule',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      senderId: sender2.id,
      recipient: 'vip.beta@client-corporation.com',
      subject: 'Personal Invitation: Executive Roundtable',
      body: 'Greetings, this is an exclusive invitation from the Beta Executive Concierge team.',
      delaySeconds: 0, // Queue for immediate dispatch
    }
  );

  if (email2Res.status !== 201) {
    throw new Error('Failed to schedule Email 2: ' + JSON.stringify(email2Res.body));
  }
  const email2 = email2Res.body.data.email;
  console.log('✅ Email 2 scheduled: ID = ' + email2.id + ', Sender ID = ' + email2.sender_id);

  // STEP 4: Verify PostgreSQL persistence for both emails and sender_id association
  console.log('\nStep 4: Verifying PostgreSQL persistence & sender_id associations...');
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/email_scheduler' });
  
  const pgEmail1 = (await pool.query('SELECT * FROM emails WHERE id = $1', [email1.id])).rows[0];
  const pgEmail2 = (await pool.query('SELECT * FROM emails WHERE id = $1', [email2.id])).rows[0];

  if (!pgEmail1 || pgEmail1.sender_id !== sender1.id) {
    throw new Error(`PostgreSQL validation failed for Email 1: expected sender_id ${sender1.id}, got ${pgEmail1?.sender_id}`);
  }
  if (!pgEmail2 || pgEmail2.sender_id !== sender2.id) {
    throw new Error(`PostgreSQL validation failed for Email 2: expected sender_id ${sender2.id}, got ${pgEmail2?.sender_id}`);
  }
  console.log('✅ PostgreSQL verified:');
  console.log(`   - Email 1 (${pgEmail1.id}) mapped to Sender: ${pgEmail1.sender_id}`);
  console.log(`   - Email 2 (${pgEmail2.id}) mapped to Sender: ${pgEmail2.sender_id}`);
  await pool.end();

  // STEP 5: Verify Elasticsearch document indexing includes sender_id
  console.log('\nStep 5: Verifying Elasticsearch document indexing & sender_id...');
  const esDoc1 = await request({
    hostname: '127.0.0.1',
    port: 9200,
    path: '/emails/_doc/' + email1.id,
    method: 'GET',
  });
  const esDoc2 = await request({
    hostname: '127.0.0.1',
    port: 9200,
    path: '/emails/_doc/' + email2.id,
    method: 'GET',
  });

  if (!esDoc1.body?.found || esDoc1.body?._source?.sender_id !== sender1.id) {
    throw new Error('Elasticsearch check failed for Email 1: ' + JSON.stringify(esDoc1.body));
  }
  if (!esDoc2.body?.found || esDoc2.body?._source?.sender_id !== sender2.id) {
    throw new Error('Elasticsearch check failed for Email 2: ' + JSON.stringify(esDoc2.body));
  }
  console.log('✅ Elasticsearch verified:');
  console.log(`   - Doc 1 sender_id: ${esDoc1.body._source.sender_id} (matches Sender 1)`);
  console.log(`   - Doc 2 sender_id: ${esDoc2.body._source.sender_id} (matches Sender 2)`);

  // STEP 6: Wait for BullMQ worker to deliver both emails through Nodemailer/Ethereal
  console.log('\nStep 6: Waiting for worker delivery via Nodemailer/Ethereal...');
  let attempts = 0;
  let sentEmail1 = null;
  let sentEmail2 = null;

  while (attempts < 20) {
    await sleep(1500);
    attempts++;
    const check1 = await request({
      hostname: '127.0.0.1',
      port: 9200,
      path: '/emails/_doc/' + email1.id,
      method: 'GET',
    });
    const check2 = await request({
      hostname: '127.0.0.1',
      port: 9200,
      path: '/emails/_doc/' + email2.id,
      method: 'GET',
    });

    if (check1.body?._source?.status === 'sent' && check2.body?._source?.status === 'sent') {
      sentEmail1 = check1.body._source;
      sentEmail2 = check2.body._source;
      break;
    }
    process.stdout.write('.');
  }

  if (!sentEmail1 || !sentEmail2) {
    throw new Error('Emails did not complete delivery within the timeout window.');
  }

  console.log('\n✅ Both emails delivered successfully via Nodemailer:');
  console.log(`   - Email 1 (From: ${sender1.name}) Preview: ${sentEmail1.preview_url}`);
  console.log(`   - Email 2 (From: ${sender2.name}) Preview: ${sentEmail2.preview_url}`);

  // STEP 7: Test scheduling without senderId to verify default sender preservation
  console.log('\nStep 7: Verifying backward compatibility (scheduling with omitted senderId)...');
  const defaultEmailRes = await request(
    {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/emails/schedule',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      recipient: 'backward.compat@test.com',
      subject: 'Default Sender Fallback Test',
      body: 'Testing that omitting senderId automatically resolves the default sender.',
      delaySeconds: 60,
    }
  );
  if (defaultEmailRes.status !== 201) {
    throw new Error('Default schedule failed: ' + JSON.stringify(defaultEmailRes.body));
  }
  const defaultEmail = defaultEmailRes.body.data.email;
  console.log('✅ Backward compatibility verified: Email assigned default sender_id: ' + defaultEmail.sender_id);

  console.log('\n================================================================');
  console.log('ALL MULTI-SENDER TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runMultiSenderVerification().catch((err) => {
  console.error('\n❌ Multi-sender verification failed:', err);
  process.exit(1);
});
