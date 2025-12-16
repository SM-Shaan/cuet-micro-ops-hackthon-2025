# Challenge 1: Self-Hosted S3 Storage Integration

## Table of Contents

1. [Challenge Overview](#challenge-overview)
2. [Problem Statement Analysis](#problem-statement-analysis)
3. [Root Cause Investigation](#root-cause-investigation)
4. [Solution Design](#solution-design)
5. [Implementation](#implementation)
6. [Technical Deep Dives](#technical-deep-dives)
7. [Architecture](#architecture)
8. [Verification](#verification)
9. [Common Pitfalls](#common-pitfalls)
10. [Best Practices](#best-practices)
11. [Summary](#summary)

---

## Challenge Overview

| Attribute | Value |
|-----------|-------|
| **Challenge** | Self-Hosted S3 Storage Integration |
| **Max Points** | 15 |
| **Difficulty** | Medium |

### Mission

Integrate a self-hosted S3-compatible storage service with the Docker configuration so that:

1. The health endpoint returns `{"status": "healthy", "checks": {"storage": "ok"}}`
2. All E2E tests pass
3. The API can connect to storage for file operations

### Requirements

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CHALLENGE 1 REQUIREMENTS                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   1. Add S3-compatible storage to Docker Compose                        │
│   2. Create the required 'downloads' bucket on startup                  │
│   3. Configure networking between services                              │
│   4. Update environment variables                                       │
│   5. Health endpoint: {"status":"healthy","checks":{"storage":"ok"}}    │
│   6. All E2E tests pass                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Real-World Importance

| Requirement | Why It Matters |
|-------------|----------------|
| **S3 Storage** | Store files, assets, backups - every app needs persistent storage |
| **Health Checks** | Kubernetes/load balancers use these to route traffic |
| **Auto-initialization** | Zero manual setup = reliable deployments |
| **Docker networking** | Microservices must communicate securely |

---

## Problem Statement Analysis

### Issues Identified

#### Issue 1: No S3-Compatible Storage Service

**Problem:** The original Docker Compose configuration lacked any S3-compatible storage service.

**Original `compose.dev.yml`:**
```yaml
services:
  delineate-app:
    build:
      context: ..
      dockerfile: docker/Dockerfile.dev
    ports:
      - "3000:3000"
    depends_on:
      - delineate-jaeger

  delineate-jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "4318:4318"
```

**Impact:**
- Health endpoint returns `{"status": "unhealthy", "checks": {"storage": "error"}}`
- File download operations fail
- E2E tests fail

#### Issue 2: Missing S3 Environment Variables

**Problem:** Required environment variables not configured:
- `S3_ENDPOINT` - Storage service URL
- `S3_ACCESS_KEY_ID` - Access credentials
- `S3_SECRET_ACCESS_KEY` - Secret credentials
- `S3_BUCKET_NAME` - Target bucket name
- `S3_FORCE_PATH_STYLE` - Required for self-hosted S3

**Impact:** API falls into "mock mode" and cannot perform storage operations.

#### Issue 3: No Bucket Initialization

**Problem:** Even with storage running, the `downloads` bucket wouldn't exist.

**Impact:** Storage health check fails, file operations fail.

#### Issue 4: Service Dependencies Not Configured

**Problem:** Application didn't wait for storage to be ready.

**Impact:** Race conditions, intermittent startup failures.

---

## Root Cause Investigation

### The Detective Work

**Step 1: Check the Health Endpoint**

```bash
curl http://localhost:3000/health
# Response: {"status":"unhealthy","checks":{"storage":"error"}}
```

**Step 2: Trace the Code Path**

```javascript
// src/index.js - Health check logic
const checkS3Health = async () => {
  if (!env.S3_BUCKET_NAME) return true; // Mock mode
  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: "__health_check_marker__",
    });
    await s3Client.send(command);
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "NotFound") return true;
    return false;  // <-- We're hitting this!
  }
};
```

**Step 3: Identify the Failure Point**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FAILURE ANALYSIS                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   App tries to connect to S3:                                            │
│                                                                          │
│   s3Client.send(HeadObjectCommand)                                       │
│         │                                                                │
│         ▼                                                                │
│   ┌─────────────────┐                                                   │
│   │ Where is S3?    │ ← S3_ENDPOINT not set or wrong                    │
│   │                 │                                                   │
│   │ No server at    │ ← No S3 service in Docker Compose                │
│   │ that address!   │                                                   │
│   └─────────────────┘                                                   │
│         │                                                                │
│         ▼                                                                │
│   Connection refused / ECONNREFUSED                                      │
│         │                                                                │
│         ▼                                                                │
│   checkS3Health() returns false                                          │
│         │                                                                │
│         ▼                                                                │
│   {"status":"unhealthy","checks":{"storage":"error"}}                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Four Missing Pieces

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WHAT'S MISSING                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   PIECE 1: S3 Service                                                    │
│   ─────────────────                                                      │
│   Original docker-compose.yml had NO storage service.                   │
│   The app expects to talk to S3, but there's nothing listening.         │
│                                                                          │
│   PIECE 2: Environment Variables                                         │
│   ───────────────────────────────                                        │
│   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME   │
│   None of these were set in the Docker Compose environment block.       │
│                                                                          │
│   PIECE 3: Bucket Creation                                               │
│   ────────────────────────                                               │
│   Even with S3 running, the 'downloads' bucket doesn't exist.           │
│   S3 doesn't auto-create buckets - you must create them explicitly.     │
│                                                                          │
│   PIECE 4: Startup Order                                                 │
│   ──────────────────────                                                 │
│   App might start BEFORE S3 is ready.                                    │
│   First health check fails → App marked unhealthy → Bad UX              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Solution Design

### Decision 1: Which S3-Compatible Storage?

| Option | Pros | Cons |
|--------|------|------|
| **RustFS** | Lightweight, fast, simple | Newer, less documentation |
| **MinIO** | Battle-tested, feature-rich | Heavier, more complex |
| **LocalStack** | Full AWS emulation | Overkill for just S3 |

**Decision: RustFS** - Lightweight and recommended by the challenge.

### Decision 2: How to Create Bucket Automatically?

| Option | Pros | Cons |
|--------|------|------|
| **Init container** | Clean separation, runs once | Extra container |
| **App startup code** | No extra container | App responsibility bloat |
| **Volume with pre-made data** | Fast startup | Fragile, hard to maintain |

**Decision: Init container using MinIO Client (mc)** - Clean, reliable, idempotent.

### Decision 3: How to Ensure Correct Startup Order?

```yaml
# Option A: Simple depends_on (NOT ENOUGH!)
depends_on:
  - rustfs  # Only waits for container to START, not be READY

# Option B: depends_on with condition (CORRECT!)
depends_on:
  rustfs-init:
    condition: service_completed_successfully  # Waits for init to FINISH
```

**Decision: Use `service_completed_successfully`** - Guarantees bucket exists.

---

## Implementation

### 1. Added RustFS Service

**File:** `docker/compose.dev.yml` and `docker/compose.prod.yml`

```yaml
rustfs:
  image: rustfs/rustfs:latest
  ports:
    - "9000:9000"   # S3 API endpoint
    - "9001:9001"   # Web console
  environment:
    - RUSTFS_ROOT_USER=rustfsadmin
    - RUSTFS_ROOT_PASSWORD=rustfsadmin
  volumes:
    - rustfs-data:/data
```

**Why:**
- Port 9000: Standard S3 API endpoint
- Port 9001: Web console for debugging
- Persistent volumes: Data survives restarts

### 2. Added Bucket Initialization Container

```yaml
rustfs-init:
  image: minio/mc:latest
  depends_on:
    - rustfs
  restart: on-failure
  entrypoint: >
    /bin/sh -c "
    sleep 10;
    mc alias set myrustfs http://rustfs:9000 rustfsadmin rustfsadmin;
    mc mb myrustfs/downloads --ignore-existing;
    exit 0;
    "
```

| Step | What | Why |
|------|------|-----|
| `sleep 10` | Wait for RustFS | Ensure storage is ready |
| `mc alias set` | Configure endpoint | Tell mc where storage is |
| `mc mb --ignore-existing` | Create bucket | Idempotent bucket creation |
| `exit 0` | Exit successfully | Signal Docker to continue |

### 3. Configured S3 Environment Variables

```yaml
environment:
  - S3_ENDPOINT=http://rustfs:9000
  - S3_ACCESS_KEY_ID=rustfsadmin
  - S3_SECRET_ACCESS_KEY=rustfsadmin
  - S3_BUCKET_NAME=downloads
  - S3_FORCE_PATH_STYLE=true
```

### 4. Configured Service Dependencies

```yaml
depends_on:
  rustfs-init:
    condition: service_completed_successfully
  redis:
    condition: service_started
  delineate-jaeger:
    condition: service_started
```

### 5. Added Volume Definitions

```yaml
volumes:
  rustfs-data:
```

---

## Technical Deep Dives

### Deep Dive 1: Path Style vs Virtual-Hosted Style

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    URL STYLES EXPLAINED                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   VIRTUAL-HOSTED STYLE (AWS Default):                                    │
│   ───────────────────────────────────                                    │
│   https://mybucket.s3.amazonaws.com/myfile.txt                          │
│          ^^^^^^^^                                                        │
│          Bucket is subdomain                                             │
│                                                                          │
│   Problem: Requires DNS to resolve mybucket.s3.amazonaws.com            │
│            Self-hosted servers don't have this DNS setup!               │
│                                                                          │
│   PATH STYLE (Required for self-hosted):                                 │
│   ──────────────────────────────────────                                 │
│   http://localhost:9000/mybucket/myfile.txt                             │
│                         ^^^^^^^^                                         │
│                         Bucket is path segment                           │
│                                                                          │
│   Solution: S3_FORCE_PATH_STYLE=true                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Without `S3_FORCE_PATH_STYLE=true`:**
```
SDK tries: https://downloads.rustfs:9000/__health_check_marker__
           ^^^^^^^^^ - This DNS name doesn't exist!
Result: ENOTFOUND error
```

**With `S3_FORCE_PATH_STYLE=true`:**
```
SDK tries: http://rustfs:9000/downloads/__health_check_marker__
Result: Works perfectly!
```

### Deep Dive 2: Health Check Logic

```javascript
const checkS3Health = async () => {
  if (!env.S3_BUCKET_NAME) return true;  // [A] Mock mode
  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: "__health_check_marker__",
    });
    await s3Client.send(command);  // [B] Success
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "NotFound") return true;  // [C] NotFound = OK
    return false;  // [D] Other error = unhealthy
  }
};
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HEALTH CHECK DECISION TREE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Is S3_BUCKET_NAME set?                                                │
│         │                                                                │
│    NO ──┴── YES                                                          │
│    │         │                                                           │
│    ▼         ▼                                                           │
│  [A] true   Send HEAD request                                           │
│  (Mock)           │                                                      │
│              ┌────┴────┐                                                │
│              │         │                                                 │
│          Success    Error                                                │
│           [B]         │                                                  │
│            │    ┌─────┴─────┐                                           │
│            ▼    │           │                                            │
│          true  NotFound   Other                                          │
│                 [C]        [D]                                           │
│                  │          │                                            │
│                  ▼          ▼                                            │
│                true       false                                          │
│                                                                          │
│   Why is NotFound = healthy?                                             │
│   - Successfully connected to S3                                         │
│   - Successfully accessed the bucket                                     │
│   - 404 means "bucket OK, file doesn't exist" = HEALTHY                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Deep Dive 3: Docker Compose Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STARTUP TIMELINE                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Time    rustfs          rustfs-init         delineate-app             │
│   ────    ──────          ───────────         ─────────────             │
│                                                                          │
│   0s      Starting...     Waiting...          Waiting...                │
│   2s      Ready!          Starting...         Waiting...                │
│   3s      ✓               sleep 10...         Waiting...                │
│   13s     ✓               mc alias set...     Waiting...                │
│   14s     ✓               mc mb downloads...  Waiting...                │
│   15s     ✓               Exit 0 ✓           Starting!                  │
│   16s     ✓               ─                   Health check...           │
│   17s     ✓               ─                   {"status":"healthy"} ✓    │
│                                                                          │
│   Without proper depends_on:                                             │
│   ───────────────────────────                                            │
│   0s      Starting...     Waiting...          Starting! (too early!)    │
│   1s      Ready!          Starting...         Health check FAILS!       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture

### Solution Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SOLUTION ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   STARTUP SEQUENCE:                                                      │
│                                                                          │
│   Step 1: rustfs starts                                                  │
│   ┌─────────────────┐                                                   │
│   │     RustFS      │  S3-compatible storage                            │
│   │   Port 9000     │  Listening for connections                        │
│   └─────────────────┘                                                   │
│            │                                                             │
│            │ waits                                                       │
│            ▼                                                             │
│   Step 2: rustfs-init runs                                               │
│   ┌─────────────────┐                                                   │
│   │   rustfs-init   │  1. Sleep 10 seconds                              │
│   │   (minio/mc)    │  2. Configure mc alias                            │
│   │                 │  3. Create 'downloads' bucket                     │
│   │                 │  4. Exit with code 0                              │
│   └─────────────────┘                                                   │
│            │                                                             │
│            │ service_completed_successfully                              │
│            ▼                                                             │
│   Step 3: delineate-app starts                                           │
│   ┌─────────────────┐                                                   │
│   │  delineate-app  │  S3 is ready AND bucket exists!                   │
│   │   Port 3000     │  Health check passes immediately                  │
│   └─────────────────┘                                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Docker Network Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Compose Network                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────┐         ┌─────────────────┐              │
│   │  delineate-app  │────────▶│     rustfs      │              │
│   │   (Port 3000)   │         │  (Port 9000)    │              │
│   │                 │         │  S3-compatible  │              │
│   │  - Hono API     │         │  storage        │              │
│   │  - Health check │         │                 │              │
│   │  - Downloads    │         └─────────────────┘              │
│   └─────────────────┘                  ▲                       │
│           │                            │                       │
│           │                   ┌────────┴────────┐              │
│           │                   │   rustfs-init   │              │
│           │                   │                 │              │
│           │                   │ Creates bucket  │              │
│           │                   │ 'downloads'     │              │
│           ▼                   └─────────────────┘              │
│   ┌─────────────────┐                                          │
│   │ delineate-jaeger│                                          │
│   │  (Port 16686)   │                                          │
│   │  Tracing        │                                          │
│   └─────────────────┘                                          │
│                                                                 │
│   Host Machine               Docker Network                     │
│   ────────────               ──────────────                     │
│   localhost:3000  ◄────────  delineate-app:3000                │
│   localhost:9000  ◄────────  rustfs:9000                       │
│   localhost:9001  ◄────────  rustfs:9001 (console)             │
│                                                                 │
│   RULE: Containers use service names, not localhost!           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Verification

### Health Check

```bash
curl http://localhost:3000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "checks": {
    "storage": "ok",
    "redis": "ok"
  }
}
```

### E2E Tests

```bash
npm run test:e2e
```

The E2E tests verify:
- Health endpoint returns valid status
- Storage check field is present
- Download check endpoint works correctly

### Manual Verification Steps

```bash
# 1. Start the environment
make dev-up

# 2. Wait for services to be ready
sleep 20

# 3. Check health
curl http://localhost:3000/health

# 4. Access RustFS Console
# Open http://localhost:9001 (user: rustfsadmin, pass: rustfsadmin)

# 5. Verify bucket exists in console
# Should see 'downloads' bucket
```

---

## Common Pitfalls

### Pitfall 1: Forgetting `forcePathStyle`

```
❌ WRONG:
S3_ENDPOINT=http://rustfs:9000
# SDK tries: http://downloads.rustfs:9000/file.txt
# Result: DNS lookup fails

✅ CORRECT:
S3_ENDPOINT=http://rustfs:9000
S3_FORCE_PATH_STYLE=true
# SDK tries: http://rustfs:9000/downloads/file.txt
# Result: Works!
```

### Pitfall 2: Using `localhost` in Docker

```
❌ WRONG:
S3_ENDPOINT=http://localhost:9000
# Inside container, localhost = the container itself!

✅ CORRECT:
S3_ENDPOINT=http://rustfs:9000
# Docker DNS resolves 'rustfs' to the correct container IP
```

### Pitfall 3: App Starting Before Storage Ready

```yaml
# ❌ WRONG:
depends_on:
  - rustfs  # Only waits for container to START

# ✅ CORRECT:
depends_on:
  rustfs-init:
    condition: service_completed_successfully  # Waits for bucket creation
```

### Pitfall 4: Credentials Mismatch

```yaml
# ❌ WRONG - Credentials don't match!
rustfs:
  environment:
    - RUSTFS_ROOT_USER=admin123

delineate-app:
  environment:
    - S3_ACCESS_KEY_ID=different_key  # Won't work!

# ✅ CORRECT - Same credentials everywhere
rustfs:
  environment:
    - RUSTFS_ROOT_USER=rustfsadmin
    - RUSTFS_ROOT_PASSWORD=rustfsadmin

delineate-app:
  environment:
    - S3_ACCESS_KEY_ID=rustfsadmin
    - S3_SECRET_ACCESS_KEY=rustfsadmin
```

### Pitfall 5: Not Handling NotFound in Health Check

```javascript
// ❌ WRONG - NotFound treated as error
catch (err) {
  return false;  // Bucket is accessible, but returns false!
}

// ✅ CORRECT - NotFound means bucket is accessible
catch (err) {
  if (err instanceof Error && err.name === "NotFound") return true;
  return false;
}
```

---

## Best Practices

### 1. Init Container Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    INIT CONTAINER PATTERN                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Use a separate container for one-time initialization tasks:           │
│                                                                          │
│   ✓ Database migrations                                                  │
│   ✓ Bucket creation                                                      │
│   ✓ Config file generation                                               │
│   ✓ Secret population                                                    │
│                                                                          │
│   Benefits:                                                              │
│   - Clean separation of concerns                                         │
│   - Idempotent (safe to run multiple times)                             │
│   - App container stays simple                                           │
│   - Clear dependency ordering                                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. Graceful Health Checks

A health check should answer: "Can I do my job?"

For S3 storage, "healthy" means:
- ✓ Can connect to the endpoint
- ✓ Have valid credentials
- ✓ Bucket exists and is accessible

It does NOT require:
- Specific files to exist
- Certain amount of data
- Write permissions (if read-only is acceptable)

### 3. Environment Variable Layering

```yaml
# 1. Base defaults in .env.example
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# 2. Local overrides in .env (gitignored)
S3_ACCESS_KEY_ID=my-local-key

# 3. Docker Compose overrides (for container networking)
environment:
  - S3_ENDPOINT=http://rustfs:9000  # Overrides local config

# 4. Runtime overrides (for production)
docker run -e S3_ENDPOINT=https://s3.prod.example.com ...
```

---

## Summary

### Complete Solution

```yaml
# docker/compose.dev.yml - Final Solution

services:
  # 1. S3-compatible storage
  rustfs:
    image: rustfs/rustfs:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - RUSTFS_ROOT_USER=rustfsadmin
      - RUSTFS_ROOT_PASSWORD=rustfsadmin
    volumes:
      - rustfs-data:/data

  # 2. One-time bucket initialization
  rustfs-init:
    image: minio/mc:latest
    depends_on:
      - rustfs
    restart: on-failure
    entrypoint: >
      /bin/sh -c "
      sleep 10;
      mc alias set myrustfs http://rustfs:9000 rustfsadmin rustfsadmin;
      mc mb myrustfs/downloads --ignore-existing;
      exit 0;
      "

  # 3. Application with proper config
  delineate-app:
    environment:
      - S3_ENDPOINT=http://rustfs:9000
      - S3_ACCESS_KEY_ID=rustfsadmin
      - S3_SECRET_ACCESS_KEY=rustfsadmin
      - S3_BUCKET_NAME=downloads
      - S3_FORCE_PATH_STYLE=true
    depends_on:
      rustfs-init:
        condition: service_completed_successfully

volumes:
  rustfs-data:
```

### Result

```bash
curl http://localhost:3000/health
# {"status":"healthy","checks":{"storage":"ok","redis":"ok"}}
```

### Key Learnings

| Learning | Description |
|----------|-------------|
| **Path Style URLs** | Self-hosted S3 requires `S3_FORCE_PATH_STYLE=true` |
| **Init Containers** | Use separate containers for one-time setup tasks |
| **Service Dependencies** | Use `condition: service_completed_successfully` |
| **Graceful Health Checks** | `NotFound` error still indicates healthy storage |
| **Docker Networking** | Use service names, not `localhost` |

### Files Modified

| File | Changes |
|------|---------|
| `docker/compose.dev.yml` | Added RustFS, rustfs-init, S3 env vars, dependencies |
| `docker/compose.prod.yml` | Added RustFS, rustfs-init, S3 env vars, dependencies |
| `docker/Dockerfile.dev` | Updated command for environment variable handling |
| `.env.example` | Updated credentials to match RustFS defaults |
