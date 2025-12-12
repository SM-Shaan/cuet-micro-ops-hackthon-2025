# Long-Running Download Architecture Design

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Implementation Details](#implementation-details)
6. [API Contracts](#api-contracts)
7. [Observability Stack](#observability-stack)
8. [Docker & Deployment](#docker--deployment)
9. [Frontend Integration](#frontend-integration)
10. [Error Handling & Resilience](#error-handling--resilience)

---

## Problem Statement

The download microservice handles file operations with variable processing times:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Download Processing Time                            │
├─────────────────────────────────────────────────────────────────────────┤
│ Fast Downloads    ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ~5-15s    │
│ Medium Downloads  ████████████████████░░░░░░░░░░░░░░░░░░░░   ~30-60s   │
│ Slow Downloads    ████████████████████████████████████████   ~60-120s  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Critical Issues Behind Reverse Proxies

| Problem             | Impact                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| Connection Timeouts | Cloudflare (100s), nginx (60s default), AWS ALB (60s) terminate requests |
| Gateway Errors      | Users see 504/502 errors for slow downloads                              |
| Poor UX             | No feedback during 2+ minute waits                                       |
| Resource Exhaustion | Open HTTP connections consume server memory                              |
| Retry Storms        | Dropped connections trigger duplicate processing                         |

### Solution: Async Polling Pattern

This project implements an **async/polling architecture** where:

- Client initiates download → receives `jobId` immediately (< 100ms)
- Background process handles the actual work
- Client polls for status updates with progress feedback
- Redis stores job state with TTL for distributed consistency

---

## Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ HealthStatus │    │DownloadTester│    │ DownloadJobs │    │  ErrorLog    │       │
│  │   Component  │    │  Component   │    │  Component   │    │  Component   │       │
│  └──────────────┘    └──────┬───────┘    └──────────────┘    └──────────────┘       │
│                             │                                                        │
│  ┌──────────────┐    ┌──────┴───────┐    ┌──────────────┐                           │
│  │ Performance  │    │  TraceViewer │    │   Sentry &   │                           │
│  │   Metrics    │    │  Component   │    │   OTEL Libs  │                           │
│  └──────────────┘    └──────────────┘    └──────────────┘                           │
└────────────┬───────────────┬───────────────────────────────────────────────────────-┘
             │               │
             │ POST          │ GET
             │ /v1/download  │ /v1/download
             │ /start        │ /status/{userId}
             ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           NGINX API GATEWAY (Port 80)                               │
│                          ┌─────────────────────────────┐                            │
│                          │  - Route: /api/* → Backend  │                            │
│                          │  - Route: /* → Frontend     │                            │
│                          │  - Timeouts: 5s/30s/30s     │                            │
│                          │  - WebSocket support        │                            │
│                          └─────────────────────────────┘                            │
└────────────────────────────────────┬────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              API SERVER (Hono + Node.js)                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           Request Handlers                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │   │
│  │  │ POST         │  │ GET          │  │ POST         │  │ GET          │     │   │
│  │  │ /v1/download │  │ /v1/download │  │ /v1/download │  │ /health      │     │   │
│  │  │ /start       │  │ /status/:uid │  │ /check       │  │              │     │   │
│  │  │ Returns:<5s  │  │ Returns:<1s  │  │ S3 HEAD      │  │ S3 Status    │     │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │   │
│  └─────────┼─────────────────┼─────────────────┼─────────────────┼─────────────┘   │
│            │                 │                 │                 │                  │
│            ▼                 ▼                 ▼                 ▼                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                      Background Job Processor                                │   │
│  │  - Simulated processing delay (5-120s)                                       │   │
│  │  - Progress updates every 1 second                                           │   │
│  │  - Presigned URL generation on completion                                    │   │
│  └──────────────────────────────────┬──────────────────────────────────────────┘   │
└─────────────────────────────────────┼───────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│     Redis Cache      │  │     S3 Storage       │  │   Jaeger Tracing     │
│  ┌────────────────┐  │  │  ┌────────────────┐  │  │  ┌────────────────┐  │
│  │ Job Status     │  │  │  │ RustFS/MinIO   │  │  │  │ OTLP Receiver  │  │
│  │ - queued       │  │  │  │                │  │  │  │                │  │
│  │ - processing   │  │  │  │ downloads/     │  │  │  │ Trace UI       │  │
│  │ - completed    │  │  │  │ ├── 70000.zip  │  │  │  │ Port: 16686    │  │
│  │ - failed       │  │  │  │ ├── 70001.zip  │  │  │  │                │  │
│  │                │  │  │  │ └── ...        │  │  │  │ Query API      │  │
│  │ Key: download: │  │  │  └────────────────┘  │  │  │ Port: 16685    │  │
│  │ TTL: 1 hour    │  │  │                      │  │  └────────────────┘  │
│  └────────────────┘  │  │  Presigned URLs      │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

### Request Flow Diagram

#### Download Start Flow (Async Pattern)

```
Client              Gateway           API                Redis              S3
  │                   │                │                   │                 │
  │ POST /api/v1/     │                │                   │                 │
  │ download/start    │                │                   │                 │
  │ {file_id, user_id}│                │                   │                 │
  │──────────────────▶│                │                   │                 │
  │                   │ /v1/download/  │                   │                 │
  │                   │ start          │                   │                 │
  │                   │───────────────▶│                   │                 │
  │                   │                │                   │                 │
  │                   │                │ GET download:uid  │                 │
  │                   │                │──────────────────▶│                 │
  │                   │                │     null/existing │                 │
  │                   │                │◀──────────────────│                 │
  │                   │                │                   │                 │
  │                   │                │ SETEX job data    │                 │
  │                   │                │──────────────────▶│                 │
  │                   │                │         OK        │                 │
  │                   │                │◀──────────────────│                 │
  │                   │                │                   │                 │
  │                   │ {jobId, status:│                   │                 │
  │ {jobId, pollUrl}  │  queued}       │                   │                 │
  │◀──────────────────│◀───────────────│                   │                 │
  │                   │                │                   │                 │
  │                   │                │ ─── Background ── │                 │
  │                   │                │                   │                 │
  │                   │                │ Update progress   │                 │
  │                   │                │──────────────────▶│                 │
  │                   │                │                   │                 │
  │                   │                │                   │ HEAD object     │
  │                   │                │                   │────────────────▶│
  │                   │                │                   │     200 OK      │
  │                   │                │                   │◀────────────────│
  │                   │                │                   │                 │
  │                   │                │ Update completed  │                 │
  │                   │                │──────────────────▶│                 │
```

#### Status Polling Flow

```
Client              Gateway           API                Redis
  │                   │                │                   │
  │ GET /api/v1/      │                │                   │
  │ download/status/  │                │                   │
  │ {userId}          │                │                   │
  │──────────────────▶│                │                   │
  │                   │ /v1/download/  │                   │
  │                   │ status/{userId}│                   │
  │                   │───────────────▶│                   │
  │                   │                │                   │
  │                   │                │ GET download:uid  │
  │                   │                │──────────────────▶│
  │                   │                │     job data      │
  │                   │                │◀──────────────────│
  │                   │                │                   │
  │                   │ {status,       │                   │
  │ {status, progress,│  progress...}  │                   │
  │  downloadUrl...}  │                │                   │
  │◀──────────────────│◀───────────────│                   │
```

---

## Tech Stack

### Backend

| Technology                 | Version | Purpose                       |
| -------------------------- | ------- | ----------------------------- |
| Node.js                    | 24+     | Runtime (ESM modules)         |
| Hono                       | 4.10.8  | Web framework                 |
| @hono/zod-openapi          | 0.19.6  | OpenAPI 3.0 spec generation   |
| @scalar/hono-api-reference | 0.5.175 | Interactive API documentation |
| Zod                        | 4.1.13  | Schema validation             |
| ioredis                    | 5.8.2   | Redis client                  |
| @aws-sdk/client-s3         | 3.821.0 | S3 operations                 |
| @sentry/node               | 10.30.0 | Error tracking                |
| @opentelemetry/sdk-node    | 0.202.0 | Distributed tracing           |

### Frontend

| Technology                   | Version | Purpose         |
| ---------------------------- | ------- | --------------- |
| React                        | 18.3.1  | UI framework    |
| Vite                         | 6.0.3   | Build tool      |
| Tailwind CSS                 | 3.4.16  | Styling         |
| React Router DOM             | 7.0.2   | Routing         |
| @sentry/react                | 10.30.0 | Error tracking  |
| @opentelemetry/sdk-trace-web | 2.0.0   | Browser tracing |

### Infrastructure

| Technology                | Purpose                           |
| ------------------------- | --------------------------------- |
| Docker & Docker Compose   | Containerization & orchestration  |
| Nginx                     | API gateway / reverse proxy       |
| Redis                     | Job state storage & caching       |
| RustFS (MinIO-compatible) | S3-compatible object storage      |
| Jaeger                    | Distributed trace collection & UI |

---

## Project Structure

```
cuet-micro-ops-hackthon-2025/
├── src/                              # Backend source code
│   ├── index.ts                      # Main API server (Hono app)
│   └── instrument.ts                 # OpenTelemetry & Sentry init
│
├── frontend/                         # React dashboard
│   ├── src/
│   │   ├── App.tsx                   # Main app with tab navigation
│   │   ├── main.tsx                  # Entry point, observability init
│   │   ├── components/
│   │   │   ├── DownloadTester.tsx    # Download initiation UI
│   │   │   ├── HealthStatus.tsx      # System health display
│   │   │   ├── DownloadJobs.tsx      # Job history tracker
│   │   │   ├── ErrorLog.tsx          # Error capture & display
│   │   │   ├── PerformanceMetrics.tsx# Response time stats
│   │   │   └── TraceViewer.tsx       # Jaeger trace lookup
│   │   └── lib/
│   │       ├── sentry.ts             # Sentry initialization
│   │       ├── tracing.ts            # OpenTelemetry web setup
│   │       └── uuid.ts               # UUID generation utility
│   ├── Dockerfile                    # Frontend container
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── docker/                           # Docker configurations
│   ├── Dockerfile.dev                # Development backend image
│   ├── Dockerfile.prod               # Production backend image
│   ├── Dockerfile.gateway            # Nginx gateway image
│   ├── compose.dev.yml               # Development stack
│   ├── compose.prod.yml              # Production stack
│   └── nginx-gateway.conf            # Gateway routing config
│
├── scripts/                          # Utility scripts
│   ├── run-e2e.ts                    # E2E test runner
│   └── e2e-test.ts                   # E2E test suite
│
├── .github/workflows/
│   └── ci.yml                        # GitHub Actions CI/CD
│
├── package.json                      # Backend dependencies
├── tsconfig.json                     # TypeScript configuration
├── Makefile                          # Docker compose shortcuts
└── .env.example                      # Environment template
```

---

## Implementation Details

### 1. Backend Server (`src/index.ts`)

The main server is built with Hono framework and includes:

#### Middleware Stack

```typescript
// Security middleware
app.use(secureHeaders());
app.use(cors({ origin: CORS_ORIGINS }));
app.use(timeout(REQUEST_TIMEOUT_MS));

// Rate limiting
app.use(
  rateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMIT_MAX_REQUESTS,
    keyGenerator: (c) => c.req.header("x-forwarded-for") || "unknown",
  }),
);

// Request ID tracing
app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") || uuid();
  c.res.headers.set("x-request-id", requestId);
  await next();
});
```

#### Background Job Processor

```typescript
async function processDownloadJob(userId: string): Promise<void> {
  const job = await getJobFromRedis(userId);

  // Simulate processing with configurable delay
  const totalDelay = randomDelay(DOWNLOAD_DELAY_MIN_MS, DOWNLOAD_DELAY_MAX_MS);
  const steps = 10;
  const stepDelay = totalDelay / steps;

  for (let i = 1; i <= steps; i++) {
    await sleep(stepDelay);
    const progress = (i / steps) * 100;

    // Update progress in Redis
    await updateJobProgress(userId, progress);
  }

  // Check S3 for file availability
  const fileExists = await checkS3Object(fileId);

  if (fileExists) {
    const presignedUrl = await generatePresignedUrl(fileId);
    await completeJob(userId, presignedUrl);
  } else {
    await failJob(userId, "File not found in storage");
  }
}
```

### 2. Redis Job Schema

```typescript
// Key pattern: download:{userId}
// TTL: REDIS_JOB_TTL_SECONDS (default: 3600)

interface JobData {
  jobId: string; // UUID
  userId: string; // User identifier (idempotency key)
  fileId: number; // Requested file ID
  status: JobStatus; // "queued" | "processing" | "completed" | "failed"
  progress: number; // 0-100
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
  completedAt?: number; // Unix timestamp (when finished)
  downloadUrl?: string; // Presigned S3 URL (when completed)
  size?: number; // File size in bytes
  processingTimeMs?: number; // Total processing duration
  error?: string; // Error message (when failed)
}
```

#### Redis Operations

```typescript
// Create new job
await redis.setex(
  `${REDIS_KEY_PREFIX}${userId}`,
  REDIS_JOB_TTL_SECONDS,
  JSON.stringify(jobData),
);

// Get job status
const data = await redis.get(`${REDIS_KEY_PREFIX}${userId}`);
const job = JSON.parse(data);

// Update progress
job.progress = progress;
job.updatedAt = Date.now();
await redis.setex(key, REDIS_JOB_TTL_SECONDS, JSON.stringify(job));
```

### 3. S3 Integration

```typescript
const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: S3_FORCE_PATH_STYLE,
});

// Check file availability
async function checkS3Object(fileId: number): Promise<boolean> {
  const key = `downloads/${fileId}.zip`;
  const command = new HeadObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
  });

  try {
    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === "NotFound") return false;
    throw error;
  }
}

// Generate presigned download URL
async function generatePresignedUrl(fileId: number): Promise<string> {
  const key = `downloads/${fileId}.zip`;
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}
```

### 4. Timeout Configuration by Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                    Timeout Configuration                         │
├─────────────────────┬────────────┬──────────────────────────────┤
│ Layer               │ Timeout    │ Purpose                      │
├─────────────────────┼────────────┼──────────────────────────────┤
│ Nginx Gateway       │ 5s connect │ Initial connection           │
│                     │ 30s read   │ Response wait                │
│                     │ 30s write  │ Request body                 │
├─────────────────────┼────────────┼──────────────────────────────┤
│ Hono API Server     │ 30s        │ Request timeout middleware   │
├─────────────────────┼────────────┼──────────────────────────────┤
│ Download Delay (Dev)│ 5-15s      │ Simulated processing         │
│ Download Delay(Prod)│ 10-120s    │ Simulated processing         │
├─────────────────────┼────────────┼──────────────────────────────┤
│ Redis Operations    │ Default    │ ioredis defaults             │
├─────────────────────┼────────────┼──────────────────────────────┤
│ S3 Operations       │ SDK default│ AWS SDK timeout              │
├─────────────────────┼────────────┼──────────────────────────────┤
│ Presigned URLs      │ 3600s      │ Download URL validity        │
├─────────────────────┼────────────┼──────────────────────────────┤
│ Job TTL (Redis)     │ 3600s      │ Job data retention           │
└─────────────────────┴────────────┴──────────────────────────────┘
```

---

## API Contracts

### OpenAPI Documentation

Interactive API documentation is available at `/docs` (Scalar UI) and raw OpenAPI spec at `/openapi`.

### Endpoints

#### Health Check

```
GET /health

Response 200:
{
  "status": "ok",
  "s3": {
    "connected": true,
    "bucket": "downloads"
  },
  "timestamp": "2025-01-15T10:30:00.000Z",
  "traceId": "abc123..."
}
```

#### Start Download Job

```
POST /v1/download/start
Content-Type: application/json

Request:
{
  "file_id": 70000,      // File ID (10000 - 100000000)
  "user_id": "user123"   // Unique user ID for idempotency
}

Response 200 (new job):
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user123",
  "fileId": 70000,
  "status": "queued",
  "progress": 0,
  "message": "Download job queued. Processing will begin shortly.",
  "pollUrl": "/v1/download/status/user123"
}

Response 200 (existing job):
{
  "jobId": "existing-job-id",
  "userId": "user123",
  "fileId": 70000,
  "status": "processing",
  "progress": 45,
  "message": "Existing job found. Continue polling for status.",
  "pollUrl": "/v1/download/status/user123"
}
```

#### Check Download Status

```
GET /v1/download/status/{userId}

Response 200 (processing):
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "progress": 60,
  "createdAt": 1705312200000,
  "updatedAt": 1705312260000,
  "completedAt": null,
  "downloadUrl": null,
  "size": null,
  "processingTimeMs": null,
  "error": null
}

Response 200 (completed):
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 100,
  "createdAt": 1705312200000,
  "updatedAt": 1705312320000,
  "completedAt": 1705312320000,
  "downloadUrl": "https://s3.../downloads/70000.zip?...",
  "size": 1048576,
  "processingTimeMs": 120000,
  "error": null
}

Response 404:
{
  "error": "Job not found for user: user123"
}
```

#### Check File Availability

```
POST /v1/download/check
Content-Type: application/json

Request:
{
  "file_id": 70000
}

Response 200:
{
  "available": true,
  "file_id": 70000,
  "message": "File is available for download"
}
```

#### Initiate Batch Download

```
POST /v1/download/initiate
Content-Type: application/json

Request:
{
  "file_ids": [10000, 20000, 30000]
}

Response 200:
{
  "message": "Download initiated",
  "files": [
    { "id": 10000, "status": "queued" },
    { "id": 20000, "status": "queued" },
    { "id": 30000, "status": "queued" }
  ]
}
```

---

## Observability Stack

### Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Observability Flow                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Frontend                      Backend                                │
│   ┌──────────┐                 ┌──────────┐                           │
│   │  React   │                 │  Hono    │                           │
│   │   App    │                 │  Server  │                           │
│   └────┬─────┘                 └────┬─────┘                           │
│        │                            │                                  │
│   ┌────┴─────┐                 ┌────┴─────┐                           │
│   │ OTEL Web │                 │ OTEL SDK │                           │
│   │  Tracer  │                 │   Node   │                           │
│   └────┬─────┘                 └────┬─────┘                           │
│        │                            │                                  │
│        │     ┌──────────────────────┘                                 │
│        │     │                                                        │
│        ▼     ▼                                                        │
│   ┌─────────────────┐                                                 │
│   │  Jaeger (OTLP)  │◀──── Traces with context propagation            │
│   │   Port: 4318    │                                                 │
│   └────────┬────────┘                                                 │
│            │                                                          │
│            ▼                                                          │
│   ┌─────────────────┐                                                 │
│   │   Jaeger UI     │                                                 │
│   │  Port: 16686    │                                                 │
│   └─────────────────┘                                                 │
│                                                                        │
│   ┌──────────┐                 ┌──────────┐                           │
│   │ Sentry   │                 │ Sentry   │                           │
│   │  React   │────────────────▶│  Cloud   │◀────── Error tracking     │
│   └──────────┘                 └──────────┘                           │
│        │                            ▲                                  │
│        │                            │                                  │
│   ┌────┴─────┐                 ┌────┴─────┐                           │
│   │ Sentry   │                 │ Sentry   │                           │
│   │  Node    │─────────────────│  Cloud   │                           │
│   └──────────┘                 └──────────┘                           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Backend Instrumentation (`src/instrument.ts`)

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import * as Sentry from "@sentry/node";

// Initialize OpenTelemetry
const sdk = new NodeSDK({
  serviceName: "delineate-download-service",
  traceExporter: new OTLPTraceExporter({
    url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
  }),
  instrumentations: [new HttpInstrumentation()],
});

sdk.start();

// Initialize Sentry
Sentry.init({
  dsn: SENTRY_DSN,
  environment: NODE_ENV,
  tracesSampleRate: 1.0,
});
```

### Frontend Instrumentation

#### Tracing (`frontend/src/lib/tracing.ts`)

```typescript
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";

const provider = new WebTracerProvider();
provider.addSpanProcessor(
  new BatchSpanProcessor(new OTLPTraceExporter({ url: "/api/v1/traces" })),
);

// Auto-instrument fetch requests
registerInstrumentations({
  instrumentations: [new FetchInstrumentation()],
});

// Helper functions
export function createSpan(name: string): Span;
export function getCurrentTraceId(): string | undefined;
export function withTracing<T>(name: string, fn: () => Promise<T>): Promise<T>;
```

#### Sentry (`frontend/src/lib/sentry.ts`)

```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

### Trace Correlation

Requests are correlated across services using:

1. **X-Request-ID Header**: Generated by backend, passed through all layers
2. **OpenTelemetry Trace Context**: W3C trace context propagation
3. **Sentry Tags**: Trace IDs attached to error reports

```typescript
// Backend: Add trace ID to response
c.res.headers.set("x-request-id", requestId);
c.res.headers.set("x-trace-id", traceId);

// Frontend: Extract and store for debugging
const traceId = response.headers.get("x-trace-id");
sessionStorage.setItem("lastTraceId", traceId);
```

---

## Docker & Deployment

### Development Setup (`docker/compose.dev.yml`)

```yaml
services:
  delineate-app:
    build:
      context: ..
      dockerfile: docker/Dockerfile.dev
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DOWNLOAD_DELAY_MIN_MS=5000
      - DOWNLOAD_DELAY_MAX_MS=15000
    command: ["node", "--watch", "src/index.ts"]
    depends_on:
      - redis
      - rustfs

  delineate-dashboard:
    build:
      context: ../frontend
    ports:
      - "5173:5173"
    command: ["npm", "run", "dev", "--", "--host"]

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

  rustfs:
    image: ghcr.io/rustfs/rustfs:latest
    ports:
      - "9000:9000"
    environment:
      - RUSTFS_ROOT_USER=minioadmin
      - RUSTFS_ROOT_PASSWORD=minioadmin

  delineate-jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686" # UI
      - "4318:4318" # OTLP HTTP
```

### Production Setup (`docker/compose.prod.yml`)

```yaml
services:
  gateway:
    build:
      context: ..
      dockerfile: docker/Dockerfile.gateway
    ports:
      - "80:80"
    depends_on:
      - delineate-app
      - delineate-dashboard

  delineate-app:
    build:
      context: ..
      dockerfile: docker/Dockerfile.prod
    environment:
      - NODE_ENV=production
      - DOWNLOAD_DELAY_MIN_MS=10000
      - DOWNLOAD_DELAY_MAX_MS=120000
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    # No exposed ports - accessed via gateway

  # ... other services without exposed ports
```

### Nginx Gateway Configuration

```nginx
# docker/nginx-gateway.conf

upstream backend {
    server delineate-app:3000;
}

upstream frontend {
    server delineate-dashboard:5173;
}

server {
    listen 80;

    # API routes → Backend
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Timeouts (intentionally short to demonstrate the problem)
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    # Everything else → Frontend
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Make Commands

```bash
# Development
make dev-up       # Start development stack
make dev-down     # Stop services
make dev-clean    # Remove containers and volumes
make dev-logs     # View logs

# Production
make prod-up      # Start production stack
make prod-down    # Stop services
make prod-clean   # Full cleanup
```

---

## Frontend Integration

### Component Architecture

```
App.tsx
├── Tab Navigation (Dashboard | Downloads | Traces)
│
├── Dashboard Tab
│   ├── HealthStatus.tsx      # Polls /health every 30s
│   ├── DownloadTester.tsx    # Main download UI
│   ├── PerformanceMetrics.tsx # Calculated from session data
│   └── ErrorLog.tsx          # Error capture & display
│
├── Downloads Tab
│   └── DownloadJobs.tsx      # Job history list
│
└── Traces Tab
    └── TraceViewer.tsx       # Jaeger UI link & trace lookup
```

### Download Flow Implementation

```tsx
// DownloadTester.tsx - Simplified flow

function DownloadTester() {
  const [fileId, setFileId] = useState(70000);
  const [userId] = useState(() => generateUserId());
  const [job, setJob] = useState<JobStatus | null>(null);
  const [polling, setPolling] = useState(false);

  async function startDownload() {
    // 1. Initiate download
    const response = await fetch("/api/v1/download/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, user_id: userId }),
    });

    const data = await response.json();
    setJob(data);

    // 2. Start polling if job is queued/processing
    if (data.status !== "completed" && data.status !== "failed") {
      startPolling();
    }
  }

  async function pollStatus() {
    const response = await fetch(`/api/v1/download/status/${userId}`);
    const data = await response.json();

    setJob(data);

    // Dispatch event for DownloadJobs component
    window.dispatchEvent(
      new CustomEvent("downloadJobUpdate", { detail: data }),
    );

    // Stop polling when complete
    if (data.status === "completed" || data.status === "failed") {
      setPolling(false);
    }
  }

  function startPolling() {
    setPolling(true);
    const interval = setInterval(() => {
      pollStatus().then((job) => {
        if (job.status === "completed" || job.status === "failed") {
          clearInterval(interval);
        }
      });
    }, 2000); // Poll every 2 seconds
  }

  return (
    <div>
      <input
        value={fileId}
        onChange={(e) => setFileId(Number(e.target.value))}
      />
      <button onClick={startDownload}>Start Download</button>

      {job && (
        <div>
          <p>Status: {job.status}</p>
          <progress value={job.progress} max={100} />
          {job.downloadUrl && <a href={job.downloadUrl}>Download File</a>}
        </div>
      )}
    </div>
  );
}
```

### State Persistence

```typescript
// Job history stored in localStorage
const STORAGE_KEY = "downloadJobs";
const MAX_JOBS = 50;

function saveJob(job: JobStatus) {
  const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const updated = [job, ...jobs.filter((j) => j.jobId !== job.jobId)].slice(
    0,
    MAX_JOBS,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

// Performance metrics stored in localStorage
const METRICS_KEY = "performanceMetrics";

interface Metrics {
  totalRequests: number;
  successCount: number;
  totalResponseTime: number;
  activeJobs: number;
}
```

---

## Error Handling & Resilience

### Error Response Format

```typescript
interface ErrorResponse {
  error: string;
  message?: string;
  code?: string;
  traceId?: string;
}
```

### Error Codes

| Code               | HTTP Status | Description                 | Client Action                  |
| ------------------ | ----------- | --------------------------- | ------------------------------ |
| `JOB_NOT_FOUND`    | 404         | Job ID doesn't exist        | Show error, allow new download |
| `INVALID_FILE_ID`  | 400         | File ID out of range        | Show validation error          |
| `RATE_LIMITED`     | 429         | Too many requests           | Retry after delay              |
| `STORAGE_ERROR`    | 503         | S3/storage unavailable      | Retry with backoff             |
| `PROCESSING_ERROR` | 500         | Internal processing failure | Retry, then fail               |
| `TIMEOUT`          | 504         | Request timeout             | Use polling pattern            |

### Backend Error Handler

```typescript
app.onError((err, c) => {
  console.error("Unhandled error:", err);

  // Capture in Sentry
  Sentry.captureException(err, {
    tags: {
      requestId: c.req.header("x-request-id"),
      path: c.req.path,
    },
  });

  return c.json(
    {
      error: "Internal server error",
      message: NODE_ENV === "development" ? err.message : undefined,
      traceId: c.res.headers.get("x-trace-id"),
    },
    500,
  );
});
```

### Frontend Error Boundary

```tsx
// ErrorLog.tsx captures and displays errors

function ErrorLog() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);

  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      const entry = {
        message: event.message,
        timestamp: Date.now(),
        traceId: sessionStorage.getItem("lastTraceId"),
      };

      setErrors((prev) => [entry, ...prev].slice(0, 100));

      // Report to Sentry
      Sentry.captureException(event.error, {
        tags: { traceId: entry.traceId },
      });
    };

    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);

  return (
    <div>
      {errors.map((err, i) => (
        <div key={i}>
          <span>{err.message}</span>
          <span>Trace: {err.traceId}</span>
        </div>
      ))}
    </div>
  );
}
```

### Idempotency

The download system is idempotent using `user_id`:

```typescript
// If job exists for user, return existing job instead of creating new one
const existingJob = await redis.get(`download:${userId}`);
if (existingJob) {
  const job = JSON.parse(existingJob);
  if (job.status !== "completed" && job.status !== "failed") {
    return c.json({
      ...job,
      message: "Existing job found. Continue polling for status.",
    });
  }
}
```

### Graceful Shutdown

```typescript
// src/instrument.ts
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("Tracing terminated"))
    .catch((error) => console.error("Error terminating tracing", error))
    .finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  sdk
    .shutdown()
    .then(() => console.log("Tracing terminated"))
    .catch((error) => console.error("Error terminating tracing", error))
    .finally(() => process.exit(0));
});
```

---

## Summary

This architecture addresses the core problem of long-running downloads by:

1. **Immediate Response**: `/v1/download/start` returns instantly with a job ID
2. **Async Processing**: Background processor handles actual file operations
3. **Progress Tracking**: Real-time progress updates via polling
4. **Proxy Compatible**: All endpoints complete within proxy timeout limits
5. **Idempotent**: Same `user_id` returns existing job (no duplicates)
6. **Observable**: Full distributed tracing with Jaeger + error tracking with Sentry
7. **Resilient**: Redis-backed state survives server restarts

### Key Design Patterns

| Pattern             | Implementation                             |
| ------------------- | ------------------------------------------ |
| Async Polling       | Start job → poll status → get result       |
| Idempotency Key     | `user_id` prevents duplicate job creation  |
| Request ID Tracing  | X-Request-ID header across all services    |
| Distributed Tracing | OpenTelemetry spans propagate context      |
| Error Correlation   | Sentry errors tagged with trace IDs        |
| Health Checks       | HTTP `/health` + Docker HEALTHCHECK        |
| Graceful Shutdown   | SIGTERM/SIGINT handlers clean up resources |
| Rate Limiting       | Per-IP request throttling via middleware   |

### Environment Configuration

Key environment variables (see `.env.example`):

```bash
# Server
NODE_ENV=development|production
PORT=3000

# S3 Storage
S3_ENDPOINT=http://rustfs:9000
S3_BUCKET_NAME=downloads
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin

# Download Simulation
DOWNLOAD_DELAY_ENABLED=true
DOWNLOAD_DELAY_MIN_MS=5000   # Dev: 5s, Prod: 10s
DOWNLOAD_DELAY_MAX_MS=15000  # Dev: 15s, Prod: 120s

# Observability
SENTRY_DSN=https://...@sentry.io/...
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318

# Redis
REDIS_URL=redis://redis:6379
REDIS_JOB_TTL_SECONDS=3600
REDIS_KEY_PREFIX=download:

# Security
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
REQUEST_TIMEOUT_MS=30000
CORS_ORIGINS=*
```
