# Distributed Tracing Guide

This document explains how distributed tracing is implemented in the Delineate application using OpenTelemetry and Jaeger.

## Overview

Distributed tracing allows you to track requests as they flow through your system, from the frontend to the backend and any external services. This is essential for:

- Debugging performance issues
- Understanding request flows
- Identifying bottlenecks
- Correlating errors across services

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│     Backend     │────▶│    S3/Redis     │
│   (Browser)     │     │   (Node.js)     │     │   (External)    │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         │  OTLP/HTTP            │  OTLP/HTTP
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Jaeger                                   │
│                   (Trace Collector & UI)                        │
│                   http://localhost:16686                         │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Frontend Tracing (Browser)

**Location:** `frontend/src/lib/tracing.ts`

**Technology:** OpenTelemetry Web SDK

**Service Name:** `delineate-dashboard`

**Key Features:**
- Automatic fetch instrumentation (traces all API calls)
- Trace context propagation via `traceparent` header
- Session storage of current trace ID for Sentry correlation

```typescript
// Initialization
import { initTracing } from './lib/tracing';
initTracing(); // Called in main.tsx

// Creating custom spans
import { createSpan, getCurrentTraceId } from './lib/tracing';

const result = await createSpan('download-start', async () => {
  return fetch('/api/v1/download/start', { ... });
}, {
  'download.file_id': fileId,
  'download.user_id': userId,
});
```

### 2. Backend Tracing (Node.js)

**Location:** `src/instrument.js`

**Technology:** OpenTelemetry Node.js SDK

**Service Name:** `delineate-hackathon-challenge`

**Key Features:**
- Automatic HTTP instrumentation
- Automatic fetch instrumentation
- Redis instrumentation
- AWS SDK instrumentation (S3 calls)
- Trace context extraction from incoming requests

```javascript
// instrument.js is imported first in index.js
import { Sentry, shutdownOtel } from "./instrument.js";

// Middleware for HTTP instrumentation
app.use(httpInstrumentationMiddleware({
  serviceName: "delineate-hackathon-challenge",
}));
```

### 3. Jaeger (Trace Collector)

**Image:** `jaegertracing/all-in-one:latest`

**Ports:**
- `16686` - Jaeger UI (web interface)
- `4318` - OTLP HTTP receiver (for traces)

**Environment Variables:**
```yaml
environment:
  - COLLECTOR_OTLP_ENABLED=true
  - COLLECTOR_OTLP_HTTP_CORS_ALLOWED_ORIGINS=*
  - COLLECTOR_OTLP_HTTP_CORS_ALLOWED_HEADERS=*
```

## Trace Propagation

### How Traces Flow

1. **Frontend creates a trace:**
   ```
   Browser starts span "download-start"
   Trace ID: abc123def456...
   ```

2. **Frontend sends request with trace context:**
   ```http
   POST /api/v1/download/start
   traceparent: 00-abc123def456...-789xyz...-01
   ```

3. **Backend extracts trace context:**
   ```
   Backend receives traceparent header
   Creates child span under same Trace ID
   ```

4. **Backend makes downstream calls:**
   ```
   S3 operations, Redis operations
   All linked to same Trace ID
   ```

5. **All spans sent to Jaeger:**
   ```
   Frontend span → Jaeger (port 4318)
   Backend span → Jaeger (port 4318)
   ```

### The `traceparent` Header

Format: `{version}-{trace-id}-{parent-id}-{trace-flags}`

Example: `00-8ee93ab4bb162c407848389b8810da96-c17f33ff15a29d9c-01`

- `00` - Version
- `8ee93ab4bb162c407848389b8810da96` - Trace ID (32 hex chars)
- `c17f33ff15a29d9c` - Parent Span ID (16 hex chars)
- `01` - Trace Flags (sampled)

## Configuration

### Environment Variables

#### Frontend (Build-time)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` | Jaeger OTLP endpoint | `http://localhost:4318` |

#### Backend (Runtime)

| Variable | Description | Example |
|----------|-------------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Jaeger OTLP endpoint | `http://delineate-jaeger:4318` |

### Docker Compose Configuration

```yaml
# Backend
delineate-app:
  environment:
    - OTEL_EXPORTER_OTLP_ENDPOINT=http://delineate-jaeger:4318

# Frontend (build arg)
delineate-dashboard:
  build:
    args:
      - VITE_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Jaeger
delineate-jaeger:
  image: jaegertracing/all-in-one:latest
  ports:
    - "16686:16686"  # UI
    - "4318:4318"    # OTLP HTTP
  environment:
    - COLLECTOR_OTLP_ENABLED=true
    - COLLECTOR_OTLP_HTTP_CORS_ALLOWED_ORIGINS=*
    - COLLECTOR_OTLP_HTTP_CORS_ALLOWED_HEADERS=*
```

## Using Jaeger UI

### Finding Traces

1. Open http://localhost:16686
2. Select **Service** dropdown:
   - `delineate-dashboard` - Frontend traces
   - `delineate-hackathon-challenge` - Backend traces
3. Optionally filter by:
   - **Operation** - Specific endpoint (GET, POST, etc.)
   - **Tags** - e.g., `http.status_code=200`
   - **Lookback** - Time range
   - **Min/Max Duration** - Filter by response time
4. Click **Find Traces**

### Reading a Trace

```
Trace: 8ee93ab4bb162c407848389b8810da96
├── delineate-dashboard: download-start (12.5s)
│   └── delineate-hackathon-challenge: POST /v1/download/start (50ms)
│       ├── redis: SET download:user123 (2ms)
│       └── S3: HeadObject (15ms)
└── delineate-hackathon-challenge: GET /v1/download/status/user123 (5ms)
    └── redis: GET download:user123 (1ms)
```

Each span shows:
- **Service name** - Which service executed the span
- **Operation name** - What operation was performed
- **Duration** - How long it took
- **Tags** - Metadata (HTTP method, status code, etc.)
- **Logs** - Events within the span

### Trace ID Lookup

1. Get trace ID from:
   - Jaeger search results
   - Browser DevTools (Network → traceparent header)
   - Application logs
   - Sentry error (tagged with trace ID)

2. In Jaeger, use the search box at top-right: "Lookup by Trace ID"

3. Or go directly to: `http://localhost:16686/trace/{traceId}`

## Integration with Sentry

Traces are correlated with Sentry errors for debugging:

```javascript
// Frontend: lib/sentry.ts
Sentry.setTag('trace_id', getCurrentTraceId());

// When an error occurs, Sentry captures:
// - Error details
// - trace_id tag
// - Breadcrumbs with trace context
```

This allows you to:
1. See an error in Sentry
2. Get the trace ID from the error tags
3. Look up the full trace in Jaeger
4. Understand what happened before the error

## Troubleshooting

### Frontend traces not appearing

1. **Check browser console** for:
   ```
   OpenTelemetry tracing initialized
   ```
   If you see "OTEL endpoint not configured", rebuild the frontend:
   ```bash
   docker compose -f docker/compose.dev.yml up -d --build delineate-dashboard
   ```

2. **Check for CORS errors** in browser console:
   - Ensure Jaeger has CORS enabled
   - Verify `COLLECTOR_OTLP_HTTP_CORS_ALLOWED_ORIGINS=*`

3. **Verify build args** are passed in docker-compose:
   ```yaml
   args:
     - VITE_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   ```

### Backend traces not appearing

1. **Check backend logs**:
   ```bash
   docker compose -f docker/compose.dev.yml logs delineate-app | grep OTEL
   ```
   Should show: `[OTEL] Tracing enabled: http://delineate-jaeger:4318`

2. **Verify Jaeger is running**:
   ```bash
   curl http://localhost:16686/api/services
   ```

3. **Make some requests** to generate traces:
   ```bash
   curl http://localhost:3000/health
   curl http://localhost:3000/v1/files
   ```

### Jaeger not receiving traces

1. **Check Jaeger logs**:
   ```bash
   docker compose -f docker/compose.dev.yml logs delineate-jaeger
   ```

2. **Verify OTLP endpoint is accessible**:
   ```bash
   curl -v http://localhost:4318/v1/traces
   ```

3. **Restart Jaeger**:
   ```bash
   docker compose -f docker/compose.dev.yml restart delineate-jaeger
   ```

## Best Practices

1. **Use meaningful span names**:
   ```javascript
   createSpan('download-file', ...) // Good
   createSpan('operation1', ...)    // Bad
   ```

2. **Add relevant attributes**:
   ```javascript
   createSpan('download', fn, {
     'file.id': fileId,
     'user.id': userId,
     'file.size': size,
   });
   ```

3. **Propagate context** in async operations:
   ```javascript
   // Context is automatically propagated within createSpan callback
   await createSpan('parent', async () => {
     await createSpan('child', async () => {
       // This span is correctly parented
     });
   });
   ```

4. **Use trace IDs in logs**:
   ```javascript
   console.log(`[trace_id=${getCurrentTraceId()}] Processing download`);
   ```

## Files Reference

| File | Description |
|------|-------------|
| `frontend/src/lib/tracing.ts` | Frontend OpenTelemetry setup |
| `frontend/src/main.tsx` | Calls `initTracing()` |
| `src/instrument.js` | Backend OpenTelemetry setup |
| `src/index.js` | Uses `httpInstrumentationMiddleware` |
| `docker/compose.dev.yml` | Jaeger and env var configuration |
| `frontend/Dockerfile` | Build args for VITE_OTEL_* |
