// Phase G Verification: BullMQ Dashboard (Bull Board) & Queue Lifecycle
require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const BASE_URL = 'http://localhost:5000';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/email_scheduler';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = new Redis(REDIS_URL);
const queue = new Queue('email-scheduler-queue', { connection: redis });

let authToken = '';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
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
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
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
    email: 'verifier.bullboard@reachinbox.ai',
    name: 'Bull Board Verifier',
  });
  authToken = res.body?.data?.token || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('===========================================================');
  console.log('    PHASE G: BULLMQ DASHBOARD (BULL BOARD) TEST SUITE     ');
  console.log('===========================================================');

  try {
    await authenticateVerifier();

    // 1. Verify Bull Board UI Endpoint (/admin/queues)
    console.log('\n[TEST 1] Testing Bull Board endpoint availability (/admin/queues)...');
    const boardRes = await request('GET', '/admin/queues');
    console.log('Bull Board HTTP Status:', boardRes.status);
    console.log('Content-Type:', boardRes.headers['content-type']);
    if (boardRes.status !== 200 || !boardRes.raw || !boardRes.raw.includes('<!DOCTYPE html>')) {
      throw new Error('Bull Board endpoint /admin/queues did not return HTML dashboard');
    }
    console.log('✅ Bull Board UI dashboard successfully rendered and serving HTML.');

    // 2. Schedule email with a 3-second delay
    console.log('\n[TEST 2] Step: User schedules email with 3s delay...');
    const scheduleRes = await request('POST', '/api/emails/schedule', {
      recipient: 'bullboard.test@reachinbox.ai',
      subject: 'Bull Board Real-Time Lifecycle Test',
      body: '<p>Testing delayed to completed transition in BullMQ.</p>',
      delaySeconds: 3,
    });
    console.log('Schedule Response Status:', scheduleRes.status);
    const emailData = scheduleRes.body.data.email;
    const jobId = scheduleRes.body.data.jobId;
    console.log(`Scheduled Email ID: ${emailData.id} | BullMQ Job ID: ${jobId}`);

    // 3. Verify PostgreSQL stores email
    console.log('\n[TEST 3] Step: PostgreSQL stores email...');
    const pgRes = await pool.query('SELECT * FROM emails WHERE id = $1', [emailData.id]);
    if (pgRes.rowCount === 0) throw new Error('Email not found in PostgreSQL');
    console.log(`✅ PostgreSQL record confirmed (Status: ${pgRes.rows[0].status}).`);

    // 4. Verify BullMQ creates delayed job & Bull Board shows job
    console.log('\n[TEST 4] Step: BullMQ creates delayed job & Bull Board shows job...');
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`BullMQ job ${jobId} not found in queue`);
    const initialState = await job.getState();
    console.log(`BullMQ Initial Job State: "${initialState}"`);
    if (initialState !== 'delayed') {
      throw new Error(`Expected initial state to be "delayed", got "${initialState}"`);
    }
    console.log('✅ BullMQ delayed job successfully created and active in queue.');

    // 5. Wait for scheduled time to arrive and worker to process
    console.log('\n[TEST 5] Step: Waiting for scheduled delay to expire and worker to process job...');
    let finishedState = await job.getState();
    const startTime = Date.now();
    while (finishedState !== 'completed' && Date.now() - startTime < 15000) {
      process.stdout.write(`Current BullMQ Job State: "${finishedState}"...\r`);
      await sleep(1000);
      finishedState = await job.getState();
    }
    console.log(`\nBullMQ Final Job State: "${finishedState}"`);

    // 6. Verify job completes
    console.log('\n[TEST 6] Step: Verifying job completed in BullMQ & Bull Board...');
    if (finishedState !== 'completed') {
      throw new Error(`Expected final state to be "completed", got "${finishedState}"`);
    }
    console.log('✅ BullMQ job successfully moved to "completed" state.');

    // 7. Verify email status = sent in PostgreSQL
    console.log('\n[TEST 7] Step: Verifying email status = sent in PostgreSQL...');
    const finalPgRes = await pool.query('SELECT * FROM emails WHERE id = $1', [emailData.id]);
    const finalEmail = finalPgRes.rows[0];
    console.log(`Email ID ${finalEmail.id} Final Status: ${finalEmail.status}`);
    console.log(`Delivered Preview URL: ${finalEmail.preview_url}`);
    if (finalEmail.status !== 'sent') {
      throw new Error(`Expected email status to be "sent", got "${finalEmail.status}"`);
    }
    console.log('✅ Email status = sent verified in PostgreSQL.');

    console.log('\n===========================================================');
    console.log('   🎉 FULL QUEUE LIFECYCLE DEMOSTRATION VERIFIED!         ');
    console.log('   Scheduled -> Delayed -> Worker -> Completed -> Sent    ');
    console.log('===========================================================');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    await queue.close();
    redis.disconnect();
    await pool.end();
  }
}

runTests();
