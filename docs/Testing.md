# Testing Guide

This document provides step-by-step instructions to test all features of the Delineate application, including resilience patterns like Circuit Breaker and Redis failure handling.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Automated Test Scripts](#automated-test-scripts)
3. [Starting the Environment](#starting-the-environment)
4. [Basic Health Checks](#basic-health-checks)
5. [File Upload & Download Tests](#file-upload--download-tests)
6. [Async Download Job Tests](#async-download-job-tests)
7. [Resilience Testing](#resilience-testing)
   - [Redis Failure Handling](#redis-failure-handling)
   - [S3 Circuit Breaker](#s3-circuit-breaker)
8. [Stress Testing](#stress-testing)
9. [Observability Testing](#observability-testing)
10. [End-to-End (E2E) Testing](#end-to-end-e2e-testing)
    - [E2E Test 1: Complete Download Flow](#e2e-test-1-complete-download-flow)
    - [E2E Test 2: Resilience Under Failure](#e2e-test-2-resilience-under-failure)
    - [E2E Test 3: Frontend Integration](#e2e-test-3-frontend-integration)
11. [Quick Verification Checklist](#quick-verification-checklist)
12. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Docker and Docker Compose installed
- `curl` command available
- Terminal/Command prompt access
- Node.js 24+ (for running test scripts)
- Bash shell (for shell scripts - Git Bash on Windows)

---

## Automated Test Scripts

The project includes automated test scripts for quick verification and comprehensive testing.

### Available npm Scripts

| Script | Command | Description | Duration |
|--------|---------|-------------|----------|
| **Full E2E** | `npm run test:e2e` | Starts server and runs all tests | ~30s |
| **E2E Only** | `npm run test:e2e:only` | Tests only (server must be running) | ~25s |
| **Quick Test** | `npm run test:quick` | Basic health verification | ~5s |
| **Resilience** | `npm run test:resilience` | Redis/S3 failure tests | ~2min |

### Running Tests

```bash
# Quick verification (recommended first)
npm run test:quick

# Full E2E test suite (45 tests)
npm run test:e2e

# Resilience testing (stops/starts services)
npm run test:resilience
```

### Test Script Details

#### 1. E2E Test Script (`scripts/e2e-test.js`)

Tests 45 scenarios including:
- Root and health endpoints
- Security headers (CORS, rate limiting, etc.)
- Download initiate/check/start/status endpoints
- Async download job flow with polling
- Input validation
- Request ID tracking
- Content-type validation

```bash
node scripts/e2e-test.js [BASE_URL]
# Default: http://localhost:3000
```

#### 2. Quick Test Script (`scripts/quick-test.sh`)

Fast verification of core functionality:
- Health endpoint with Redis/S3 status
- Root endpoint response
- File list endpoint
- Download check/start endpoints
- Security headers

```bash
bash scripts/quick-test.sh [BASE_URL]
```

#### 3. Resilience Test Script (`scripts/resilience-test.sh`)

Tests failure scenarios:
- Redis failure → 503 response → recovery
- S3 failure → circuit breaker → recovery

```bash
bash scripts/resilience-test.sh [BASE_URL]
```

---

## Starting the Environment

### Start all services

```bash
cd cuet-micro-ops-hackthon-2025
npm run docker:dev
```

Or manually:

```bash
docker compose -f docker/compose.dev.yml up --build -d
```

### Verify all containers are running

```bash
docker compose -f docker/compose.dev.yml ps
```

**Expected output:** All 5 services should be running:
- `delineate-app` (Backend API) - Port 3000
- `delineate-dashboard` (Frontend) - Port 5173
- `delineate-jaeger` (Tracing) - Port 16686
- `redis` (Job Storage) - Port 6379
- `rustfs` (S3 Storage) - Port 9000

### Service URLs

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3000 |
| Frontend Dashboard | http://localhost:5173 |
| API Documentation | http://localhost:3000/docs |
| Jaeger UI | http://localhost:16686 |
| RustFS Console | http://localhost:9001 |

---

## Basic Health Checks

### Test 1: Health Endpoint

```bash
curl http://localhost:3000/health
```

**Expected response (healthy):**
```json
{
  "status": "healthy",
  "checks": {
    "storage": "ok",
    "redis": "ok"
  }
}
```

**Possible storage values:**
- `ok` - S3 is accessible
- `error` - S3 connection failed
- `circuit_open` - Circuit breaker is open (S3 unavailable)

**Possible redis values:**
- `ok` - Redis is connected
- `error` - Redis is disconnected

### Test 2: Root Endpoint

```bash
curl http://localhost:3000/
```

**Expected response:**
```json
{"message":"Hello Hono!"}
```

### Test 3: API Documentation

Open http://localhost:3000/docs in your browser to view the interactive API documentation.

---

## File Upload & Download Tests

### Test 4: Upload a File

```bash
# Create a test file
echo "Hello, this is a test file!" > testfile.txt

# Upload with file_id between 10000-100000000
curl -X POST http://localhost:3000/v1/upload \
  -F "file=@testfile.txt" \
  -F "file_id=50000"
```

**Expected response:**
```json
{
  "success": true,
  "fileId": 50000,
  "s3Key": "downloads/50000.zip",
  "size": 28,
  "message": "File uploaded successfully as downloads/50000.zip"
}
```

### Test 5: List Files

```bash
curl http://localhost:3000/v1/files
```

**Expected response:**
```json
{
  "files": [
    {
      "key": "downloads/50000.zip",
      "size": 28,
      "lastModified": "2025-12-16T...",
      "fileId": 50000
    }
  ],
  "totalCount": 1
}
```

### Test 6: Check File Availability

```bash
curl -X POST http://localhost:3000/v1/download/check \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000}'
```

**Expected response:**
```json
{
  "file_id": 50000,
  "available": true,
  "s3Key": "downloads/50000.zip",
  "size": 28
}
```

### Test 7: Download a File

```bash
# Download file (saves with original filename)
curl -O -J http://localhost:3000/v1/download/file/50000

# Or view headers
curl -I http://localhost:3000/v1/download/file/50000
```

**Expected headers:**
```
Content-Type: text/plain
Content-Disposition: attachment; filename="testfile.txt"
Content-Length: 28
```

---

## Async Download Job Tests

### Test 8: Start Async Download Job

```bash
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000, "user_id": "test-user-1"}'
```

**Expected response:**
```json
{
  "jobId": "uuid-here",
  "userId": "test-user-1",
  "fileId": 50000,
  "status": "queued",
  "message": "Download job queued. Poll the status URL for updates.",
  "pollUrl": "/v1/download/status/test-user-1"
}
```

### Test 9: Poll Job Status

```bash
# Poll immediately
curl http://localhost:3000/v1/download/status/test-user-1

# Poll every 2 seconds until complete
while true; do
  response=$(curl -s http://localhost:3000/v1/download/status/test-user-1)
  echo "$response"
  status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then
    break
  fi
  sleep 2
done
```

**Status progression:**
1. `queued` (0%) - Job accepted
2. `processing` (1-99%) - Job in progress
3. `completed` (100%) - Download ready
4. `failed` (100%) - Error occurred

### Test 10: Idempotency Check

The download system is idempotent using `user_id` as the key. Same `user_id` returns the existing active job instead of creating a new one.

#### Idempotency Behavior

| Scenario | Result |
|----------|--------|
| Same `user_id` with job in `queued` or `processing` | Returns existing job |
| Same `user_id` after job `completed` or `failed` | Creates new job (allows retry) |
| Different `user_id` | Creates new job |

#### Test: Rapid Requests (Same User)

```bash
# Send two requests quickly (before job completes)
echo "Request 1:" && curl -s -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000, "user_id": "idempotent-user"}' && echo "" && \
echo "Request 2:" && curl -s -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000, "user_id": "idempotent-user"}'
```

**Expected Output:**

```
Request 1:
{"jobId":"ad2d2e4b-...","userId":"idempotent-user","fileId":50000,"status":"queued","message":"Download job queued. Poll the status URL for updates.","pollUrl":"/v1/download/status/idempotent-user"}

Request 2:
{"jobId":"ad2d2e4b-...","userId":"idempotent-user","fileId":50000,"status":"processing","progress":0,"message":"Download job already in progress","pollUrl":"/v1/download/status/idempotent-user"}
```

**Key Points:**
- Both responses have the **same `jobId`**
- Request 2 message says "Download job already in progress"
- Request 2 status may be `processing` (job started between requests)

#### Verify in Logs

```bash
docker logs delineate-delineate-app-1 2>&1 | grep -E "(Created new job|Returning existing job)"
```

**Expected log messages:**
```
[Download] Created new job userId=idempotent-user jobId=ad2d2e4b-...
[Download] Returning existing job for userId=idempotent-user jobId=ad2d2e4b-... status=processing
```

#### Test: After Job Completes (New Job Created)

```bash
# Wait for job to complete (5-15s in dev mode)
sleep 20

# New request creates new job (previous completed)
curl -s -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000, "user_id": "idempotent-user"}'
```

**Expected:** New `jobId` is returned (previous job completed, so new job is created)

---

## Resilience Testing

### Redis Failure Handling

Tests that the system returns proper errors when Redis is unavailable.

#### Step 1: Stop Redis

```bash
docker compose -f docker/compose.dev.yml stop redis
```

#### Step 2: Check Health

```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{
  "status": "unhealthy",
  "checks": {
    "storage": "ok",
    "redis": "error"
  }
}
```

#### Step 3: Try to Start a Download Job

```bash
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000, "user_id": "redis-down-test"}'
```

**Expected response (503 Service Unavailable):**
```json
{
  "error": "Service Unavailable",
  "message": "Job storage temporarily unavailable. Please retry in a few moments.",
  "requestId": "uuid-here"
}
```

**Verify HTTP status code:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000, "user_id": "redis-down-test2"}'
```

**Expected:** `503`

#### Step 4: Restart Redis

```bash
docker compose -f docker/compose.dev.yml start redis
sleep 5
curl http://localhost:3000/health
```

**Expected:** Status back to `healthy` with `redis: "ok"`

---

### S3 Circuit Breaker

Tests that the circuit breaker provides fast-fail when S3 is unavailable.

#### Step 1: Stop S3 (RustFS)

```bash
docker compose -f docker/compose.dev.yml stop rustfs
```

#### Step 2: Check Health

```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{
  "status": "unhealthy",
  "checks": {
    "storage": "error",
    "redis": "ok"
  }
}
```

#### Step 3: Test Timeout (Should be ~5 seconds, not 11+)

```bash
time curl http://localhost:3000/v1/files
```

**Expected response:**
```json
{
  "error": "List Failed",
  "message": "Timed out after 5000ms",
  "requestId": "uuid-here"
}
```

**Expected time:** ~5 seconds (circuit breaker timeout)

#### Step 4: Trigger Circuit Breaker Opening

Make 5+ failed requests to open the circuit:

```bash
for i in 1 2 3 4 5 6; do
  echo "Request $i:"
  time curl -s http://localhost:3000/v1/files
  echo ""
done
```

After ~5 failures, the circuit opens and subsequent requests fail faster.

#### Step 5: Check Circuit State in Logs

```bash
docker compose -f docker/compose.dev.yml logs delineate-app --tail=50 | grep "Circuit Breaker"
```

**Expected log messages:**
```
[S3 Circuit Breaker] OPEN - S3 requests will fail fast
```

#### Step 6: Restart S3 and Verify Recovery

```bash
docker compose -f docker/compose.dev.yml start rustfs
sleep 5
curl http://localhost:3000/health
```

**Expected:** Status back to `healthy` with `storage: "ok"`

```bash
time curl http://localhost:3000/v1/files
```

**Expected:** Fast response (~100ms) with file list

---

## Stress Testing

### Test 11: Concurrent Requests (50 users)

```bash
# Start 50 concurrent status requests
for i in $(seq 1 50); do
  curl -s http://localhost:3000/v1/download/status/user$i &
done
wait
echo "All requests completed"
```

### Test 12: Concurrent Requests (300 users)

```bash
time (for i in $(seq 1 300); do
  curl -s http://localhost:3000/v1/download/status/user$i &
done; wait)
```

**Expected:** Completes in ~5-10 seconds without errors.

### Test 13: Rate Limiting

```bash
# Send 120 rapid requests (limit is 100/min)
for i in $(seq 1 120); do
  status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
  echo "Request $i: $status"
done
```

**Expected:** First ~100 return `200`, subsequent return `429` (Too Many Requests).

### Test 14: Large File Download

```bash
# Create and upload a 50MB file
dd if=/dev/urandom of=large-file.bin bs=1M count=50
curl -X POST http://localhost:3000/v1/upload \
  -F "file=@large-file.bin" \
  -F "file_id=88888"

# Download it
time curl -o downloaded.bin http://localhost:3000/v1/download/file/88888
```

**Expected:** Download completes, memory usage stays stable (~100MB).

---

## Observability Testing

### Test 15: Distributed Tracing (Jaeger)

1. Make some API requests:
   ```bash
   curl http://localhost:3000/health
   curl http://localhost:3000/v1/files
   curl -X POST http://localhost:3000/v1/download/start \
     -H "Content-Type: application/json" \
     -d '{"file_id": 50000, "user_id": "trace-test"}'
   ```

2. Open Jaeger UI: http://localhost:16686

3. Select service: `delineate-hackathon-challenge`

4. Click "Find Traces"

5. Click on a trace to see the request flow

### Test 16: Sentry Error Tracking

Trigger a test error:

```bash
curl -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 12345}'
```

Check your Sentry dashboard for the captured error.

### Test 17: Frontend Tracing

1. Open Frontend: http://localhost:5173

2. Open browser DevTools (F12) > Console

3. Look for: `OpenTelemetry tracing initialized`

4. Perform actions (upload, download)

5. Check Jaeger for `delineate-dashboard` service traces

---

## End-to-End (E2E) Testing

This section provides complete end-to-end test scenarios that verify the entire system works correctly.

### E2E Test 1: Complete Download Flow

This test verifies the full upload → async job → download cycle.

```bash
# Step 1: Verify system is healthy
echo "=== Step 1: Health Check ==="
curl -s http://localhost:3000/health
# Expected: {"status":"healthy","checks":{"storage":"ok","redis":"ok"}}

# Step 2: Create and upload a test file
echo "=== Step 2: Upload Test File ==="
echo "Hello, this is E2E test content!" > e2e-test.txt
curl -X POST http://localhost:3000/v1/upload \
  -F "file=@e2e-test.txt" \
  -F "file_id=77777"
# Expected: {"success":true,"fileId":77777,"s3Key":"downloads/77777.zip"...}

# Step 3: Start async download job
echo "=== Step 3: Start Download Job ==="
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 77777, "user_id": "e2e-user"}'
# Expected: {"jobId":"...","status":"queued","pollUrl":"/v1/download/status/e2e-user"}

# Step 4: Poll for completion (wait 5-15 seconds)
echo "=== Step 4: Poll Status ==="
sleep 5
curl -s http://localhost:3000/v1/download/status/e2e-user
# Expected: {"status":"processing"...} or {"status":"completed"...}

# Keep polling until completed
sleep 10
curl -s http://localhost:3000/v1/download/status/e2e-user
# Expected: {"status":"completed","progress":100,"downloadUrl":"/v1/download/file/77777"}

# Step 5: Download the file
echo "=== Step 5: Download File ==="
curl -I http://localhost:3000/v1/download/file/77777
# Expected: HTTP/1.1 200 OK, content-disposition: attachment; filename="e2e-test.txt"

# Verify content
curl -s http://localhost:3000/v1/download/file/77777
# Expected: Hello, this is E2E test content!

# Step 6: Verify health is still stable
echo "=== Step 6: Final Health Check ==="
curl -s http://localhost:3000/health
# Expected: {"status":"healthy","checks":{"storage":"ok","redis":"ok"}}
```

**Success Criteria:**
- All steps return expected responses
- Job completes with status "completed"
- File downloads with correct content
- Health remains healthy throughout

---

### E2E Test 2: Resilience Under Failure

This test verifies the system handles failures gracefully.

#### 2a: Redis Failure Recovery

```bash
# Step 1: Start with healthy system
curl -s http://localhost:3000/health
# Expected: healthy

# Step 2: Stop Redis
docker compose -f docker/compose.dev.yml stop redis
sleep 3

# Step 3: Verify health shows Redis error
curl -s http://localhost:3000/health
# Expected: {"status":"unhealthy","checks":{"storage":"ok","redis":"error"}}

# Step 4: Verify download start returns 503 (not silent failure)
curl -s -w "\nHTTP Status: %{http_code}\n" -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 50000, "user_id": "redis-fail-test"}'
# Expected: HTTP Status: 503
# Expected: {"error":"Service Unavailable","message":"Job storage temporarily unavailable..."}

# Step 5: Restart Redis
docker compose -f docker/compose.dev.yml start redis
sleep 5

# Step 6: Verify recovery
curl -s http://localhost:3000/health
# Expected: {"status":"healthy","checks":{"storage":"ok","redis":"ok"}}
```

#### 2b: S3 Circuit Breaker

```bash
# Step 1: Start with healthy system
curl -s http://localhost:3000/health
# Expected: healthy

# Step 2: Stop S3 (RustFS)
docker compose -f docker/compose.dev.yml stop rustfs

# Step 3: Time a list files request (should be ~5s, not 11s)
time curl -s http://localhost:3000/v1/files
# Expected: ~5 seconds timeout, {"error":"List Failed","message":"Timed out after 5000ms"}

# Step 4: Trigger circuit breaker (5+ failures)
for i in 1 2 3 4 5 6; do curl -s http://localhost:3000/v1/files > /dev/null; done

# Step 5: Verify circuit is open
curl -s http://localhost:3000/health
# Expected: {"status":"unhealthy","checks":{"storage":"circuit_open","redis":"ok"}}

# Step 6: Restart S3
docker compose -f docker/compose.dev.yml start rustfs

# Step 7: Wait for circuit reset (30 seconds)
echo "Waiting 35 seconds for circuit breaker reset..."
sleep 35

# Step 8: Verify recovery
curl -s http://localhost:3000/health
# Expected: {"status":"healthy","checks":{"storage":"ok","redis":"ok"}}
```

---

### E2E Test 3: Frontend Integration

1. Open http://localhost:5173 in browser

2. **Health Dashboard Check:**
   - Verify "System Health" panel shows green indicators
   - Verify "Storage (S3)" shows "OK"
   - Verify "Redis (Job Queue)" shows "OK"

3. **File Upload Test:**
   - Enter File ID: 88888
   - Select a test file
   - Click "Upload File"
   - Verify success message appears

4. **Download Test:**
   - Enter File ID: 88888 in Download Tester
   - Click "Start Download"
   - Verify progress bar updates
   - Verify "Download File" link appears when complete

5. **Error Handling Test:**
   - Stop Redis: `docker compose -f docker/compose.dev.yml stop redis`
   - Click "Start Download"
   - Verify error message shows "Service Error" with red styling
   - Verify message suggests checking System Health
   - Restart Redis: `docker compose -f docker/compose.dev.yml start redis`

---

## Quick Verification Checklist

| Test | Command | Expected |
|------|---------|----------|
| Health | `curl localhost:3000/health` | `status: healthy` |
| Redis OK | `curl localhost:3000/health` | `redis: ok` |
| Storage OK | `curl localhost:3000/health` | `storage: ok` |
| Upload | `curl -F file=@test.txt -F file_id=50000 localhost:3000/v1/upload` | `success: true` |
| List Files | `curl localhost:3000/v1/files` | Array of files |
| Start Job | `curl -X POST -d '{"file_id":50000,"user_id":"x"}' localhost:3000/v1/download/start` | `status: queued` |
| Poll Status | `curl localhost:3000/v1/download/status/x` | Progress updates |
| Download | `curl -O -J localhost:3000/v1/download/file/50000` | File downloads |
| Idempotency | Two rapid requests with same `user_id` | Same `jobId` returned |
| Redis Down | Stop redis, start job | `503 Service Unavailable` |
| S3 Down | Stop rustfs, list files | `5s timeout` (not 11s) |
| Circuit Open | Health after S3 down | `storage: circuit_open` |
| E2E Upload→Download | Upload file, start job, poll, download | Full cycle works |

---

## Troubleshooting

### Container not starting

```bash
docker compose -f docker/compose.dev.yml logs <service-name>
```

### Redis connection issues

```bash
docker compose -f docker/compose.dev.yml restart redis
docker compose -f docker/compose.dev.yml restart delineate-app
```

### S3 bucket not found

```bash
# Recreate the bucket
docker compose -f docker/compose.dev.yml restart rustfs-init
```

### Frontend not loading

```bash
docker compose -f docker/compose.dev.yml logs delineate-dashboard
docker compose -f docker/compose.dev.yml restart delineate-dashboard
```

### Reset everything

```bash
docker compose -f docker/compose.dev.yml down -v
docker compose -f docker/compose.dev.yml up --build -d
```
