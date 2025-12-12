# Long-Running Download Architecture Design

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Technical Approach](#technical-approach)
4. [Implementation Details](#implementation-details)
5. [Proxy Configuration](#proxy-configuration)
6. [Frontend Integration](#frontend-integration)
7. [Error Handling & Resilience](#error-handling--resilience)

---

## Problem Statement

The download microservice handles file operations with variable processing times:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Download Processing Time                            │
├─────────────────────────────────────────────────────────────────────────┤
│ Fast Downloads    ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ~10-15s   │
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

---

## Architecture Overview

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/Next.js)                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Download   │    │   Status     │    │   Progress   │    │   Download   │       │
│  │   Button     │───▶│   Polling    │───▶│   Display    │───▶│   Complete   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘       │
└────────────┬───────────────┬───────────────────┬────────────────────────────────────┘
             │               │                   │
             │ POST          │ GET               │ SSE (optional)
             │ /initiate     │ /status/:jobId    │ /events/:jobId
             ▼               ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           REVERSE PROXY (Cloudflare/nginx)                          │
│                          ┌─────────────────────────────────┐                        │
│                          │  - Request timeout: 30s         │                        │
│                          │  - WebSocket/SSE passthrough    │                        │
│                          │  - Rate limiting                │                        │
│                          └─────────────────────────────────┘                        │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY (Hono)                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           Request Handlers                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │   │
│  │  │ POST         │  │ GET          │  │ GET          │  │ GET          │     │   │
│  │  │ /initiate    │  │ /status/:id  │  │ /events/:id  │  │ /download/:id│     │   │
│  │  │ Returns: <5s │  │ Returns: <1s │  │ SSE Stream   │  │ Presigned URL│     │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │   │
│  └─────────┼─────────────────┼─────────────────┼─────────────────┼─────────────┘   │
│            │                 │                 │                 │                  │
│            ▼                 ▼                 ▼                 ▼                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           Job Manager                                        │   │
│  │  - Create jobs      - Query status      - Push updates    - Generate URLs    │   │
│  │  - Queue tasks      - Return progress   - Event stream    - Validate access  │   │
│  └──────────────────────────────────┬──────────────────────────────────────────┘   │
└─────────────────────────────────────┼───────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│     Redis Cache      │  │     Job Queue        │  │     S3 Storage       │
│  ┌────────────────┐  │  │  ┌────────────────┐  │  │  ┌────────────────┐  │
│  │ Job Status     │  │  │  │ BullMQ         │  │  │  │ RustFS/MinIO   │  │
│  │ - pending      │  │  │  │                │  │  │  │                │  │
│  │ - processing   │  │  │  │ Workers        │  │  │  │ downloads/     │  │
│  │ - completed    │  │  │  │ ┌────────────┐ │  │  │  │ ├── 70000.zip  │  │
│  │ - failed       │  │  │  │ │ Worker 1   │ │  │  │  │ ├── 70001.zip  │  │
│  │                │  │  │  │ │ Worker 2   │ │  │  │  │ └── ...        │  │
│  │ Progress %     │  │  │  │ │ Worker N   │ │  │  │  └────────────────┘  │
│  │ TTL: 24h       │  │  │  │ └────────────┘ │  │  │                      │
│  └────────────────┘  │  │  └────────────────┘  │  │  Presigned URLs      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

### Data Flow Diagrams

#### Fast Download Path (~10-15s)

```
Client              API                Queue               Worker              S3
  │                  │                   │                   │                  │
  │ POST /initiate   │                   │                   │                  │
  │─────────────────▶│                   │                   │                  │
  │                  │ Create Job        │                   │                  │
  │                  │──────────────────▶│                   │                  │
  │ { jobId: abc }   │                   │                   │                  │
  │◀─────────────────│                   │                   │                  │
  │                  │                   │ Process Job       │                  │
  │                  │                   │──────────────────▶│                  │
  │                  │                   │                   │ HEAD Object      │
  │                  │                   │                   │─────────────────▶│
  │                  │                   │                   │ 200 OK           │
  │                  │                   │                   │◀─────────────────│
  │                  │                   │ Job Complete      │                  │
  │                  │                   │◀──────────────────│                  │
  │ GET /status/abc  │                   │                   │                  │
  │─────────────────▶│                   │                   │                  │
  │ { status: done } │                   │                   │                  │
  │◀─────────────────│                   │                   │                  │
  │                  │                   │                   │                  │
  │ GET /download/abc│                   │                   │                  │
  │─────────────────▶│                   │                   │                  │
  │ { url: presigned}│                   │                   │                  │
  │◀─────────────────│                   │                   │                  │
```

#### Slow Download Path with Progress Updates (~60-120s)

```
Client              API                Queue               Worker              S3
  │                  │                   │                   │                  │
  │ POST /initiate   │                   │                   │                  │
  │─────────────────▶│                   │                   │                  │
  │ { jobId: xyz }   │                   │                   │                  │
  │◀─────────────────│                   │                   │                  │
  │                  │                   │ Enqueue           │                  │
  │                  │                   │──────────────────▶│                  │
  │                  │                   │                   │                  │
  │─────── Poll Loop (every 3s) ────────│                   │                  │
  │                  │                   │                   │                  │
  │ GET /status/xyz  │                   │                   │                  │
  │─────────────────▶│ { status: processing, progress: 25% }│                  │
  │◀─────────────────│                   │                   │                  │
  │                  │                   │                   │ Processing...    │
  │ GET /status/xyz  │                   │                   │─────────────────▶│
  │─────────────────▶│ { status: processing, progress: 50% }│                  │
  │◀─────────────────│                   │                   │                  │
  │                  │                   │                   │                  │
  │ GET /status/xyz  │                   │                   │                  │
  │─────────────────▶│ { status: processing, progress: 75% }│                  │
  │◀─────────────────│                   │                   │                  │
  │                  │                   │                   │                  │
  │ GET /status/xyz  │                   │                   │ Complete         │
  │─────────────────▶│ { status: completed, downloadUrl }   │◀─────────────────│
  │◀─────────────────│                   │                   │                  │
```

---

## Technical Approach

### Chosen Pattern: Hybrid (Polling + Optional SSE)

I recommend a **Hybrid approach** combining polling with optional Server-Sent Events (SSE) for the following reasons:

#### Why Not Pure Polling?

- Inefficient for long-running jobs (many wasted requests)
- Increased server load
- Latency in detecting completion

#### Why Not Pure WebSocket/SSE?

- Complex connection management
- Not all proxies support long-lived connections
- Connection drops require reconnection logic

#### Why Hybrid?

| Feature                  | Benefit                                          |
| ------------------------ | ------------------------------------------------ |
| **Polling as Primary**   | Works through all proxies, simple implementation |
| **SSE as Enhancement**   | Real-time updates when supported                 |
| **Graceful Degradation** | Falls back to polling if SSE unavailable         |
| **Proxy Compatible**     | Short-lived requests avoid timeout issues        |
| **Resource Efficient**   | SSE reduces polling frequency                    |

### Pattern Comparison

```
┌────────────────┬────────────┬────────────┬────────────┬────────────┐
│    Pattern     │  Latency   │ Complexity │   Proxy    │  Resource  │
│                │            │            │ Compatible │   Usage    │
├────────────────┼────────────┼────────────┼────────────┼────────────┤
│ Polling        │   Medium   │    Low     │    High    │   Medium   │
│ WebSocket      │    Low     │    High    │   Medium   │    Low     │
│ SSE            │    Low     │   Medium   │   Medium   │    Low     │
│ Webhook        │    Low     │   Medium   │    High    │    Low     │
│ Hybrid (Rec.)  │    Low     │   Medium   │    High    │    Low     │
└────────────────┴────────────┴────────────┴────────────┴────────────┘
```

---

## Implementation Details

### 1. API Contract Changes

#### Existing Endpoints (Modified)

```typescript
// POST /v1/download/initiate - MODIFIED
// Now returns immediately with jobId, processes asynchronously

interface InitiateRequest {
  file_ids: number[]; // Array of file IDs (10K to 100M)
}

interface InitiateResponse {
  jobId: string; // UUID for tracking
  status: "queued"; // Always queued initially
  totalFiles: number; // Count of files requested
  estimatedTimeMs: number; // Estimated processing time
  statusUrl: string; // URL to check status
  createdAt: string; // ISO timestamp
}
```

#### New Endpoints

```typescript
// GET /v1/download/status/:jobId - NEW
// Returns current job status (fast, <1s response)

interface StatusResponse {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  progress: number; // 0-100 percentage
  currentFile?: number; // Currently processing file ID
  processedFiles: number; // Count of completed files
  totalFiles: number; // Total files in job
  startedAt?: string; // When processing began
  completedAt?: string; // When job finished
  downloadUrl?: string; // Available when completed
  expiresAt?: string; // When download URL expires
  error?: {
    code: string;
    message: string;
  };
}

// GET /v1/download/events/:jobId - NEW (SSE)
// Server-Sent Events stream for real-time updates

// Event types:
// - progress: { progress: number, currentFile: number }
// - completed: { downloadUrl: string, expiresAt: string }
// - failed: { error: { code: string, message: string } }
// - heartbeat: { timestamp: string }

// GET /v1/download/:jobId - NEW
// Returns presigned download URL (only when completed)

interface DownloadResponse {
  jobId: string;
  downloadUrl: string; // Presigned S3 URL
  expiresAt: string; // URL expiration time
  fileSize: number; // Total size in bytes
  checksum?: string; // Optional MD5/SHA256
}

// DELETE /v1/download/:jobId - NEW
// Cancel a pending/processing job

interface CancelResponse {
  jobId: string;
  status: "cancelled";
  message: string;
}
```

### 2. Database/Cache Schema

#### Redis Data Structures

```typescript
// Job metadata (Hash)
// Key: job:{jobId}
// TTL: 24 hours after completion

interface JobHash {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  fileIds: string; // JSON array of file IDs
  totalFiles: number;
  processedFiles: number;
  progress: number; // 0-100
  currentFile: number | null;
  createdAt: number; // Unix timestamp
  startedAt: number | null;
  completedAt: number | null;
  downloadUrl: string | null;
  downloadExpiresAt: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  userId: string | null; // Optional user tracking
  retryCount: number;
}

// Active jobs set (for monitoring)
// Key: jobs:active
// Type: Sorted Set (score = createdAt timestamp)

// User job tracking (for rate limiting per user)
// Key: user:{userId}:jobs
// Type: List of jobIds
// TTL: 1 hour

// Job events stream (for SSE)
// Key: job:{jobId}:events
// Type: Stream
// TTL: 1 hour after job completion
```

#### Redis Commands Example

```bash
# Create new job
HSET job:abc123 id "abc123" status "queued" totalFiles 5 ...
ZADD jobs:active 1702400000 "abc123"
EXPIRE job:abc123 86400

# Update progress
HSET job:abc123 status "processing" progress 50 currentFile 70002
XADD job:abc123:events * type progress progress 50 currentFile 70002

# Complete job
HSET job:abc123 status "completed" downloadUrl "https://..." completedAt 1702400120
XADD job:abc123:events * type completed downloadUrl "https://..."
ZREM jobs:active "abc123"
```

### 3. Background Job Processing

#### Queue Configuration (BullMQ)

```typescript
import { Queue, Worker, Job } from "bullmq";
import { Redis } from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null, // Required for BullMQ
});

// Queue definition
const downloadQueue = new Queue("downloads", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24h
      count: 1000, // Keep last 1000 jobs
    },
    removeOnFail: {
      age: 604800, // Keep failed jobs for 7 days
    },
  },
});

// Worker definition
const worker = new Worker(
  "downloads",
  async (job: Job) => {
    const { jobId, fileIds } = job.data;

    for (let i = 0; i < fileIds.length; i++) {
      const fileId = fileIds[i];

      // Update progress
      const progress = Math.round((i / fileIds.length) * 100);
      await updateJobProgress(jobId, progress, fileId);

      // Process file (simulate with delay)
      await processFile(fileId);

      // Check for cancellation
      if (await isJobCancelled(jobId)) {
        throw new Error("Job cancelled by user");
      }
    }

    // Generate presigned URL
    const downloadUrl = await generatePresignedUrl(jobId);
    await completeJob(jobId, downloadUrl);

    return { success: true, downloadUrl };
  },
  {
    connection: redis,
    concurrency: 5, // Process 5 jobs simultaneously
    limiter: {
      max: 10, // Max 10 jobs per minute
      duration: 60000,
    },
  },
);

// Event handlers
worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});
```

### 4. Timeout Configuration by Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                    Timeout Configuration                         │
├─────────────────────┬─────────────────────────────────────────────┤
│ Layer               │ Timeout    │ Purpose                        │
├─────────────────────┼────────────┼────────────────────────────────┤
│ Client (Browser)    │ 30s        │ Abort fetch after 30s          │
│ Cloudflare          │ 100s       │ Enterprise: 600s configurable  │
│ nginx               │ 60s        │ proxy_read_timeout             │
│ AWS ALB             │ 60s        │ idle_timeout.timeout_seconds   │
│ API Gateway         │ 30s        │ Hono timeout middleware        │
│ Job Queue           │ 300s       │ Job processing timeout         │
│ Redis Operations    │ 5s         │ Cache read/write timeout       │
│ S3 Operations       │ 30s        │ AWS SDK timeout                │
│ Presigned URLs      │ 3600s      │ Download URL validity          │
└─────────────────────┴────────────┴────────────────────────────────┘
```

---

## Proxy Configuration

### Cloudflare Configuration

```yaml
# cloudflare-settings.yaml
# Configure via Cloudflare Dashboard or API

# Page Rules for API endpoints
page_rules:
  - target: "api.example.com/v1/download/*"
    actions:
      cache_level: bypass
      browser_cache_ttl: 0

# Transform Rules (for headers)
transform_rules:
  - expression: '(http.request.uri.path contains "/v1/download/")'
    action:
      set_headers:
        - name: "CF-Connecting-IP"
          value: "{ip.src}"
        - name: "X-Real-IP"
          value: "{ip.src}"

# Firewall Rules (rate limiting)
firewall_rules:
  - expression: |
      (http.request.uri.path eq "/v1/download/initiate") and
      (rate(5m) > 10)
    action: challenge
```

```javascript
// Cloudflare Worker (optional edge caching)
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  // Handle SSE endpoints specially
  if (url.pathname.includes("/events/")) {
    return fetch(request, {
      cf: {
        // Disable buffering for SSE
        cacheTtl: 0,
        cacheEverything: false,
      },
    });
  }

  // Status endpoints - short cache
  if (url.pathname.includes("/status/")) {
    const response = await fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Cache-Control", "no-store, max-age=0");
    return newResponse;
  }

  return fetch(request);
}
```

### nginx Configuration

```nginx
# /etc/nginx/sites-available/download-api.conf

upstream download_api {
    server app:3000;
    keepalive 32;
}

# Rate limiting zone
limit_req_zone $binary_remote_addr zone=download_api:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=download_conn:10m;

server {
    listen 80;
    listen 443 ssl http2;
    server_name api.example.com;

    # SSL configuration
    ssl_certificate /etc/ssl/certs/api.example.com.crt;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;

    # Logging
    access_log /var/log/nginx/download_api_access.log;
    error_log /var/log/nginx/download_api_error.log;

    # Default timeouts (short for regular endpoints)
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;

    # Initiate endpoint (quick response expected)
    location /v1/download/initiate {
        limit_req zone=download_api burst=20 nodelay;
        limit_conn download_conn 10;

        proxy_pass http://download_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-ID $request_id;

        # Quick timeout for initiate
        proxy_read_timeout 10s;
    }

    # Status polling endpoint (quick response)
    location ~ ^/v1/download/status/(.+)$ {
        proxy_pass http://download_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Very short timeout for status checks
        proxy_read_timeout 5s;

        # Disable caching
        proxy_cache off;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # SSE events endpoint (long-lived connection)
    location ~ ^/v1/download/events/(.+)$ {
        proxy_pass http://download_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE-specific settings
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;  # 5 minutes for SSE

        # Chunked transfer encoding
        chunked_transfer_encoding on;

        # Prevent nginx from closing connection
        proxy_set_header Connection '';

        # SSE headers
        add_header Content-Type text/event-stream;
        add_header Cache-Control no-cache;
        add_header X-Accel-Buffering no;
    }

    # Download endpoint (presigned URL redirect)
    location ~ ^/v1/download/([a-f0-9-]+)$ {
        proxy_pass http://download_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_read_timeout 10s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://download_api;
        proxy_read_timeout 5s;

        # Allow internal monitoring without rate limiting
        limit_req off;
    }
}
```

### AWS ALB Configuration (Terraform)

```hcl
# alb.tf

resource "aws_lb" "download_api" {
  name               = "download-api-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  idle_timeout = 60  # seconds

  tags = {
    Name = "download-api-alb"
  }
}

resource "aws_lb_target_group" "api" {
  name     = "download-api-tg"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400  # 24 hours for SSE connections
    enabled         = true
  }
}

resource "aws_lb_listener_rule" "sse_events" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/v1/download/events/*"]
    }
  }
}
```

---

## Frontend Integration

### React/Next.js Implementation

#### 1. Download Hook

```typescript
// hooks/useDownload.ts
import { useState, useEffect, useCallback, useRef } from "react";

interface DownloadStatus {
  jobId: string;
  status: "idle" | "queued" | "processing" | "completed" | "failed";
  progress: number;
  downloadUrl?: string;
  error?: string;
}

interface UseDownloadOptions {
  pollInterval?: number; // Default: 3000ms
  enableSSE?: boolean; // Default: true
  onComplete?: (url: string) => void;
  onError?: (error: string) => void;
}

export function useDownload(options: UseDownloadOptions = {}) {
  const {
    pollInterval = 3000,
    enableSSE = true,
    onComplete,
    onError,
  } = options;

  const [status, setStatus] = useState<DownloadStatus>({
    jobId: "",
    status: "idle",
    progress: 0,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Poll status endpoint
  const pollStatus = useCallback(
    async (jobId: string) => {
      try {
        const response = await fetch(`/api/v1/download/status/${jobId}`);
        const data = await response.json();

        setStatus((prev) => ({
          ...prev,
          status: data.status,
          progress: data.progress,
          downloadUrl: data.downloadUrl,
          error: data.error?.message,
        }));

        if (data.status === "completed") {
          cleanup();
          onComplete?.(data.downloadUrl);
        } else if (data.status === "failed") {
          cleanup();
          onError?.(data.error?.message || "Download failed");
        }
      } catch (err) {
        console.error("Failed to poll status:", err);
      }
    },
    [cleanup, onComplete, onError],
  );

  // Setup SSE connection
  const setupSSE = useCallback(
    (jobId: string) => {
      if (!enableSSE) return false;

      try {
        const eventSource = new EventSource(`/api/v1/download/events/${jobId}`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === "progress") {
            setStatus((prev) => ({
              ...prev,
              status: "processing",
              progress: data.progress,
            }));
          } else if (data.type === "completed") {
            setStatus((prev) => ({
              ...prev,
              status: "completed",
              progress: 100,
              downloadUrl: data.downloadUrl,
            }));
            cleanup();
            onComplete?.(data.downloadUrl);
          } else if (data.type === "failed") {
            setStatus((prev) => ({
              ...prev,
              status: "failed",
              error: data.error.message,
            }));
            cleanup();
            onError?.(data.error.message);
          }
        };

        eventSource.onerror = () => {
          // SSE failed, fall back to polling
          eventSource.close();
          eventSourceRef.current = null;
          startPolling(jobId);
        };

        return true;
      } catch {
        return false;
      }
    },
    [enableSSE, cleanup, onComplete, onError],
  );

  // Start polling fallback
  const startPolling = useCallback(
    (jobId: string) => {
      if (pollIntervalRef.current) return;

      // Immediate first poll
      pollStatus(jobId);

      // Setup interval
      pollIntervalRef.current = setInterval(() => {
        pollStatus(jobId);
      }, pollInterval);
    },
    [pollStatus, pollInterval],
  );

  // Initiate download
  const initiateDownload = useCallback(
    async (fileIds: number[]) => {
      cleanup();

      setStatus({
        jobId: "",
        status: "queued",
        progress: 0,
      });

      try {
        const response = await fetch("/api/v1/download/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_ids: fileIds }),
        });

        if (!response.ok) {
          throw new Error("Failed to initiate download");
        }

        const data = await response.json();

        setStatus((prev) => ({
          ...prev,
          jobId: data.jobId,
          status: "queued",
        }));

        // Try SSE first, fall back to polling
        const sseConnected = setupSSE(data.jobId);
        if (!sseConnected) {
          startPolling(data.jobId);
        }

        return data.jobId;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus((prev) => ({
          ...prev,
          status: "failed",
          error: message,
        }));
        onError?.(message);
        throw err;
      }
    },
    [cleanup, setupSSE, startPolling, onError],
  );

  // Cancel download
  const cancelDownload = useCallback(async () => {
    if (!status.jobId) return;

    cleanup();

    try {
      await fetch(`/api/v1/download/${status.jobId}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }

    setStatus({
      jobId: "",
      status: "idle",
      progress: 0,
    });
  }, [status.jobId, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    status,
    initiateDownload,
    cancelDownload,
    isLoading: status.status === "queued" || status.status === "processing",
  };
}
```

#### 2. Download Component

```tsx
// components/DownloadButton.tsx
import React from "react";
import { useDownload } from "../hooks/useDownload";

interface DownloadButtonProps {
  fileIds: number[];
  className?: string;
}

export function DownloadButton({ fileIds, className }: DownloadButtonProps) {
  const { status, initiateDownload, cancelDownload, isLoading } = useDownload({
    onComplete: (url) => {
      // Auto-download when ready
      window.open(url, "_blank");
    },
    onError: (error) => {
      console.error("Download failed:", error);
    },
  });

  const handleClick = async () => {
    if (isLoading) {
      await cancelDownload();
    } else {
      await initiateDownload(fileIds);
    }
  };

  return (
    <div className={className}>
      <button
        onClick={handleClick}
        disabled={status.status === "completed"}
        className={`
          px-4 py-2 rounded-lg font-medium transition-all
          ${
            isLoading
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }
          disabled:bg-gray-300 disabled:cursor-not-allowed
        `}
      >
        {status.status === "idle" && "Download Files"}
        {status.status === "queued" && "Queued..."}
        {status.status === "processing" && `Cancel (${status.progress}%)`}
        {status.status === "completed" && "Downloaded"}
        {status.status === "failed" && "Retry Download"}
      </button>

      {/* Progress bar */}
      {isLoading && (
        <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${status.progress}%` }}
          />
        </div>
      )}

      {/* Error message */}
      {status.error && (
        <p className="mt-2 text-sm text-red-500">{status.error}</p>
      )}
    </div>
  );
}
```

#### 3. Download Manager with Multiple Files

```tsx
// components/DownloadManager.tsx
import React, { useState } from "react";
import { useDownload } from "../hooks/useDownload";

interface DownloadJob {
  id: string;
  fileIds: number[];
  status: string;
  progress: number;
}

export function DownloadManager() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);

  const addDownload = async (fileIds: number[]) => {
    const tempId = crypto.randomUUID();

    setJobs((prev) => [
      ...prev,
      {
        id: tempId,
        fileIds,
        status: "initiating",
        progress: 0,
      },
    ]);

    try {
      const response = await fetch("/api/v1/download/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: fileIds }),
      });

      const data = await response.json();

      setJobs((prev) =>
        prev.map((job) =>
          job.id === tempId
            ? { ...job, id: data.jobId, status: "queued" }
            : job,
        ),
      );

      // Start tracking this job
      trackJob(data.jobId);
    } catch (err) {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === tempId ? { ...job, status: "failed" } : job,
        ),
      );
    }
  };

  const trackJob = (jobId: string) => {
    const eventSource = new EventSource(`/api/v1/download/events/${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: data.type === "progress" ? "processing" : data.type,
                progress: data.progress || job.progress,
              }
            : job,
        ),
      );

      if (data.type === "completed" || data.type === "failed") {
        eventSource.close();
      }
    };
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Download Manager</h2>

      <button
        onClick={() => addDownload([70000, 70001, 70002])}
        className="bg-blue-500 text-white px-4 py-2 rounded mb-4"
      >
        Add Download
      </button>

      <div className="space-y-2">
        {jobs.map((job) => (
          <div key={job.id} className="border p-3 rounded">
            <div className="flex justify-between">
              <span className="font-mono text-sm">{job.id.slice(0, 8)}...</span>
              <span
                className={`
                px-2 py-1 rounded text-xs
                ${job.status === "completed" ? "bg-green-100 text-green-800" : ""}
                ${job.status === "processing" ? "bg-blue-100 text-blue-800" : ""}
                ${job.status === "failed" ? "bg-red-100 text-red-800" : ""}
                ${job.status === "queued" ? "bg-yellow-100 text-yellow-800" : ""}
              `}
              >
                {job.status}
              </span>
            </div>
            {job.status === "processing" && (
              <div className="mt-2 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 4. Retry Logic Implementation

```typescript
// utils/retry.ts
interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    shouldRetry = () => true,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelay,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// Usage in download hook
const fetchWithRetry = (url: string, options?: RequestInit) =>
  withRetry(
    () =>
      fetch(url, options).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }),
    {
      maxRetries: 3,
      shouldRetry: (error) => {
        // Don't retry client errors (4xx)
        return !error.message.includes("HTTP 4");
      },
    },
  );
```

---

## Error Handling & Resilience

### Error Codes

| Code               | HTTP Status | Description                 | Client Action                  |
| ------------------ | ----------- | --------------------------- | ------------------------------ |
| `JOB_NOT_FOUND`    | 404         | Job ID doesn't exist        | Show error, allow new download |
| `JOB_EXPIRED`      | 410         | Job data has expired        | Initiate new download          |
| `JOB_CANCELLED`    | 409         | Job was cancelled           | Allow restart                  |
| `RATE_LIMITED`     | 429         | Too many requests           | Retry after delay              |
| `STORAGE_ERROR`    | 503         | S3/storage unavailable      | Retry with backoff             |
| `PROCESSING_ERROR` | 500         | Internal processing failure | Retry 3x, then fail            |
| `INVALID_FILE_ID`  | 400         | File ID out of range        | Show validation error          |
| `QUOTA_EXCEEDED`   | 403         | User quota exceeded         | Show upgrade message           |

### Circuit Breaker Pattern

```typescript
// utils/circuitBreaker.ts
type CircuitState = "closed" | "open" | "half-open";

class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private lastFailure: number = 0;
  private successCount = 0;

  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 30000,
    private readonly halfOpenRequests: number = 3,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = "half-open";
        this.successCount = 0;
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.halfOpenRequests) {
        this.state = "closed";
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = "open";
    }
  }
}
```

### Graceful Degradation

```typescript
// When SSE fails, fall back to polling
// When real-time updates fail, show last known state
// When storage is unavailable, queue jobs for retry
// When network is offline, store jobs locally

interface OfflineJob {
  fileIds: number[];
  createdAt: number;
}

const queueOfflineDownload = (fileIds: number[]) => {
  const jobs: OfflineJob[] = JSON.parse(
    localStorage.getItem("offlineDownloads") || "[]",
  );

  jobs.push({ fileIds, createdAt: Date.now() });
  localStorage.setItem("offlineDownloads", JSON.stringify(jobs));
};

const processOfflineQueue = async () => {
  const jobs: OfflineJob[] = JSON.parse(
    localStorage.getItem("offlineDownloads") || "[]",
  );

  for (const job of jobs) {
    try {
      await initiateDownload(job.fileIds);
    } catch {
      // Keep in queue for next attempt
      continue;
    }
  }

  // Clear processed jobs
  localStorage.removeItem("offlineDownloads");
};

// Check online status and process queue
window.addEventListener("online", processOfflineQueue);
```

---

## Summary

This architecture addresses the core problem of long-running downloads by:

1. **Immediate Response**: `/initiate` returns instantly with a job ID
2. **Async Processing**: Background workers handle actual file operations
3. **Progress Tracking**: Real-time updates via SSE or polling fallback
4. **Proxy Compatible**: All endpoints complete within proxy timeout limits
5. **Resilient**: Circuit breakers, retries, and offline support
6. **User-Friendly**: Progress indicators and clear error messages

The hybrid polling + SSE approach provides the best balance of:

- **Reliability**: Works through all proxy configurations
- **Responsiveness**: Real-time updates when SSE is available
- **Simplicity**: Easy to implement and debug
- **Scalability**: Stateless API servers with Redis for state management
