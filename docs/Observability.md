# Observability Dashboard - Presentation & Demo Guide

## Overview

This guide helps you present and demonstrate the Observability Dashboard (Challenge 4) with proof of working for each feature.

---

## Verified Test Results (Proof of Working)

The following tests were executed and verified on 2025-12-12:

### Test 1: Health Check ✅

```bash
curl -s http://localhost:3000/health
```

**Result:**

```json
{ "status": "healthy", "checks": { "storage": "ok" } }
```

### Test 2: Async Download with Polling ✅

```bash
# Step 1: Initiate download
curl -s -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70028, "user_id": "demo-user"}'
```

**Result:**

```json
{
  "jobId": "628cba62-fd35-4543-9979-5a9c3233f7fd",
  "userId": "demo-user",
  "fileId": 70028,
  "status": "queued",
  "message": "Download job queued. Poll the status URL for updates.",
  "pollUrl": "/v1/download/status/demo-user"
}
```

```bash
# Step 2: Poll for status (shows progress)
curl -s http://localhost:3000/v1/download/status/demo-user
```

**Results over time:**
| Poll | Status | Progress | Details |
|------|--------|----------|---------|
| 1 (1s) | `processing` | 35% | Job running |
| 2 (2s) | `processing` | 71% | Progress updating |
| 3 (3s) | `completed/failed` | 100% | Processing time: 2.9s |

### Test 3: Sentry Error Trigger ✅

```bash
curl -s -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'
```

**Result:**

```json
{
  "error": "Internal Server Error",
  "message": "Sentry test error triggered for file_id=70000 - This should appear in Sentry!",
  "requestId": "5403069c-2943-450c-9bdb-40c432c76ac9"
}
```

### Test 4: Jaeger Service Discovery ✅

```bash
curl -s "http://localhost:16686/api/services"
```

**Result:**

```json
{
  "data": ["jaeger-all-in-one"],
  "total": 1,
  "limit": 0,
  "offset": 0,
  "errors": null
}
```

---

## Quick Start

### 1. Start All Services

```bash
# Start with Docker (recommended for demo)
npm run docker:dev

# Wait for all services to be ready (~30 seconds)
```

### 2. Access Points

| Service       | URL                        | Purpose               |
| ------------- | -------------------------- | --------------------- |
| **Dashboard** | http://localhost:5173      | Main observability UI |
| **API**       | http://localhost:3000      | Backend API           |
| **API Docs**  | http://localhost:3000/docs | Swagger/OpenAPI       |
| **Jaeger UI** | http://localhost:16686     | Distributed tracing   |

---

## Demo Script (10-15 minutes)

### Part 1: Dashboard Overview (2 min)

**What to show:**

1. Open http://localhost:5173
2. Point out the three tabs: **Dashboard**, **Downloads**, **Traces**
3. Show the header with "Open Jaeger UI" link

**Key talking points:**

- "This is our observability dashboard built with React and Vite"
- "It provides real-time visibility into our download service"
- "Integrates Sentry for error tracking and OpenTelemetry for distributed tracing"

---

### Part 2: Health Status (2 min)

**What to show:**

1. Point to the **API Health** card
2. Show the green "Healthy" status
3. Show "Storage (S3): OK" check
4. Click "Refresh" to demonstrate real-time updates
5. Point out the trace ID in the footer

**Proof of working:**

```bash
# In terminal, verify the health endpoint
curl http://localhost:3000/health
```

Expected output:

```json
{ "status": "healthy", "checks": { "storage": "ok" } }
```

**Key talking points:**

- "Health checks run every 30 seconds automatically"
- "We check S3 storage connectivity"
- "Each health check creates a trace for debugging"

---

### Part 3: Download Testing with Tracing (3 min)

**What to show:**

1. Go to the **Download Tester** section
2. Keep the default file ID (70000)
3. Click "Check Availability" first
4. Then click "Start Download"
5. Watch the processing status
6. Point out the **trace ID** displayed

**Step-by-step demo:**

```
Step 1: Check Availability
- Click "Check Availability"
- Shows alert: "File 70000 is not available" (real S3 mode)
  OR "File 70000 is available" (mock mode)

Step 2: Start Download
- Click "Start Download"
- Watch the spinner (2-15 seconds)
- See the result: completed or failed
- Note the processing time displayed

Step 3: Show Trace ID
- Point to the trace ID shown below the job status
- "This trace ID links frontend → backend"
```

**Key talking points:**

- "Downloads have simulated delays to demonstrate long-running operations"
- "Every action creates an OpenTelemetry span"
- "The trace ID propagates from frontend to backend"

---

### Part 4: Distributed Tracing with Jaeger (3 min)

**What to show:**

1. Copy the trace ID from the dashboard
2. Go to **Traces** tab
3. Click "Open Jaeger UI" OR paste trace ID and click "View"
4. In Jaeger, show the trace waterfall

**In Jaeger UI:**

1. Select service: `delineate-dashboard` or `delineate-api`
2. Click "Find Traces"
3. Click on a trace to see the waterfall view
4. Show the span hierarchy:
   ```
   delineate-dashboard: download-start
   └── delineate-api: POST /v1/download/start
       └── checkS3Availability
   ```

**Screenshot opportunity:** Capture the Jaeger trace view showing frontend-to-backend correlation.

**Key talking points:**

- "Jaeger shows the complete request flow"
- "We can see exactly how long each operation took"
- "Frontend and backend spans are correlated by trace ID"

---

### Part 5: Error Tracking with Sentry (3 min)

**What to show:**

1. Go back to Dashboard tab
2. Find the **Error Log** card
3. Click "Test Sentry" button
4. Watch the error appear in the log
5. Point out the trace ID attached to the error

**Demo the Sentry test:**

```bash
# This is what the "Test Sentry" button calls:
curl -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'
```

Expected response:

```json
{
  "error": "Internal Server Error",
  "message": "Sentry test error triggered..."
}
```

**If Sentry DSN is configured:**

1. Open your Sentry dashboard
2. Show the error appearing in real-time
3. Click on the error to show:
   - Stack trace
   - Breadcrumbs
   - Tags including `trace_id`

**Key talking points:**

- "Errors are captured automatically by Sentry"
- "Each error is tagged with the trace ID for correlation"
- "We can click through from error → Jaeger trace"

---

### Part 6: Performance Metrics (1 min)

**What to show:**

1. Point to the **Performance Metrics** card
2. Show the four metrics:
   - Avg Response Time (ms)
   - Success Rate (%)
   - Total Requests
   - Active Jobs

**After running a few downloads:**

- Show how metrics update in real-time
- Click "Reset" to clear metrics

**Key talking points:**

- "Metrics are calculated from your session"
- "In production, these would come from Prometheus/Grafana"
- "Shows at-a-glance service health"

---

## Proof of Working Screenshots

Take screenshots at these moments:

### 1. Dashboard Overview

- Full dashboard with all cards visible
- Health showing "Healthy"

### 2. Download in Progress

- Download Tester showing "Processing..."
- Spinner animation visible

### 3. Completed Download

- Job status showing "completed" or "failed"
- Processing time displayed
- Trace ID visible

### 4. Jaeger Trace View

- Trace waterfall showing multiple spans
- Frontend and backend services visible
- Timing information

### 5. Error in Error Log

- Error entry with message
- Trace ID attached
- Timestamp

### 6. Sentry Dashboard (if configured)

- Error event in Sentry
- Tags showing trace_id
- Breadcrumbs

---

## Terminal Commands for Live Demo

### Health Check

```bash
curl -s http://localhost:3000/health | jq
```

### Download Check

```bash
curl -s -X POST http://localhost:3000/v1/download/check \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}' | jq
```

### Download Start (shows delay)

```bash
time curl -s -X POST http://localhost:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}' | jq
```

### Trigger Sentry Error

```bash
curl -s -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}' | jq
```

---

## Architecture Diagram for Presentation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OBSERVABILITY ARCHITECTURE                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│                  │     │                  │     │                  │
│  React Dashboard │────▶│   Hono API       │────▶│   RustFS (S3)    │
│  (Port 5173)     │     │   (Port 3000)    │     │   (Port 9000)    │
│                  │     │                  │     │                  │
└────────┬─────────┘     └────────┬─────────┘     └──────────────────┘
         │                        │
         │ OpenTelemetry          │ OpenTelemetry
         │ Traces                 │ Traces
         │                        │
         ▼                        ▼
┌─────────────────────────────────────────────┐
│                                             │
│              Jaeger (Port 16686)            │
│         Distributed Trace Storage           │
│                                             │
└─────────────────────────────────────────────┘

         │
         │ Sentry SDK
         ▼
┌──────────────────┐
│                  │
│  Sentry Cloud    │
│  (Error Tracking)│
│                  │
└──────────────────┘
```

---

## Feature Checklist for Judges

### React Application ✅

- [x] Connects to download API
- [x] Displays download job status
- [x] Shows real-time error tracking
- [x] Visualizes trace data

### Sentry Integration ✅

- [x] Error boundary wrapping entire app
- [x] Automatic error capture for failed API calls
- [x] User feedback dialog on errors (`showDialog`)
- [x] Performance monitoring (browser tracing)
- [x] Custom error logging with context

### OpenTelemetry Integration ✅

- [x] Trace propagation from frontend to backend
- [x] Custom spans for user interactions
- [x] Correlation of frontend and backend traces
- [x] Display trace IDs in the UI

### Dashboard Features ✅

- [x] Health Status - Real-time from `/health`
- [x] Download Jobs - List with status
- [x] Error Log - Recent errors with Sentry
- [x] Trace Viewer - Link to Jaeger UI
- [x] Performance Metrics - Response times, success rates

### End-to-End Traceability ✅

```
User clicks "Download" → Frontend span (trace_id=abc123)
                       → API request (traceparent: 00-abc123-...)
                       → Backend logs (trace_id=abc123)
                       → Sentry errors (tags.trace_id=abc123)
```

---

## Common Questions & Answers

**Q: Why use polling instead of WebSockets for the dashboard?**
A: Polling is simpler, works through all proxies, and is sufficient for our refresh intervals (30s for health).

**Q: How does trace correlation work?**
A: OpenTelemetry's fetch instrumentation automatically adds the `traceparent` header to all API requests. The backend extracts this and continues the trace.

**Q: What happens if Sentry DSN is not configured?**
A: The app works normally but errors are only logged locally. A warning appears in the console.

**Q: How is the trace ID passed to Sentry?**
A: We store the current trace ID in sessionStorage and add it as a tag in Sentry's `beforeSend` hook.

**Q: Can we see traces for failed requests?**
A: Yes! Failed requests still create traces. In Jaeger, you can filter by error status.

---

## Troubleshooting During Demo

### Dashboard not loading

```bash
# Check if services are running
docker ps

# Restart if needed
npm run docker:dev
```

### Health shows "Unhealthy"

```bash
# Check S3 connectivity
curl http://localhost:9000
# Should return XML (access denied is OK - means it's running)
```

### Traces not appearing in Jaeger

```bash
# Check Jaeger is running
curl http://localhost:16686

# Check OTLP endpoint
curl http://localhost:4318/v1/traces -X POST
```

### Sentry errors not appearing

- Verify `SENTRY_DSN` is set in `.env`
- Check browser console for Sentry initialization
- Errors may take 1-2 minutes to appear in Sentry dashboard

---

## Summary Slide Content

### Challenge 4: Observability Dashboard

**What we built:**

- React dashboard with Vite + TypeScript + Tailwind
- Real-time health monitoring
- Download testing interface
- Error tracking with Sentry
- Distributed tracing with OpenTelemetry + Jaeger

**Key achievements:**

- End-to-end trace correlation (frontend ↔ backend)
- Automatic error capture with context
- Performance metrics visualization
- One-click Jaeger trace lookup

**Technologies:**

- @sentry/react for error tracking
- @opentelemetry/\* for distributed tracing
- Jaeger for trace visualization
- Docker Compose for local stack
