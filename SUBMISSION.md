# Delineate - CUET Micro-Ops Hackathon 2025 Submission

[![CI](https://github.com/bongodev/cuet-micro-ops-hackthon-2025/actions/workflows/ci.yml/badge.svg)](https://github.com/bongodev/cuet-micro-ops-hackthon-2025/actions/workflows/ci.yml)

> A production-ready file download microservice with S3 storage, observability, and CI/CD pipeline - built for the CUET Fest 2025 Hackathon.

---

## Challenge Summary

| Challenge                           | Max Points | Status      |
| ----------------------------------- | ---------- | ----------- |
| Challenge 1: S3 Storage Integration | 15         | Completed   |
| Challenge 2: Architecture Design    | 15         | Completed   |
| Challenge 3: CI/CD Pipeline         | 10         | Completed   |
| Challenge 4: Observability (Bonus)  | 10         | Completed   |
| **Total**                           | **50**     |             |

---

## The Problem

This microservice simulates a **real-world file download system** with variable processing times:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Download Processing Time                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Fast Downloads    ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ~10-15s    │
│  Medium Downloads  ████████████████████░░░░░░░░░░░░░░░░░░░░  ~30-60s    │
│  Slow Downloads    ████████████████████████████████████████  ~60-120s   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why does this matter?**

When deployed behind a reverse proxy (Cloudflare, nginx, AWS ALB), you encounter:

| Problem                 | Impact                                        |
| ----------------------- | --------------------------------------------- |
| **Connection Timeouts** | Cloudflare's 100s timeout kills long requests |
| **Gateway Errors**      | Users see 504 errors for slow downloads       |
| **Poor UX**             | No progress feedback during long waits        |
| **Resource Waste**      | Open connections consume server memory        |

---

## Solutions Implemented

### Challenge 1: S3 Storage Integration

**Self-hosted S3-compatible storage using RustFS**

- Added RustFS service to Docker Compose (dev & prod)
- Automatic bucket creation via init container
- Proper networking between services
- Health endpoint returns `{"status": "healthy", "checks": {"storage": "ok"}}`

**Files Modified:**
- `docker/compose.dev.yml`
- `docker/compose.prod.yml`

```bash
# Verify storage integration
curl http://localhost:3000/health
# Expected: {"status":"healthy","checks":{"storage":"ok"}}
```

### Challenge 2: Architecture Design

**Hybrid Polling + SSE pattern for long-running downloads**

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the complete design including:
- Architecture diagrams for fast/slow download paths
- API contract with new endpoints (`/status/:jobId`, `/events/:jobId`)
- Redis schema for job tracking
- BullMQ worker configuration
- Proxy configurations (nginx)
- Frontend React hooks with retry logic

### Challenge 3: CI/CD Pipeline

**GitHub Actions pipeline with 4 stages**

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    Lint     │───▶│    Test     │───▶│    Build    │    │  Security   │
│  (ESLint,   │    │   (E2E)     │    │  (Docker)   │    │   (CodeQL)  │
│  Prettier)  │    │             │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

**Features:**
- Triggers on push to `main`/`master`/`dev` and pull requests
- npm dependency caching
- Docker image build with layer caching
- CodeQL security analysis
- npm audit for vulnerability detection
- Concurrency control (cancels redundant runs)

**File:** `.github/workflows/ci.yml`

### Challenge 4: Observability Dashboard

**React + Vite dashboard with Sentry & OpenTelemetry**

| Feature             | Description                                    |
| ------------------- | ---------------------------------------------- |
| Health Status       | Real-time API health monitoring                |
| Download Jobs       | Track download job status and progress         |
| Error Log           | View errors captured by Sentry                 |
| Trace Viewer        | Link to Jaeger UI for distributed tracing      |
| Performance Metrics | API response times and success rates           |
| Download Tester     | Test download functionality with trace context |

**End-to-end tracing:**
```
Frontend (trace-id: abc123)
    │
    ▼ traceparent header
Backend logs: [trace_id=abc123]
    │
    ▼
Jaeger UI: View complete trace
```

**Directory:** `frontend/`

---

## API Testing & Implementation Verification

This section provides comprehensive testing commands to verify all hackathon challenges are properly implemented.

### Challenge 1: S3 Storage Integration Testing

#### Step 1: Start the Docker Environment

```bash
# Start development environment with all services
npm run docker:dev

# Wait for services to be ready (approximately 15-20 seconds)
# Check container status
docker ps
```

#### Step 2: Verify Health Endpoint (Storage Status)

```bash
# Test health endpoint - MUST return storage: "ok"
curl -s http://localhost:3000/health

# Expected Response:
# {
#   "status": "healthy",
#   "checks": {
#     "storage": "ok"
#   }
# }
```

#### Step 3: Verify S3 Bucket Creation

```bash
# Check if 'downloads' bucket exists in RustFS
curl -s http://localhost:9000/minio/health/live

# Access RustFS Console to verify bucket
# Open: http://localhost:9001
# Login: rustfsadmin / rustfsadmin
# Verify 'downloads' bucket exists
```

#### Step 4: Test File Download Check

```bash
# Check file availability (should work with S3 connection)
curl -s -X POST http://localhost:3000/v1/download/check \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}' | jq

# Expected: Returns file check status
```

#### Step 5: Run E2E Tests

```bash
# Run full E2E test suite (validates S3 integration)
npm run test:e2e

# Expected: All tests pass
# ✓ Health check returns healthy status
# ✓ Storage check returns ok
# ✓ Download endpoints respond correctly
```

---

### Challenge 2: Architecture Design Verification

The architecture design is documented in `ARCHITECTURE.md`. Verify the implementation:

#### Verify API Contract Endpoints

```bash
# 1. Test root endpoint
curl -s http://localhost:3000/

# Expected Response:
# {"message":"Hello Hono!"}

# 2. Test initiate bulk download
curl -s -X POST http://localhost:3000/v1/download/initiate \
  -H "Content-Type: application/json" \
  -d '{"file_ids": [70000, 70001, 70002]}'

# Expected Response:
# {
#   "jobId": "uuid-here",
#   "status": "queued",
#   "totalFileIds": 3
# }

# 3. Test single file check
curl -s -X POST http://localhost:3000/v1/download/check \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'

# Expected Response:
# {
#   "file_id": 70000,
#   "available": false,
#   "s3Key": null,
#   "size": null
# }

# 4. Test download start (with delay simulation)
curl -s -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'

# Note: This will take 5-15s in dev mode due to simulated delay
# Expected Response after delay:
# {
#   "file_id": 70000,
#   "status": "completed",
#   "downloadUrl": "presigned-s3-url",
#   "processedAt": "timestamp"
# }
```

#### Verify OpenAPI Documentation

```bash
# Access OpenAPI spec
curl -s http://localhost:3000/openapi | jq

# Access Scalar API Documentation UI
# Open: http://localhost:3000/docs
```

#### Verify Request Timeout Handling

```bash
# Test with production delays (10-120s) - demonstrates timeout issue
npm run start &

# This request may timeout (demonstrates the problem)
timeout 35 curl -s -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'

# Server logs will show:
# [Download] Starting file_id=70000 | delay=XXs (range: 10s-120s) | enabled=true
```

---

### Challenge 3: CI/CD Pipeline Testing

#### Step 1: Verify Local Lint & Format

```bash
# Run ESLint (must pass with no errors)
npm run lint

# Expected: No errors or warnings

# Check code formatting
npm run format:check

# Expected: All files properly formatted
```

#### Step 2: Run E2E Tests Locally

```bash
# Run full E2E test suite
npm run test:e2e

# Expected Output:
# ✓ Server health check
# ✓ Root endpoint returns welcome message
# ✓ Download initiate endpoint
# ✓ Download check endpoint
# ✓ Download start endpoint
# All tests passed!
```

#### Step 3: Build Docker Image

```bash
# Build production Docker image
docker build -t delineate-test -f docker/Dockerfile.prod .

# Expected: Build completes successfully

# Alternatively, use npm script
npm run docker:prod

# Verify image was created
docker images | grep delineate
```

#### Step 4: Verify CI Configuration

```bash
# View CI workflow configuration
cat .github/workflows/ci.yml

# Key stages to verify:
# - lint: ESLint + Prettier check
# - test: E2E tests
# - build: Docker image build
# - security: CodeQL + npm audit
```

#### Step 5: Check CI Badge Status

```bash
# CI badge URL (check in README)
# https://github.com/bongodev/cuet-micro-ops-hackthon-2025/actions/workflows/ci.yml/badge.svg

# View workflow runs
# https://github.com/bongodev/cuet-micro-ops-hackthon-2025/actions
```

---

### Challenge 4: Observability Dashboard Testing

#### Step 1: Start Full Stack with Docker

```bash
# Start all services including frontend dashboard
npm run docker:dev

# Wait for all containers to be ready (15-20 seconds)
docker ps

# Expected containers:
# - delineate-delineate-app-1        (port 3000)
# - delineate-delineate-dashboard-1  (port 5173)
# - delineate-delineate-jaeger-1     (ports 16686, 4318)
# - delineate-rustfs-1               (ports 9000, 9001)
# - delineate-redis-1                (port 6379) - for job queue
```

#### Step 2: Verify Dashboard Access

```bash
# Test dashboard is accessible
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173

# Expected: 200

# Open in browser: http://localhost:5173
```

#### Step 3: Verify Jaeger Tracing

```bash
# Test Jaeger UI is accessible
curl -s -o /dev/null -w "%{http_code}" http://localhost:16686

# Expected: 200

# Open Jaeger UI: http://localhost:16686
# Select service: "delineate-api" to view traces
```

#### Step 4: Test Sentry Error Tracking

```bash
# Trigger intentional error for Sentry testing
curl -s -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'

# Expected Response:
# {
#   "error": "Internal Server Error",
#   "message": "Sentry test error triggered for file_id=70000 - This should appear in Sentry!",
#   "requestId": "uuid-here"
# }

# If SENTRY_DSN is configured, this error appears in Sentry dashboard
```

#### Step 5: Verify Trace Propagation

```bash
# Make request with trace context header
curl -s -X POST http://localhost:3000/v1/download/check \
  -H "Content-Type: application/json" \
  -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" \
  -d '{"file_id": 70000}' | jq

# Check Jaeger UI for trace with ID: 4bf92f3577b34da6a3ce929d0e0e4736
# Open: http://localhost:16686/trace/4bf92f3577b34da6a3ce929d0e0e4736
```

#### Step 6: Test Dashboard Features

Open http://localhost:5173 and verify:

| Feature             | How to Test                                      |
| ------------------- | ------------------------------------------------ |
| Health Status       | Check green status indicator on dashboard        |
| Download Tester     | Click "Test Download" button                     |
| Error Log           | Trigger Sentry test error, check error list      |
| Trace Viewer        | Click "View in Jaeger" link after a request      |
| Performance Metrics | Make several requests, observe response times    |

---

### Complete Test Script

Run all tests in sequence:

```bash
#!/bin/bash
# complete-test.sh - Run all challenge verification tests

echo "=== CUET Hackathon Challenge Verification ==="
echo ""

# Challenge 1: S3 Storage
echo ">>> Challenge 1: S3 Storage Integration"
echo "Starting Docker environment..."
npm run docker:dev &
sleep 20

echo "Testing health endpoint..."
HEALTH=$(curl -s http://localhost:3000/health)
echo "Health: $HEALTH"

if echo "$HEALTH" | grep -q '"storage":"ok"'; then
  echo "✓ Challenge 1: PASSED - Storage integration working"
else
  echo "✗ Challenge 1: FAILED - Storage not connected"
fi
echo ""

# Challenge 2: Architecture (Documentation check)
echo ">>> Challenge 2: Architecture Design"
if [ -f "ARCHITECTURE.md" ]; then
  LINES=$(wc -l < ARCHITECTURE.md)
  echo "ARCHITECTURE.md exists with $LINES lines"
  echo "✓ Challenge 2: PASSED - Architecture documented"
else
  echo "✗ Challenge 2: FAILED - ARCHITECTURE.md missing"
fi
echo ""

# Challenge 3: CI/CD
echo ">>> Challenge 3: CI/CD Pipeline"
echo "Running lint..."
npm run lint
LINT_STATUS=$?

echo "Running format check..."
npm run format:check
FORMAT_STATUS=$?

echo "Running E2E tests..."
npm run test:e2e
E2E_STATUS=$?

if [ $LINT_STATUS -eq 0 ] && [ $FORMAT_STATUS -eq 0 ] && [ $E2E_STATUS -eq 0 ]; then
  echo "✓ Challenge 3: PASSED - All CI checks pass"
else
  echo "✗ Challenge 3: FAILED - Some CI checks failed"
fi
echo ""

# Challenge 4: Observability
echo ">>> Challenge 4: Observability Dashboard"
DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173)
JAEGER=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:16686)

if [ "$DASHBOARD" = "200" ] && [ "$JAEGER" = "200" ]; then
  echo "Dashboard status: $DASHBOARD"
  echo "Jaeger status: $JAEGER"
  echo "✓ Challenge 4: PASSED - Observability stack running"
else
  echo "✗ Challenge 4: FAILED - Services not accessible"
fi
echo ""

echo "=== Verification Complete ==="
```

---

### Production Mode Testing

```bash
# Start production environment
npm run docker:prod

# Test through API Gateway (nginx)
curl -s http://localhost/health | jq
curl -s http://localhost/v1/download/check \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}' | jq

# Access dashboard through gateway
# Open: http://localhost
```

---

### Expected Test Results Summary

| Test                          | Expected Result                                    |
| ----------------------------- | -------------------------------------------------- |
| `curl /health`                | `{"status":"healthy","checks":{"storage":"ok"}}`   |
| `npm run test:e2e`            | All tests pass                                     |
| `npm run lint`                | No errors                                          |
| `npm run format:check`        | All files formatted                                |
| Dashboard (http://5173)       | UI loads with health status                        |
| Jaeger UI (http://16686)      | Traces visible for delineate-api service           |
| Sentry test error             | Error captured (if DSN configured)                 |
| Docker build                  | Image builds successfully                          |

---

## Quick Start

### Prerequisites

| Requirement    | Version    |
| -------------- | ---------- |
| Node.js        | >= 24.10.0 |
| npm            | >= 10.x    |
| Docker         | >= 24.x    |
| Docker Compose | >= 2.x     |

### Local Development

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Start development server (5-15s delays, hot reload)
npm run dev

# Or start production server (10-120s delays)
npm run start
```

Server: http://localhost:3000
- API Documentation: http://localhost:3000/docs
- OpenAPI Spec: http://localhost:3000/openapi

### Using Docker

```bash
# Development mode (with Jaeger tracing)
npm run docker:dev

# Production mode (with API Gateway)
npm run docker:prod
```

**Development Access Points:**
| Service   | URL                    |
| --------- | ---------------------- |
| Dashboard | http://localhost:5173  |
| API       | http://localhost:3000  |
| Jaeger UI | http://localhost:16686 |
| RustFS    | http://localhost:9001  |

**Production Access Points:**
| Service     | URL                |
| ----------- | ------------------ |
| API Gateway | http://localhost   |

---

## Tech Stack

| Component       | Technology                                          |
| --------------- | --------------------------------------------------- |
| Runtime         | Node.js 24 with native TypeScript support           |
| Framework       | [Hono](https://hono.dev) - Ultra-fast web framework |
| Validation      | [Zod](https://zod.dev) with OpenAPI integration     |
| Storage         | RustFS (S3-compatible)                              |
| Observability   | OpenTelemetry + Jaeger                              |
| Error Tracking  | Sentry                                              |
| Documentation   | Scalar OpenAPI UI                                   |
| Frontend        | React + Vite + TailwindCSS                          |

---

## Project Structure

```
.
├── src/
│   └── index.ts              # Main application entry point
├── frontend/                 # Observability Dashboard (React + Vite)
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── hooks/            # Custom React hooks
│   │   └── lib/              # Sentry & OpenTelemetry setup
│   ├── Dockerfile            # Frontend Docker build
│   └── package.json
├── scripts/
│   ├── e2e-test.ts           # E2E test suite
│   └── run-e2e.ts            # Test runner with server management
├── docker/
│   ├── Dockerfile.dev        # Development Dockerfile
│   ├── Dockerfile.prod       # Production Dockerfile
│   ├── Dockerfile.gateway    # API Gateway Dockerfile (nginx)
│   ├── compose.dev.yml       # Development Docker Compose
│   └── compose.prod.yml      # Production Docker Compose
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions CI pipeline
├── ARCHITECTURE.md           # Long-running download architecture design
├── SUBMISSION.md             # This file
├── package.json
├── tsconfig.json
└── eslint.config.mjs
```

---

## API Endpoints

| Method | Endpoint                | Description                         |
| ------ | ----------------------- | ----------------------------------- |
| GET    | `/`                     | Welcome message                     |
| GET    | `/health`               | Health check with storage status    |
| POST   | `/v1/download/initiate` | Initiate bulk download job          |
| POST   | `/v1/download/check`    | Check single file availability      |
| POST   | `/v1/download/start`    | Start download with simulated delay |

### Testing Downloads

```bash
# With dev server (5-15s delays)
npm run dev
curl -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'

# Test Sentry integration
curl -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Server
NODE_ENV=development
PORT=3000

# S3 Configuration
S3_REGION=us-east-1
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=rustfsadmin
S3_SECRET_ACCESS_KEY=rustfsadmin
S3_BUCKET_NAME=downloads
S3_FORCE_PATH_STYLE=true

# Observability
SENTRY_DSN=                                    # Your Sentry DSN
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
JAEGER_UI_URL=http://localhost:16686

# Rate Limiting
REQUEST_TIMEOUT_MS=30000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGINS=*

# Download Delay Simulation
DOWNLOAD_DELAY_ENABLED=true
DOWNLOAD_DELAY_MIN_MS=10000
DOWNLOAD_DELAY_MAX_MS=120000
```

---

## Available Scripts

```bash
npm run dev          # Start dev server (5-15s delays, hot reload)
npm run start        # Start production server (10-120s delays)
npm run lint         # Run ESLint
npm run lint:fix     # Fix linting issues
npm run format       # Format code with Prettier
npm run format:check # Check code formatting
npm run test:e2e     # Run E2E tests
npm run docker:dev   # Start with Docker (development)
npm run docker:prod  # Start with Docker (production)
```

---

## CI/CD Pipeline

### Running Tests Locally

Before pushing changes, run:

```bash
# Run linting
npm run lint

# Check formatting
npm run format:check

# Run E2E tests
npm run test:e2e

# Build Docker image
npm run docker:prod
```

### For Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and ensure all tests pass
4. Push to your fork and create a Pull Request
5. Wait for CI checks to pass before requesting review

---

## Observability Setup

### Sentry Configuration

1. Create a project at [sentry.io](https://sentry.io)
2. Get your DSN from Project Settings > Client Keys
3. Add to your `.env` file:
   ```env
   SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   ```

### OpenTelemetry / Jaeger

Traces are automatically sent to Jaeger when running with Docker:

```bash
npm run docker:dev
# Open Jaeger UI: http://localhost:16686
```

### Frontend Dashboard Environment

Create `frontend/.env`:

```env
VITE_SENTRY_DSN=           # Your Sentry DSN
VITE_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
VITE_JAEGER_UI_URL=http://localhost:16686
```

---

## Security Features

- Request ID tracking for distributed tracing
- Rate limiting with configurable windows
- Security headers (HSTS, X-Frame-Options, etc.)
- CORS configuration
- Input validation with Zod schemas
- Path traversal prevention for S3 keys
- Graceful shutdown handling
- CodeQL security scanning in CI
- npm audit for dependency vulnerabilities

---

## Docker Services

### Development (`compose.dev.yml`)

| Service              | Port(s)     | Description                    |
| -------------------- | ----------- | ------------------------------ |
| delineate-app        | 3000        | Main API server                |
| delineate-dashboard  | 5173        | React observability dashboard  |
| delineate-jaeger     | 16686, 4318 | Jaeger tracing UI & collector  |
| redis                | 6379        | Job queue (BullMQ)             |
| rustfs               | 9000, 9001  | S3-compatible storage          |
| rustfs-init          | -           | Bucket initialization          |

### Production (`compose.prod.yml`)

| Service              | Port | Description                           |
| -------------------- | ---- | ------------------------------------- |
| delineate-gateway    | 80   | nginx API gateway                     |
| delineate-app        | -    | Main API server (internal)            |
| delineate-dashboard  | -    | React dashboard (internal)            |
| rustfs               | -    | S3-compatible storage (internal)      |
| rustfs-init          | -    | Bucket initialization                 |

---

## Deliverables Checklist

### Challenge 1: S3 Storage Integration
- [x] Add S3-compatible storage service (RustFS) to Docker Compose
- [x] Create `downloads` bucket on startup
- [x] Configure proper networking between services
- [x] Update environment variables for API connectivity
- [x] Pass all E2E tests (`npm run test:e2e`)
- [x] Health endpoint returns `{"status": "healthy", "checks": {"storage": "ok"}}`

### Challenge 2: Architecture Design
- [x] `ARCHITECTURE.md` document created
- [x] Architecture diagrams (high-level, fast path, slow path)
- [x] Technical approach with pattern justification
- [x] API contract changes documented
- [x] Database/cache schema (Redis)
- [x] Background job processing (BullMQ)
- [x] Error handling and retry logic
- [x] Timeout configuration at each layer
- [x] Proxy configuration (Cloudflare, nginx, AWS ALB)
- [x] Frontend integration (React hooks, components)

### Challenge 3: CI/CD Pipeline
- [x] `.github/workflows/ci.yml` configuration
- [x] Trigger on push to `main`/`master`/`dev`
- [x] Trigger on pull requests
- [x] Run linting (`npm run lint`)
- [x] Run format check (`npm run format:check`)
- [x] Run E2E tests (`npm run test:e2e`)
- [x] Build Docker image
- [x] Cache dependencies for faster builds
- [x] Fail fast on errors
- [x] Security scanning (CodeQL, npm audit)
- [x] CI badge in README

### Challenge 4: Observability Dashboard
- [x] React application in `frontend/` directory
- [x] Sentry integration (error boundary, automatic capture)
- [x] OpenTelemetry integration (trace propagation)
- [x] Health Status display
- [x] Download Jobs tracking
- [x] Error Log viewer
- [x] Trace Viewer (Jaeger link)
- [x] Performance Metrics
- [x] Docker Compose includes frontend & Jaeger
- [x] Documentation for setup

---

## Resources

- [Hono Documentation](https://hono.dev/docs/)
- [Sentry React SDK](https://docs.sentry.io/platforms/javascript/guides/react/)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/instrumentation/js/)
- [Jaeger UI](https://www.jaegertracing.io/)
- [RustFS](https://github.com/rustfs/rustfs)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

---

## License

MIT
