# Sentry Setup Guide

This guide explains how to set up and use Sentry for error tracking in this project.

## Overview

Sentry is integrated in both the **backend** (Node.js/Hono) and **frontend** (React/Vite) applications.

| Component | SDK                             | Environment Variable |
| --------- | ------------------------------- | -------------------- |
| Backend   | `@sentry/node` + `@hono/sentry` | `SENTRY_DSN`         |
| Frontend  | `@sentry/react`                 | `VITE_SENTRY_DSN`    |

---

## 1. Sentry Account Setup

### Create Project

1. Go to [https://sentry.io](https://sentry.io) and create an account
2. Click **Create Project**
3. Select **Hono** as the platform
4. Name your project (e.g., `delineate-hackathon`)
5. Copy the **DSN** provided

The DSN looks like:

```
https://abc123@o123456.ingest.sentry.io/1234567
```

---

## 2. Environment Configuration

### Local Development

Add to your `.env` file in the project root:

```env
SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/1234567
```

### Docker Development

The `.env` file is automatically loaded via `env_file` in `docker/compose.dev.yml`.

### Docker Production

Copy `.env` to the docker folder for build args:

```bash
cp .env docker/.env
```

---

## 3. Backend Integration

### File: `src/instrument.js`

Sentry is initialized at application startup:

```javascript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
});
```

### File: `src/index.js`

Hono middleware captures errors:

```javascript
import { sentry } from "@hono/sentry";

// Middleware
app.use(sentry({ dsn: env.SENTRY_DSN }));

// Error handler
app.onError((err, c) => {
  c.get("sentry").captureException(err);
  // ...
});
```

### Test Endpoint

Trigger a test error:

```bash
# Development
curl http://localhost:3000/debug-sentry

# Production (via gateway)
curl http://localhost/api/debug-sentry
```

---

## 4. Frontend Integration

### File: `frontend/src/lib/sentry.ts`

```typescript
import * as Sentry from "@sentry/react";

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!dsn) {
    console.warn("Sentry DSN not configured.");
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 1.0,
    replaysOnErrorSampleRate: 1.0,
  });
}
```

### Build-Time Configuration

The frontend requires `VITE_SENTRY_DSN` at **build time**. This is configured in `frontend/Dockerfile`:

```dockerfile
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
```

And passed via docker-compose:

```yaml
build:
  args:
    - VITE_SENTRY_DSN=${SENTRY_DSN}
```

### Test Frontend Error

#### Step 1: Start Dev Mode

```bash
docker compose -f docker/compose.prod.yml down
docker compose -f docker/compose.dev.yml up --build -d
```

#### Step 2: Open Frontend

Go to: **http://localhost:5173**

#### Step 3: Trigger Error via Browser Console

Press **F12** → **Console** tab → Run:

```javascript
// Method 1: Simple error
throw new Error("Test frontend error from console");

// Method 2: Using Sentry directly
window.Sentry?.captureException(new Error("Manual Sentry test"));

// Method 3: Capture message
window.Sentry?.captureMessage("Test message from frontend");
```

#### Step 4: Verify in Sentry Dashboard

1. Go to **https://sentry.io**
2. Select your project → **Issues**
3. Filter by: `platform:javascript`

You should see the error with:

- Browser info (Chrome, Firefox, etc.)
- Stack trace
- Session replay (if enabled)

#### Verification

Check browser console for Sentry initialization message. If you see:

```
Sentry DSN not configured. Error tracking disabled.
```

Rebuild the frontend:

```bash
docker compose -f docker/compose.dev.yml up --build -d delineate-dashboard
```

---

## 5. Sentry Dashboard

### Viewing Errors

1. Go to [https://sentry.io](https://sentry.io)
2. Select your project
3. Click **Issues** in the left sidebar

### Filtering Errors

| Filter                    | Description          |
| ------------------------- | -------------------- |
| `platform:node`           | Backend errors only  |
| `platform:javascript`     | Frontend errors only |
| `environment:production`  | Production errors    |
| `environment:development` | Development errors   |

### Error Details

Click on an error to see:

- **Stack trace** - Where the error occurred
- **Breadcrumbs** - Events leading to the error
- **Tags** - Environment, browser, OS
- **Request data** - URL, headers, body
- **Session Replay** - (Frontend) Video of user actions

---

## 6. Running the Application

### Development Mode

```bash
# Start all services
npm run docker:dev

# Test backend Sentry
curl http://localhost:3000/debug-sentry

# Access frontend
open http://localhost:5173
```

### Production Mode

```bash
# Copy .env for build args
cp .env docker/.env

# Start all services
npm run docker:prod

# Test backend Sentry
curl http://localhost/api/debug-sentry

# Access frontend
open http://localhost
```

---

## 7. Troubleshooting

### Errors Not Appearing in Sentry

1. **Check DSN is set:**

   ```bash
   # Backend container
   docker compose -f docker/compose.dev.yml exec delineate-app env | grep SENTRY
   ```

2. **Check logs for Sentry initialization:**

   ```bash
   docker compose -f docker/compose.dev.yml logs delineate-app
   ```

3. **Verify network connectivity** - Container must reach `sentry.io`

### Frontend Errors Not Appearing

1. Ensure `VITE_SENTRY_DSN` is set at build time
2. Rebuild frontend: `docker compose up --build -d delineate-dashboard`
3. Hard refresh browser: `Ctrl + Shift + R`

### DSN Not Loading in Docker

The `${SENTRY_DSN}` in docker-compose reads from the host environment or `.env` file in the same directory as the compose file.

Solution:

```bash
cp .env docker/.env
docker compose -f docker/compose.prod.yml up --build -d
```

---

## 8. Best Practices

1. **Use different projects** for frontend and backend in production
2. **Set environment** to distinguish dev/staging/production
3. **Configure alerts** for new errors via email/Slack
4. **Use breadcrumbs** to track user actions before errors
5. **Mask sensitive data** in frontend replay settings
6. Switching Environment:

```
docker compose -f docker/compose.prod.yml down
docker compose -f docker/compose.dev.yml up --build -d
```

## 9. Useful Links

- [Sentry Documentation](https://docs.sentry.io/)
- [Sentry Node.js SDK](https://docs.sentry.io/platforms/javascript/guides/node/)
- [Sentry React SDK](https://docs.sentry.io/platforms/javascript/guides/react/)
- [Hono Sentry Middleware](https://hono.dev/docs/middleware/builtin/sentry)

## Questions:
