# ReachInbox Email Scheduler

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.3-cyan.svg)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-lightgrey.svg)](https://expressjs.com/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.41-red.svg)](https://bullmq.io/)
[![Redis](https://img.shields.io/badge/Redis-7-dc382d.svg)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg)](https://tailwindcss.com/)

A resilient, distributed, full-stack **Email Job Scheduler and Outbound Campaign Platform** built with **React, Node.js/Express, TypeScript, BullMQ, Redis, and PostgreSQL**. The platform allows users to compose, schedule (relative delay or exact datetime), batch-stagger, rate-limit, monitor, and deliver transactional and marketing emails at scale with persistence and zero-loss guarantees.

---

## Table of Contents

- [1. Project Overview](#1-project-overview)
- [2. Features](#2-features)
- [3. Tech Stack](#3-tech-stack)
- [4. System Architecture](#4-system-architecture)
- [5. Project Structure](#5-project-structure)
- [6. Core Email Scheduling Flow](#6-core-email-scheduling-flow)
- [7. Authentication](#7-authentication)
- [8. API Overview](#8-api-overview)
- [9. Installation and Setup Instructions](#9-installation-and-setup-instructions)
- [10. Environment Variables](#10-environment-variables)
- [11. Running the Application](#11-running-the-application)
- [12. Dashboard Statistics](#12-dashboard-statistics)
- [13. Testing / Verification](#13-testing--verification)
- [14. Security Considerations](#14-security-considerations)
- [15. Limitations / Demo Notes](#15-limitations--demo-notes)
- [16. Future Improvements](#16-future-improvements)

---

## 1. Project Overview

**ReachInbox Email Scheduler** is an enterprise-grade email scheduling application designed to solve common outbound email delivery challenges:
- **Asynchronous Delayed Processing**: Emails are queued with delay offsets or target timestamps, buffered in Redis, and executed by independent BullMQ workers.
- **Resilient Persistence**: Email metadata and state transitions (`scheduled` $\rightarrow$ `processing` $\rightarrow$ `sent` / `failed` / `cancelled`) are stored in PostgreSQL so scheduled tasks persist across server restarts.
- **Multi-Sender Quota & Rate Limiting**: Enforces strict hourly throughput limits per sender (e.g., 200 emails/hour) using atomic Redis counters and automatic rescheduling rather than dropping messages.
- **Observability & Inspection**: Provides live queue metrics, dynamic countdown timers, a visual Bull Board management interface, and instant rendered Ethereal sandbox previews.
- **Strict Route Protection**: Complete JWT session guard and unauthenticated login splash preventing unauthenticated data access or UI flash.

---

## 2. Features

### Core Implemented Functionality

1. **Flexible Email Scheduling**:
   - **Relative Delays**: Schedule delivery in seconds, minutes, or hours (e.g., +10s, +5m, +1h).
   - **Exact Datetime**: Target specific calendar dates and timestamps via ISO datetime.
2. **Batch & Staggered Scheduling**:
   - Schedule bulk recipient lists via multi-line text or comma/semicolon separation.
   - Built-in staggered delay offsets (e.g., 2s, 5s between recipients) to prevent provider throttling and spam flagging.
3. **Queue Lifecycle & Cancellation**:
   - View scheduled jobs in real time with dynamic countdown clocks ("Sending in 12s").
   - Cancel scheduled emails prior to dispatch (`DELETE /api/emails/:id`), removing the delayed job from BullMQ and marking the database record as `cancelled`.
   - Immediate 1-click retry for failed jobs (`POST /api/emails/:id/retry`).
4. **PostgreSQL Relational Persistence**:
   - Dedicated relational tables (`emails`, `senders`, `users`, `slack_integrations`).
   - Automated bootstrap schema creation on server start without manual SQL file execution.
5. **Redis & BullMQ Delayed Queue**:
   - Backed by Redis Sorted Sets (`zset`) ensuring jobs remain persistent and execute at the exact millisecond when the timer matures.
   - BullMQ worker concurrency of 5 and throttled execution rates.
6. **Bull Board Queue Monitoring**:
   - Embedded Bull Board dashboard at `/admin/queues` displaying real-time job counts across active, delayed, waiting, completed, and failed states.
7. **Multi-Sender Pool Management**:
   - Create, list, and switch between dynamic email sender profiles (`/api/senders`).
   - Default senders automatically provisioned on startup.
8. **Rate Limiting & Never-Drop Rescheduling**:
   - Atomic Redis rate limiter keys formatted as `rate_limit:<senderId>:<YYYY-MM-DDTHH>`.
   - When a sender hits the 200 emails/hour ceiling, jobs are automatically deferred to the top of the next hour window rather than dropped or marked failed.
9. **Slack OAuth Integration & Rate Limit Alerting**:
   - Connect Slack workspaces via OAuth or direct webhook/credentials (`/api/slack/connect`).
   - Automated Slack alerts triggered when a sender exceeds the hourly threshold.
10. **Elasticsearch Indexing & Full-Text Search**:
    - Dual-write indexing of scheduled, sent, and cancelled emails into Elasticsearch.
    - Instant full-text search across recipients, subjects, and body text (`/api/emails/search?q=...`) with seamless PostgreSQL fallback.
11. **Ethereal SMTP Sandbox**:
    - Automatic creation of test SMTP accounts using Ethereal Email.
    - Generates clickable preview URLs (`https://ethereal.email/message/...`) allowing evaluators to inspect HTML email rendering without sending real outbound emails.
12. **Authentication & Session Guard**:
    - Secure JWT token issuance (`HS256`, 7-day expiration).
    - **One-Click Demo Google Login**: Instant token generation and PostgreSQL user persistence for evaluation.
    - **Real Google OAuth 2.0**: Configuration-aware strategy supporting production Google Cloud credentials.
    - Zero-flash initial authentication validation (`GET /api/auth/me`).

---

## 3. Tech Stack

### Frontend
- **Framework**: React 18 (`18.3.1`)
- **Build Tool**: Vite (`6.1.0`)
- **Language**: TypeScript (`5.7.3`)
- **Styling**: TailwindCSS (`3.4.17`), PostCSS, Autoprefixer
- **Icons**: Lucide React (`0.475.0`)
- **Utilities**: `clsx`, `tailwind-merge`

### Backend
- **Runtime**: Node.js (`v18+` / `v20+` / `v22+`)
- **Framework**: Express (`4.21.2`)
- **Language**: TypeScript (`5.7.3`), executed in dev with `tsx` watch mode
- **Validation**: Zod (`3.24.2`) for strict request and environment schema validation
- **Authentication**: `jsonwebtoken` (`9.0.3`) for JWT issuance and verification
- **Security / Utilities**: `cors`, `dotenv`, `rimraf`

### Database
- **Engine**: PostgreSQL 16 (via Docker container or native service)
- **Driver**: Node `pg` Pool (`8.13.3`)
- **Approach**: Pure SQL queries with parameterized inputs, index optimization, and automatic table creation

### Infrastructure & Queue
- **Queue Engine**: BullMQ (`5.41.0`)
- **Broker / Cache**: Redis 7 (`ioredis 5.5.0`)
- **Queue Dashboard**: Bull Board (`@bull-board/api` & `@bull-board/express` `9.10.0`)
- **Search & Indexing**: Elasticsearch 8 (`@elastic/elasticsearch 8.15.0`)

### Email Transport
- **Engine**: Nodemailer (`10.0.3`)
- **Sandbox**: Ethereal Email test accounts with browser preview links

---

## 4. System Architecture

### High-Level Architecture Diagram

```mermaid
flowchart TD
    subgraph Client["Frontend Client (React + Vite)"]
        UI["Dashboard & Composer UI"]
        AuthContext["Auth State (JWT in localStorage)"]
    end

    subgraph BackendApp["Express Backend API (:5000)"]
        AuthMiddleware["JWT requireAuth Middleware"]
        Router["API Router (/api/emails, /senders, /slack)"]
        ZodVal["Zod Schema Validator"]
        DB["PostgreSQL Persistence Layer"]
        QueueMgr["BullMQ Queue Manager"]
        ES["Elasticsearch Service"]
    end

    subgraph Storage["Storage & Infrastructure"]
        PG[("PostgreSQL 16\n(Port 5433:5432)")]
        RedisStore[("Redis 7 Data Store\n(Port 6379)")]
        ESCluster[("Elasticsearch Node\n(Port 9200)")]
    end

    subgraph WorkerLayer["BullMQ Worker Pipeline"]
        Worker["Email Processing Worker\n(Concurrency: 5)"]
        RateLimiter["Redis Hourly Rate Limiter\n(200 emails/hr/sender)"]
        Mailer["Nodemailer Engine"]
        SlackNotifier["Slack Alerting Service"]
    end

    subgraph Output["Delivery Gateways"]
        Ethereal["Ethereal SMTP Sandbox\n(Preview URLs)"]
        SlackHook["Slack Channel Notifications"]
    end

    UI -->|1. Bearer Token Request| AuthMiddleware
    AuthMiddleware --> Router
    Router --> ZodVal
    ZodVal -->|2. Store Record: scheduled| DB
    DB --> PG
    ZodVal -->|3. Index Document| ES
    ES --> ESCluster
    ZodVal -->|4. Add Delayed Job (delayMs)| QueueMgr
    QueueMgr -->|Push to delayed zset| RedisStore

    RedisStore -->|5. Timer Expired -> Job Active| Worker
    Worker -->|6. Check Hourly Usage| RateLimiter
    RateLimiter -.->|Quota Exceeded| QueueMgr
    RateLimiter -.->|Quota Exceeded: Alert| SlackNotifier
    SlackNotifier -.-> SlackHook
    RateLimiter -->|Under Quota: Send| Mailer
    Mailer -->|7. Deliver Email| Ethereal
    Worker -->|8. Update Status: sent + preview_url| DB
```

### Authentication Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend as React Frontend (:5173)
    participant Backend as Express Auth API (:5000)
    participant PG as PostgreSQL
    participant AppAPI as Protected Endpoints

    User->>Frontend: Clicks "One-Click Demo Google Login"
    Frontend->>Backend: POST /api/auth/mock-login
    Backend->>PG: Upsert Google/Demo User record
    PG-->>Backend: Confirmed User Record
    Backend->>Backend: Sign JWT with user payload (7d expiry)
    Backend-->>Frontend: HTTP 200 { user, token }
    Frontend->>Frontend: Store token in localStorage
    Frontend->>Backend: GET /api/auth/me (Authorization: Bearer <token>)
    Backend-->>Frontend: Valid Session Confirmed
    Frontend->>Frontend: Unlocks Dashboard UI & Initiates Data Polling
    Frontend->>AppAPI: GET /api/emails/stats (Authorization: Bearer <token>)
    AppAPI-->>Frontend: HTTP 200 Dashboard Statistics
```

---

## 5. Project Structure

```
reachinbox-email-scheduler/
├── docker-compose.yml              # PostgreSQL, Redis, Elasticsearch containers
├── package.json                    # Root workspace orchestration scripts
├── README.md                       # Comprehensive project documentation
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.ts               # PostgreSQL connection pool & resilient query layer
│   │   │   ├── env.ts              # Zod environment variable parsing
│   │   │   └── redis.ts            # ioredis & BullMQ connection setup
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts  # Google OAuth, mock-login, session handlers
│   │   │   ├── email.controller.ts # Scheduling, batch, history, cancellation, stats
│   │   │   ├── sender.controller.ts# Multi-sender management handlers
│   │   │   ├── slack.controller.ts # Slack OAuth, webhook, and test alerting
│   │   │   └── health.controller.ts# Service health check
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.ts  # JWT Bearer token authentication guard
│   │   │   └── errorHandler.ts     # Global Express error handler
│   │   ├── routes/
│   │   │   ├── auth.routes.ts      # Authentication endpoints
│   │   │   ├── email.routes.ts     # Protected email scheduling routes
│   │   │   ├── sender.routes.ts    # Protected sender management routes
│   │   │   ├── slack.routes.ts     # Slack integration routes
│   │   │   └── index.ts            # Root API router
│   │   ├── services/
│   │   │   ├── auth.service.ts     # JWT signing, verification, and OAuth service
│   │   │   ├── elasticsearch.service.ts # Dual-write search indexing
│   │   │   ├── mailer.service.ts   # Nodemailer and Ethereal sandbox provider
│   │   │   ├── queue.service.ts    # BullMQ Queue instance, Bull Board setup
│   │   │   └── slack.service.ts    # Slack incoming webhook & OAuth client
│   │   ├── workers/
│   │   │   └── email.worker.ts     # BullMQ Worker processor & rate limit guard
│   │   ├── app.ts                  # Express application configuration
│   │   └── server.ts               # Bootstrap, sender provisioning, server startup
│   ├── package.json
│   ├── tsconfig.json
│   └── verify-*.js                 # Automated standalone verification test suites
└── frontend/
    ├── src/
    │   ├── App.tsx                 # Full-featured dashboard, composer, and views
    │   ├── main.tsx                # React DOM entrypoint
    │   └── index.css               # Tailwind directives & typography
    ├── package.json
    ├── vite.config.ts              # Vite configuration with /api reverse proxy
    └── tailwind.config.js          # Tailwind CSS theme extensions
```

---

## 6. Core Email Scheduling Flow

The complete lifecycle of an email in ReachInbox Email Scheduler proceeds as follows:

1. **Authentication**: The client authenticates via One-Click Demo or Google OAuth, receiving a signed JWT stored in `localStorage`.
2. **Composition & Scheduling**: The user fills the email composer, specifying recipient, subject, HTML body, sender ID, and either a relative delay (e.g., 30s) or exact ISO datetime.
3. **API Dispatch**: The frontend calls `POST /api/emails/schedule` with `Authorization: Bearer <token>`.
4. **Validation & Persistence**:
   - `requireAuth` middleware verifies the JWT and loads the user from PostgreSQL.
   - Zod validates the email payload and verifies that the selected sender exists in PostgreSQL.
   - A new row is inserted into PostgreSQL `emails` table with status `'scheduled'`.
   - The document is dual-written to the Elasticsearch `emails` index.
5. **BullMQ Job Creation**: The backend enqueues a job into BullMQ (`email-scheduler-queue`) with `{ delay: delayMs, jobId: email.id }`.
6. **Delayed State in Redis**: The job sits in Redis Delayed Sorted Sets (`wait` / `delayed`), where BullMQ monitors the timer maturity.
7. **Worker Processing**: When the scheduled time arrives, the BullMQ worker dequeues the job and updates PostgreSQL status to `'processing'`.
8. **Rate Limit Check**: The worker checks the sender's hourly quota in Redis:
   - If usage $\ge 200$ emails/hour, the job is deferred to the start of the next hour window, status remains `'scheduled'`, and an automated Slack notification is emitted.
   - If usage $< 200$, the hourly counter is incremented atomically (`INCR`) with an hourly TTL.
9. **Dispatch via Nodemailer**: The email is delivered via Nodemailer to the Ethereal sandbox. Nodemailer returns an ethereal preview URL.
10. **State Finalization**:
    - PostgreSQL is updated to status `'sent'`, recording `sent_at` and `preview_url`.
    - Elasticsearch status is synchronized to `'sent'`.
    - Dashboard statistics update: **Scheduled Queue** decrements and **Delivered** increments.

---

## 7. Authentication

### JWT Architecture
- All sensitive API routes require an `Authorization: Bearer <token>` header.
- Tokens are signed with `jsonwebtoken` using `JWT_SECRET` with a default lifespan of 7 days (`JWT_EXPIRES_IN=7d`).
- The payload contains:
  ```json
  {
    "userId": "usr_1789060563919_vmyy6",
    "email": "alex.founder@reachinbox.ai",
    "name": "Alex Founder",
    "iat": 1789060563,
    "exp": 1789665363
  }
  ```

### Protected Route Matrix

| Route Group | Endpoints | Access |
| :--- | :--- | :--- |
| `/api/auth/me` | Current session inspection | **Protected** (Bearer JWT) |
| `/api/emails/*` | Schedule, batch, cancel, retry, stats, search | **Protected** (Bearer JWT) |
| `/api/senders/*`| List, create, provision senders | **Protected** (Bearer JWT) |
| `/api/slack/*`  | Status, connect, test alert, disconnect | **Protected** (Bearer JWT) |
| `/api/health`   | Server health check | **Public** |
| `/api/auth/google/*` | OAuth redirection and callback | **Public** |
| `/api/auth/mock-login` | One-Click Demo evaluation login | **Public** |
| `/api/slack/oauth/callback` | Browser Slack OAuth callback | **Public** |

### Google OAuth vs. One-Click Demo Login

- **Real Google OAuth**:
  - Requires valid Google Cloud credentials (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`) configured in `backend/.env`.
  - The application inspects these variables at boot. If missing, the frontend automatically marks the "Continue with Google OAuth" button as disabled (`Config Required`) to prevent Google `401: invalid_client` errors.
- **One-Click Demo Google Login**:
  - Provides a frictionless way for evaluators and interviewers to test the full authenticated dashboard immediately.
  - Generates a valid JWT, creates/upserts a persistent user record in PostgreSQL, and issues session tokens identical to real OAuth logins.

---

## 8. API Overview

| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| **Authentication** | | | |
| `/api/auth/mock-login` | `POST` | Public | Instant One-Click Demo authentication |
| `/api/auth/google/login` | `GET` | Public | Redirects user to Google OAuth consent screen |
| `/api/auth/google/callback` | `GET` | Public | Handles OAuth redirect, issues JWT token |
| `/api/auth/me` | `GET` | Bearer | Validates session token & returns user profile |
| `/api/auth/logout` | `POST` | Public | Terminates session |
| **Email Scheduling** | | | |
| `/api/emails/schedule` | `POST` | Bearer | Schedule a single email with delay or datetime |
| `/api/emails/batch` | `POST` | Bearer | Schedule a batch of emails with staggered offsets |
| `/api/emails/scheduled`| `GET` | Bearer | List currently pending scheduled emails |
| `/api/emails/history` | `GET` | Bearer | List delivered, failed, and cancelled emails |
| `/api/emails/search` | `GET` | Bearer | Full-text search email history via Elasticsearch |
| `/api/emails/stats` | `GET` | Bearer | Database and BullMQ queue metric statistics |
| `/api/emails/:id` | `DELETE` | Bearer | Cancel and remove a pending scheduled job |
| `/api/emails/:id/retry` | `POST` | Bearer | Re-queue a failed email for immediate retry |
| **Sender Management** | | | |
| `/api/senders` | `GET` | Bearer | List all configured email senders |
| `/api/senders` | `POST` | Bearer | Create a new persistent email sender |
| `/api/senders/provision` | `POST` | Bearer | Seed default outreach team senders |
| **Slack Integration** | | | |
| `/api/slack/status` | `GET` | Bearer | Check Slack workspace connection status |
| `/api/slack/connect` | `POST` | Bearer | Save webhook or Slack OAuth credentials |
| `/api/slack/test` | `POST` | Bearer | Send test alert notification to Slack |
| `/api/slack/disconnect` | `POST` | Bearer | Deactivate active Slack integration |
| **System & Monitoring** | | | |
| `/api/health` | `GET` | Public | Service health check |
| `/admin/queues` | `GET` | Public | Bull Board interactive queue dashboard |

---

## 9. Installation and Setup Instructions

### Prerequisites
- **Node.js**: `v18.x`, `v20.x`, or `v22.x`
- **Docker & Docker Compose** (recommended for supporting databases)
- **npm**: `v9.x` or higher

---

### Step-by-Step Setup

#### 1. Clone the Repository
```bash
git clone <repository-url>
cd reachinbox-email-scheduler
```

#### 2. Start Infrastructure Containers
Use Docker Compose to launch PostgreSQL, Redis, and Elasticsearch:
```bash
docker compose up -d
```
> [!NOTE]
> PostgreSQL is exposed on host port **`5433`** (mapped to container port `5432`) to prevent conflicts with any native PostgreSQL server installed on port 5432. Redis runs on **`6379`**, and Elasticsearch runs on **`9200`**.

Verify containers are healthy:
```bash
docker compose ps
```

#### 3. Install Dependencies
Install dependencies for both backend and frontend:
```bash
npm --prefix backend install
npm --prefix frontend install
```
*(Or run `npm install` from the root directory).*

#### 4. Configure Environment Variables
Copy the example environment templates:
```bash
# Backend configuration
cp backend/.env.example backend/.env

# Frontend configuration
cp frontend/.env.example frontend/.env
```

#### 5. Database Schema Initialization
No manual SQL files need to be run. When the backend starts, [`backend/src/config/db.ts`](file:///c:/Users/Asus/OneDrive/Desktop/Assessments/reachinbox-email-scheduler/backend/src/config/db.ts) automatically verifies and creates the required database tables (`emails`, `senders`, `users`, `slack_integrations`) and provisioned senders.

#### 6. Run the Application

You can start both frontend and backend concurrently from the root directory:
```bash
npm run dev
```

Or start each service in separate terminals:

**Terminal 1 (Backend Server)**:
```bash
cd backend
npm run dev
```
*Backend runs at `http://localhost:5000`.*

**Terminal 2 (Frontend Dashboard)**:
```bash
cd frontend
npm run dev
```
*Frontend runs at `http://localhost:5173`.*

---

## 10. Environment Variables

### Backend Configuration (`backend/.env`)

| Variable | Description | Default / Example | Required |
| :--- | :--- | :--- | :---: |
| `PORT` | Express server HTTP port | `5000` | Yes |
| `NODE_ENV` | Application environment mode | `development` | Yes |
| `CLIENT_URL` | Frontend origin for CORS and OAuth redirects | `http://localhost:5173` | Yes |
| `DATABASE_URL` | PostgreSQL connection URI | `postgresql://postgres:postgres@localhost:5433/email_scheduler` | Yes |
| `POSTGRES_HOST` | PostgreSQL host | `localhost` | Yes |
| `POSTGRES_PORT` | PostgreSQL host port (mapped from container) | `5433` | Yes |
| `POSTGRES_USER` | PostgreSQL username | `postgres` | Yes |
| `POSTGRES_PASSWORD` | PostgreSQL password | `postgres` | Yes |
| `POSTGRES_DB` | PostgreSQL database name | `email_scheduler` | Yes |
| `REDIS_URL` | Redis connection URI for BullMQ | `redis://localhost:6379` | Yes |
| `JWT_SECRET` | Secret key used to sign session tokens | `reachinbox_email_scheduler_jwt_secret_key_2026` | Yes |
| `JWT_EXPIRES_IN` | JWT token validity duration | `7d` | Yes |
| `WORKER_CONCURRENCY` | BullMQ worker concurrency | `5` | No |
| `MIN_EMAIL_DELAY_SECONDS` | Minimum delay offset | `2` | No |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Hourly limit quota per sender | `200` | No |
| `ELASTICSEARCH_NODE` | Elasticsearch cluster endpoint | `http://localhost:9200` | No |
| `ELASTICSEARCH_INDEX`| Index name for emails | `emails` | No |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth Client ID | *(Leave empty for Demo Login)* | Only for Real Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth Client Secret | *(Leave empty for Demo Login)* | Only for Real Google OAuth |
| `GOOGLE_REDIRECT_URI` | Google OAuth redirect callback | `http://localhost:5000/api/auth/google/callback` | Only for Real Google OAuth |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | *(Optional Slack alerts)* | No |

---

## 11. Running the Application

### Application URLs
- **Web Dashboard**: `http://localhost:5173`
- **Backend API Root**: `http://localhost:5000`
- **Health Check**: `http://localhost:5000/api/health`
- **Bull Board Queue Dashboard**: `http://localhost:5000/admin/queues`

### How to Authenticate
1. Open **`http://localhost:5173`**.
2. If unauthenticated, the application displays the login card.
3. Click **"One-Click Demo Google Login"** for instantaneous evaluation access.
4. If you have configured your own Google Cloud project credentials in `backend/.env`, the **"Continue with Real Google OAuth"** button will be active.

---

## 12. Dashboard Statistics

The dashboard metrics are calculated from the PostgreSQL database source of truth:

| Metric | Source Calculation | Definition |
| :--- | :--- | :--- |
| **Scheduled Queue** | `COUNT(*) FILTER (WHERE status = 'scheduled')` | Exact count of emails currently pending execution or delayed in the pipeline. |
| **Delivered** | `COUNT(*) FILTER (WHERE status = 'sent')` | Successfully processed emails delivered through the SMTP transport. |
| **Failed** | `COUNT(*) FILTER (WHERE status = 'failed')` | Emails that encountered permanent delivery errors after retries. |
| **Total Processed** | `COUNT(*) FILTER (WHERE status IN ('sent', 'failed'))` | **Strictly defined as $\text{Delivered} + \text{Failed}$.** Pending scheduled emails and cancelled emails are excluded from this metric. |

### Lifecycle Consistency Guarantee:
- When an email is scheduled, **Scheduled Queue** increases by 1; **Total Processed** remains unchanged.
- When an email is delivered, **Scheduled Queue** decreases by 1, and **Delivered** increases by 1.
- If delivery fails, **Failed** increases by 1.
- **Total Processed** increases only when an email reaches a terminal outcome (`sent` or `failed`).

---

## 13. Testing / Verification

The repository includes standalone automated test suites in `backend/` verifying every architectural layer:

```bash
cd backend
```

| Command / Script | Target Layer | Verification Details |
| :--- | :--- | :--- |
| `npm run test:auth`<br>`node verify-auth.js` | Google Auth & JWT | Tests token generation, signature verification, PostgreSQL user persistence, and unconfigured credential rejection. |
| `node verify-auth-flow-e2e.js` | Route Guard E2E | Tests all 7 security requirements: public health access, 401 rejection across all protected endpoints, demo login, session restore, bad token rejection. |
| `node verify-stats-consistency.js` | Stats Consistency | Verifies that `Total Processed = Delivered + Failed` across initial, pending, and delivered states. |
| `npm run test:senders`<br>`node verify-senders.js` | Multi-Sender Pool | Tests creating dynamic senders, scheduling with specific sender IDs, and verifying PostgreSQL sender foreign key associations. |
| `npm run test:ratelimit`<br>`node verify-ratelimit.js` | Rate Limiting | Simulates a sender reaching the 200/hr limit and confirms the Never-Drop rule: email is deferred to the next hour window without being dropped. |
| `npm run test:slack`<br>`node verify-slack.js` | Slack Alerting | Tests Slack connection status, dispatching test alert messages, and automated alerting on hourly rate-limit trigger. |
| `npm run test:bullboard`<br>`node verify-bullboard.js` | BullMQ & Bull Board | Tests `/admin/queues` HTML rendering, enqueuing delayed job, and observing lifecycle state progression (`delayed` $\rightarrow$ `completed`). |
| `npm run test:e2e`<br>`node verify-flow.js` | Search & Sync | Tests end-to-end scheduling, PostgreSQL storage, Elasticsearch document indexing, search queries, and cancel synchronization. |

### Build Validation
```bash
# Validate Backend TypeScript build
npm --prefix backend run build

# Validate Frontend Vite production build
npm --prefix frontend run build
```

---

## 14. Security Considerations

- **Strict JWT Middleware**: All mutation and data endpoints are guarded by `requireAuth` checking `Authorization: Bearer <token>`. Invalid or absent tokens receive HTTP `401 Unauthorized`.
- **SQL Injection Prevention**: All database queries in `db.ts` use parameterized SQL statements (`$1`, `$2`, etc.) via node-postgres.
- **Credential Hygiene**: No hardcoded API keys, client secrets, or database passwords exist in source code. All secrets are read from environment variables validated via Zod.
- **Client-Side Session Handling**: Tokens are kept in client storage and automatically cleared upon 401 responses to prevent stale session exploits.
- **Protected Bull Board**: Bull Board runs on the Express server with direct queue access.

---

## 15. Limitations / Demo Notes

- **Google OAuth Credentials**: Real Google OAuth requires registering an OAuth 2.0 Client ID in the Google Cloud Console with the redirect URI `http://localhost:5000/api/auth/google/callback`. For instant review without Google Cloud setup, use **One-Click Demo Google Login**.
- **Ethereal Sandbox Transport**: Nodemailer uses Ethereal Email to generate preview URLs. These emails are safely captured in the sandbox and are not sent to real recipient inboxes.
- **Host Port 5433**: PostgreSQL runs on host port `5433` (mapped to container port `5432`) to avoid collisions with any local PostgreSQL service on the developer's workstation.

---

## 16. Future Improvements

- **Production Email Gateways**: Pluggable adapters for Amazon SES, SendGrid, Resend, and Postmark with bounce webhook processing.
- **Role-Based Access Control (RBAC)**: Team workspaces with granular permissions (Admin, Member, Viewer).
- **Template Builder**: Visual drag-and-drop MJML email builder with dynamic merge tags (`{{firstName}}`).
- **Advanced Campaign Analytics**: Open and click tracking via tracking pixels and URL redirection proxies.
