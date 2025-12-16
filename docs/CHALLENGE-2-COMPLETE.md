# Challenge 2: Long-Running Download - Complete Project Documentation

## Overview

This document provides the complete implementation reference for Challenge 2: handling long-running downloads in a microservices architecture using the async polling pattern.

---

## Table of Contents

1. [Problem & Solution Summary](#problem--solution-summary)
2. [API Reference](#api-reference)
3. [Data Models](#data-models)
4. [Redis Storage](#redis-storage)
5. [Implementation Status](#implementation-status)
6. [Configuration](#configuration)
7. [Testing](#testing)
8. [Stress Test Results](#stress-test-results)
9. [Frontend Integration](#frontend-integration)
10. [Production Considerations](#production-considerations)

---

## Problem & Solution Summary

### The Problem

Downloads can take 10-200 seconds, but gateway timeouts occur at 30-100 seconds:

| Layer              | Timeout     |
| ------------------ | ----------- |
| REQUEST_TIMEOUT_MS | 30 seconds  |
| nginx default      | 60 seconds  |
| Cloudflare         | 100 seconds |

**Result:** Gateway Timeout errors for any download > 30 seconds.

### The Solution: Async Polling Pattern

1. **POST /v1/download/start** returns immediately with jobId
2. **Background processing** handles the actual download (10-200s)
3. **GET /v1/download/status/:userId** polls for progress
4. **Client redirects** to download URL when complete

**Key Benefits:**

- No more gateway timeouts
- Real-time progress tracking
- Idempotent requests (same user_id returns existing job)
- Works through any proxy

---

## API Reference

### 1. Start Download Job

**Endpoint:** `POST /v1/download/start`

**Request:**

```json
{
  "file_id": 70007,
  "user_id": "user-123"
}
```

**Response (201 Created - New Job):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "fileId": 70007,
  "status": "queued",
  "message": "Download job queued. Poll the status URL for updates.",
  "pollUrl": "/v1/download/status/user-123"
}
```

**Response (200 OK - Job Already Exists):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "fileId": 70007,
  "status": "processing",
  "progress": 45,
  "message": "Download job already in progress",
  "pollUrl": "/v1/download/status/user-123"
}
```

**Error Response (503 Service Unavailable):**

```json
{
  "error": "Service Unavailable",
  "message": "Job storage temporarily unavailable. Please retry in a few moments."
}
```

---

### 2. Get Download Status

**Endpoint:** `GET /v1/download/status/:userId`

**Response (Processing):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "fileId": 70007,
  "status": "processing",
  "progress": 65,
  "createdAt": 1765534003225,
  "updatedAt": 1765534004500,
  "completedAt": null,
  "downloadUrl": null,
  "size": null,
  "processingTimeMs": null,
  "message": null,
  "error": null
}
```

**Response (Completed):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "fileId": 70007,
  "status": "completed",
  "progress": 100,
  "createdAt": 1765534003225,
  "updatedAt": 1765534005754,
  "completedAt": 1765534005754,
  "downloadUrl": "/v1/download/file/70007",
  "size": 6396041,
  "processingTimeMs": 2528,
  "message": "Download ready after 2.5 seconds",
  "error": null
}
```

**Response (Failed):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "fileId": 70001,
  "status": "failed",
  "progress": 100,
  "createdAt": 1765534037590,
  "updatedAt": 1765534039865,
  "completedAt": 1765534039865,
  "downloadUrl": null,
  "size": null,
  "processingTimeMs": 2275,
  "message": "File not found after 2.3 seconds of processing",
  "error": null
}
```

---

### 3. All Endpoints Summary

| Method | Endpoint                      | Description              | Response Time |
| ------ | ----------------------------- | ------------------------ | ------------- |
| POST   | `/v1/download/start`          | Start async download job | < 100ms       |
| GET    | `/v1/download/status/:userId` | Poll job status          | < 50ms        |
| POST   | `/v1/download/check`          | Check file availability  | < 100ms       |
| POST   | `/v1/download/initiate`       | Initiate batch download  | < 100ms       |
| GET    | `/v1/download/file/:fileId`   | Download actual file     | Streaming     |
| POST   | `/v1/upload`                  | Upload file to S3        | Variable      |
| GET    | `/v1/files`                   | List files in S3         | < 100ms       |
| GET    | `/health`                     | Health check             | < 50ms        |

---

## Data Models

### DownloadJob Interface

```typescript
interface DownloadJob {
  // Identifiers
  jobId: string; // UUID v4
  userId: string; // User identifier (idempotency key)
  fileId: number; // File ID (70000-79999)

  // Status
  status: "queued" | "processing" | "completed" | "failed";
  progress: number; // 0-100

  // Timestamps (Unix ms)
  createdAt: number;
  updatedAt: number;
  completedAt?: number;

  // Result
  downloadUrl?: string | null; // URL when completed
  size?: number | null; // File size in bytes
  processingTimeMs?: number; // Total processing duration

  // Messages
  message?: string; // Human-readable status message
  error?: string; // Error details if failed

  // Metadata
  estimatedDelayMs?: number; // Expected processing time
}
```

### Job Status State Machine

```
                POST /download/start
                        │
                        ▼
                 ┌──────────┐
                 │  QUEUED  │
                 └────┬─────┘
                      │
            Background processor
                picks up job
                      │
                      ▼
                ┌───────────┐
                │PROCESSING │◄────┐
                └─────┬─────┘     │
                      │           │
                Progress update   │
                (0% → 100%)  ─────┘
                      │
      ┌───────────────┴───────────────┐
      │                               │
 Success                          Failure
      │                               │
      ▼                               ▼
┌───────────┐                  ┌──────────┐
│ COMPLETED │                  │  FAILED  │
└───────────┘                  └──────────┘
      │                               │
Has downloadUrl                Has error message
```

---

## Redis Storage

### Key Structure

```
download:{userId}
```

- **Pattern**: `download:` prefix + user ID
- **Example**: `download:user-456`
- **TTL**: 3600 seconds (1 hour)

### Value Format

JSON-serialized `DownloadJob` object:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-456",
  "fileId": 70000,
  "status": "processing",
  "progress": 45,
  "createdAt": 1702400000000,
  "updatedAt": 1702400045000
}
```

### Why userId as Key?

1. **Idempotency**: Multiple requests return same job
2. **Simple Lookup**: Direct access by userId (no secondary index)
3. **One Job Per User**: Natural constraint prevents duplicate processing
4. **Clean API**: Status endpoint uses `/status/:userId` (intuitive)

---

## Implementation Status

### Implemented Features

| Feature                    | Status | Description                                        |
| -------------------------- | ------ | -------------------------------------------------- |
| **Async Job Pattern**      | ✅     | Returns jobId immediately, processes in background |
| **Background Processing**  | ✅     | Non-blocking job processing with progress updates  |
| **Polling Endpoint**       | ✅     | Check job progress (0-100%)                        |
| **Redis Job Storage**      | ✅     | Jobs stored with 1-hour TTL                        |
| **Redis Failure Handling** | ✅     | Returns 503 when Redis is unavailable              |
| **Idempotency**            | ✅     | Same userId returns existing job                   |
| **Circuit Breaker (S3)**   | ✅     | Fast-fail after 5s, auto-recovery after 30s        |
| **Health Dashboard**       | ✅     | Shows Redis, S3, circuit status                    |
| **Frontend Polling**       | ✅     | Polls every 1 second for updates                   |
| **Rate Limiting**          | ✅     | 100 requests/minute per IP                         |
| **Distributed Tracing**    | ✅     | OpenTelemetry + Jaeger integration                 |
| **Error Tracking**         | ✅     | Sentry integration                                 |

### Not Implemented (Production Optimizations)

| Feature                      | Reason                                   |
| ---------------------------- | ---------------------------------------- |
| **SSE (Server-Sent Events)** | Polling is simpler and works everywhere  |
| **BullMQ Workers**           | In-memory processing sufficient for demo |
| **Presigned URLs**           | Direct streaming used instead            |

---

## Configuration

### Environment Variables

```bash
# Server Configuration
NODE_ENV=development
PORT=3000

# S3/Storage Configuration
S3_REGION=us-east-1
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=rustfsadmin
S3_SECRET_ACCESS_KEY=rustfsadmin
S3_BUCKET_NAME=downloads
S3_FORCE_PATH_STYLE=true

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Download Delay Simulation
DOWNLOAD_DELAY_ENABLED=true
DOWNLOAD_DELAY_MIN_MS=2000
DOWNLOAD_DELAY_MAX_MS=5000

# Timeouts
REQUEST_TIMEOUT_MS=30000
```

### Storage Modes

| Mode             | Configuration              | Behavior                              |
| ---------------- | -------------------------- | ------------------------------------- |
| **Mock Mode**    | `S3_BUCKET_NAME=` (empty)  | Files available if `fileId % 7 === 0` |
| **Real S3 Mode** | `S3_BUCKET_NAME=downloads` | Checks actual S3/RustFS               |

---

## Testing

### Quick Start

```bash
# Start development environment
make dev-up

# Run all tests (45 tests)
npm run test:e2e

# Run quick tests (11 tests)
npm run test:quick

# Run resilience tests
npm run test:resilience
```

### Manual Testing

```bash
# 1. Start a download job
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70007, "user_id": "test-user"}'

# 2. Poll for status
curl http://localhost:3000/v1/download/status/test-user

# 3. Test idempotency (same user_id)
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70007, "user_id": "test-user"}'
# Should return same jobId!
```

### Idempotency Testing

**Behavior:**

| Scenario                                           | Result                         |
| -------------------------------------------------- | ------------------------------ |
| Same `user_id` with active job (queued/processing) | Returns existing job           |
| Same `user_id` after job completed                 | Creates new job (allows retry) |
| Different `user_id`                                | Creates new job                |

**Rapid Requests Test:**

```bash
# Terminal 1: Start job
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70007, "user_id": "idem-test"}'

# Terminal 2: Immediately send second request
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70007, "user_id": "idem-test"}'
```

Both should return the **same jobId**.

---

## Stress Test Results

### Concurrent Requests (300 users)

| Metric          | Result         |
| --------------- | -------------- |
| Total requests  | 300            |
| Completion time | 5.27 seconds   |
| Memory usage    | 97 MB (stable) |
| Errors          | 0              |

### Rate Limiting

| Metric             | Result             |
| ------------------ | ------------------ |
| Requests sent      | 120                |
| Rate limited (429) | 120                |
| Limit config       | 100 req/min per IP |

### Large File Downloads (1GB concurrent)

| Metric          | Result           |
| --------------- | ---------------- |
| Total data      | 1 GB (20 × 50MB) |
| Completion time | 16.7 seconds     |
| Memory usage    | 102 MB (stable)  |

### Failure Scenarios

| Scenario       | Behavior                                           |
| -------------- | -------------------------------------------------- |
| Redis down     | Returns 503 (not silent failure)                   |
| S3 down        | Circuit breaker opens after 5 failures, fails fast |
| Server restart | Job state persists in Redis                        |

---

## Frontend Integration

### React Hook

```typescript
export function useDownloadJob(userId: string, fileId: number) {
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const startDownload = useCallback(async () => {
    setIsLoading(true);

    // 1. Initiate download (returns immediately)
    const response = await fetch("/v1/download/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, user_id: userId }),
    });

    const data = await response.json();
    setJob(data);

    // 2. Start polling with userId
    const pollInterval = setInterval(async () => {
      const statusResponse = await fetch(`/v1/download/status/${userId}`);
      const statusData = await statusResponse.json();
      setJob(statusData);

      if (statusData.status === "completed" || statusData.status === "failed") {
        clearInterval(pollInterval);
        setIsLoading(false);
      }
    }, 1000); // Poll every second
  }, [userId, fileId]);

  return { job, isLoading, startDownload };
}
```

### Health Dashboard

The frontend displays real-time system health:

| Indicator         | Status                    |
| ----------------- | ------------------------- |
| Storage (S3)      | OK / ERROR / CIRCUIT_OPEN |
| Redis (Job Queue) | OK / ERROR                |

---

## Production Considerations

### Timeout Configuration

| Layer             | Timeout | Purpose                    |
| ----------------- | ------- | -------------------------- |
| Browser           | 30s     | Prevent UI hanging         |
| nginx             | 10s     | All responses are now fast |
| API Server        | 30s     | Kill slow requests         |
| Background Worker | 300s    | Max processing time        |
| Redis Operations  | 5s      | Prevent blocking           |
| S3 Operations     | 30s     | Prevent S3 hanging         |

### nginx Configuration (Production)

```nginx
upstream download_api {
    server app:3000;
    keepalive 32;
}

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=download_initiate:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=download_status:10m rate=30r/s;

server {
    listen 80;

    # POST /v1/download/start - Rate limited, short timeout
    location /v1/download/start {
        limit_req zone=download_initiate burst=20 nodelay;
        proxy_pass http://download_api;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
        proxy_buffering off;
    }

    # GET /v1/download/status/:userId - Higher rate for polling
    location ~ ^/v1/download/status/(.+)$ {
        limit_req zone=download_status burst=50 nodelay;
        proxy_pass http://download_api;
        proxy_read_timeout 5s;
        proxy_cache off;
        add_header Cache-Control "no-store";
    }

    # Health check - No rate limiting
    location /health {
        proxy_pass http://download_api;
        proxy_read_timeout 5s;
        limit_req off;
    }

    # Default
    location / {
        proxy_pass http://download_api;
        proxy_read_timeout 30s;
    }
}
```

### Scaling

For high volume, consider:

1. **Redis Cluster** for job storage
2. **BullMQ** for distributed job processing
3. **Presigned S3 URLs** for direct downloads
4. **SSE** for real-time updates (reduces polling)

### Files Reference

| File                                         | Purpose                   |
| -------------------------------------------- | ------------------------- |
| `src/index.js`                               | Main backend API          |
| `frontend/src/components/HealthStatus.tsx`   | Health dashboard          |
| `frontend/src/components/DownloadTester.tsx` | Download testing          |
| `scripts/e2e-test.js`                        | E2E test suite (45 tests) |
| `docker/compose.dev.yml`                     | Development environment   |

---

## Summary

The Challenge 2 implementation provides:

1. **No Timeouts**: Immediate response with jobId
2. **Progress Tracking**: Real-time progress via polling
3. **Idempotency**: Same user_id returns existing job
4. **Resilience**: Circuit breaker + Redis failure handling
5. **Observability**: Full tracing and error tracking

All 45 E2E tests pass. The implementation is production-ready for the hackathon scope.
