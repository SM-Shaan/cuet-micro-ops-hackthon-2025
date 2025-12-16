// eslint-disable-next-line import-x/order
import { Sentry, shutdownOtel } from "./instrument.js";

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { serve } from "@hono/node-server";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { sentry } from "@hono/sentry";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { rateLimiter } from "hono-rate-limiter";
import Redis from "ioredis";
import CircuitBreaker from "opossum";

// Helper for optional URL that treats empty string as undefined
const optionalUrl = z
  .string()
  .optional()
  .transform((val) => (val === "" ? undefined : val))
  .pipe(z.url().optional());

// Environment schema
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: optionalUrl,
  S3_BUCKET_NAME: z.string().default(""),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((val) => val === "true")
    .default(false),
  S3_MOCK_MODE: z
    .string()
    .optional()
    .transform((val) => val === "true")
    .default(false),
  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(100),
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((val) => (val === "*" ? "*" : val.split(","))),
  // Download delay simulation (in milliseconds)
  DOWNLOAD_DELAY_MIN_MS: z.coerce.number().int().min(0).default(10000), // 10 seconds
  // DOWNLOAD_DELAY_MAX_MS: z.coerce.number().int().min(0).default(200000), // 200 seconds
  DOWNLOAD_DELAY_MAX_MS: z.coerce.number().int().min(0).default(20000), // 200 seconds
  DOWNLOAD_DELAY_ENABLED: z
    .string()
    .optional()
    .transform((val) => val !== "false")
    .default(true),
  // Redis configuration
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_KEY_PREFIX: z.string().default("download:"),
  REDIS_JOB_TTL_SECONDS: z.coerce.number().int().min(60).default(3600), // 1 hour
});

// Parse and validate environment
const env = EnvSchema.parse(process.env);

// S3 Client
const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  ...(env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// Circuit Breaker for S3 operations
// Prevents cascading failures when S3 is down - fails fast instead of waiting for timeout
const s3SendWithBreaker = async (command) => {
  return s3Client.send(command);
};

const s3Breaker = new CircuitBreaker(s3SendWithBreaker, {
  timeout: 5000, // 5 second timeout per request
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 5, // Minimum 5 requests before circuit can open
});

// Track circuit state for health checks
let s3CircuitOpen = false;

s3Breaker.on("open", () => {
  s3CircuitOpen = true;
  console.warn("[S3 Circuit Breaker] OPEN - S3 requests will fail fast");
});

s3Breaker.on("halfOpen", () => {
  console.log("[S3 Circuit Breaker] HALF-OPEN - Testing S3 connection...");
});

s3Breaker.on("close", () => {
  s3CircuitOpen = false;
  console.log("[S3 Circuit Breaker] CLOSED - S3 connection restored");
});

s3Breaker.on("fallback", () => {
  console.log("[S3 Circuit Breaker] Fallback triggered");
});

// Helper to execute S3 commands with circuit breaker
const s3Send = async (command) => {
  try {
    return await s3Breaker.fire(command);
  } catch (err) {
    // Check if circuit is open (fail-fast scenario)
    if (s3Breaker.opened) {
      const error = new Error("S3 service unavailable (circuit open)");
      error.name = "CircuitBreakerOpen";
      throw error;
    }
    throw err;
  }
};

// Redis Client with fallback support
let redisConnected = false;
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  lazyConnect: true,
  enableOfflineQueue: false, // Don't queue commands when disconnected
});

redis.on("error", (err) => {
  if (redisConnected) {
    console.error("[Redis] Connection error:", err.message);
  }
  redisConnected = false;
});

redis.on("connect", () => {
  redisConnected = true;
  console.log("[Redis] Connected to", env.REDIS_URL);
});

redis.on("ready", () => {
  redisConnected = true;
  console.log("[Redis] Ready");
});

// Connect to Redis immediately (don't wait for first command)
redis.connect().catch((err) => {
  console.error("[Redis] Initial connection failed:", err.message);
});

// In-memory fallback store declaration (used when Redis is unavailable)
// The actual Map is initialized after DownloadJob interface is defined

const app = new OpenAPIHono();

// Request ID middleware - adds unique ID to each request
app.use(async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
});

// Security headers middleware (helmet-like)
app.use(secureHeaders());

// CORS middleware
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposeHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
    ],
    maxAge: 86400,
  }),
);

// Request timeout middleware
app.use(timeout(env.REQUEST_TIMEOUT_MS));

// Rate limiting middleware
app.use(
  rateLimiter({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: "draft-6",
    keyGenerator: (c) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "anonymous",
  }),
);

// OpenTelemetry middleware
app.use(
  httpInstrumentationMiddleware({
    serviceName: "delineate-hackathon-challenge",
  }),
);

// Sentry middleware
app.use(
  sentry({
    dsn: env.SENTRY_DSN,
  }),
);

// Error response schema for OpenAPI
const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  })
  .openapi("ErrorResponse");

// Error handler with Sentry
app.onError((err, c) => {
  c.get("sentry").captureException(err);
  const requestId = c.get("requestId");
  return c.json(
    {
      error: "Internal Server Error",
      message:
        env.NODE_ENV === "development"
          ? err.message
          : "An unexpected error occurred",
      requestId,
    },
    500,
  );
});

// Schemas
const MessageResponseSchema = z
  .object({
    message: z.string(),
  })
  .openapi("MessageResponse");

const HealthResponseSchema = z
  .object({
    status: z.enum(["healthy", "unhealthy"]),
    checks: z.object({
      storage: z.enum(["ok", "error", "circuit_open"]),
      redis: z.enum(["ok", "error"]),
    }),
  })
  .openapi("HealthResponse");

// Download API Schemas
const DownloadInitiateRequestSchema = z
  .object({
    file_ids: z
      .array(z.number().int().min(10000).max(100000000))
      .min(1)
      .max(1000)
      .openapi({ description: "Array of file IDs (10K to 100M)" }),
  })
  .openapi("DownloadInitiateRequest");

const DownloadInitiateResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Unique job identifier" }),
    status: z.enum(["queued", "processing"]),
    totalFileIds: z.number().int(),
  })
  .openapi("DownloadInitiateResponse");

const DownloadCheckRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "Single file ID to check (10K to 100M)" }),
  })
  .openapi("DownloadCheckRequest");

const DownloadCheckResponseSchema = z
  .object({
    file_id: z.number().int(),
    available: z.boolean(),
    s3Key: z
      .string()
      .nullable()
      .openapi({ description: "S3 object key if available" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
  })
  .openapi("DownloadCheckResponse");

const DownloadStartRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "File ID to download (10K to 100M)" }),
    user_id: z
      .string()
      .min(1)
      .max(255)
      .openapi({ description: "User ID for idempotency (one job per user)" }),
  })
  .openapi("DownloadStartRequest");

// Async response - returns immediately with job info
const DownloadStartResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Unique job identifier" }),
    userId: z.string().openapi({ description: "User ID" }),
    fileId: z
      .number()
      .int()
      .openapi({ description: "File ID being processed" }),
    status: z
      .enum(["queued", "processing"])
      .openapi({ description: "Job status" }),
    progress: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .openapi({ description: "Progress percentage" }),
    message: z.string().openapi({ description: "Status message" }),
    pollUrl: z
      .string()
      .openapi({ description: "URL to poll for status updates" }),
  })
  .openapi("DownloadStartResponse");

// Status response schema
const DownloadStatusResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Unique job identifier" }),
    userId: z.string().openapi({ description: "User ID" }),
    fileId: z
      .number()
      .int()
      .openapi({ description: "File ID being processed" }),
    status: z
      .enum(["queued", "processing", "completed", "failed"])
      .openapi({ description: "Job status" }),
    progress: z
      .number()
      .int()
      .min(0)
      .max(100)
      .openapi({ description: "Progress percentage (0-100)" }),
    createdAt: z.number().openapi({ description: "Job creation timestamp" }),
    updatedAt: z.number().openapi({ description: "Last update timestamp" }),
    completedAt: z
      .number()
      .nullable()
      .openapi({ description: "Completion timestamp" }),
    downloadUrl: z
      .string()
      .nullable()
      .openapi({ description: "Presigned download URL if completed" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
    processingTimeMs: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "Processing time in ms" }),
    message: z.string().nullable().openapi({ description: "Status message" }),
    error: z
      .string()
      .nullable()
      .openapi({ description: "Error message if failed" }),
  })
  .openapi("DownloadStatusResponse");

// Input sanitization for S3 keys - prevent path traversal
const sanitizeS3Key = (fileId) => {
  // Ensure fileId is a valid integer within bounds (already validated by Zod)
  const sanitizedId = Math.floor(Math.abs(fileId));
  // Construct safe S3 key without user-controlled path components
  return `downloads/${String(sanitizedId)}.zip`;
};

// S3 health check (bypasses circuit breaker - health checks shouldn't affect circuit state)
const checkS3Health = async () => {
  if (!env.S3_BUCKET_NAME || env.S3_MOCK_MODE) return true; // Mock mode

  // If circuit is open, report unhealthy immediately (but don't try to connect)
  if (s3CircuitOpen) return false;

  try {
    // Use a lightweight HEAD request on a known path
    // IMPORTANT: Bypass circuit breaker to avoid health checks affecting circuit state
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: "__health_check_marker__",
    });
    // Use s3Client.send directly (not s3Send) to bypass circuit breaker
    await Promise.race([
      s3Client.send(command),
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error("Health check timeout"));
        }, 3000),
      ),
    ]);
    return true;
  } catch (err) {
    // NotFound is fine - bucket is accessible
    if (err instanceof Error && err.name === "NotFound") return true;
    // Timeout or other errors - S3 might be slow but not necessarily down
    console.log(
      "[Health] S3 health check failed:",
      err instanceof Error ? err.message : "Unknown error",
    );
    return false;
  }
};

// S3 availability check (uses circuit breaker)
const checkS3Availability = async (fileId) => {
  const s3Key = sanitizeS3Key(fileId);

  // If no bucket configured or mock mode enabled, use mock mode
  if (!env.S3_BUCKET_NAME || env.S3_MOCK_MODE) {
    const available = fileId % 7 === 0;
    return {
      available,
      s3Key: available ? s3Key : null,
      size: available ? Math.floor(Math.random() * 10000000) + 1000 : null,
    };
  }

  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
    });
    const response = await s3Send(command);
    return {
      available: true,
      s3Key,
      size: response.ContentLength ?? null,
    };
  } catch {
    return {
      available: false,
      s3Key: null,
      size: null,
    };
  }
};

// Random delay helper for simulating long-running downloads
const getRandomDelay = () => {
  if (!env.DOWNLOAD_DELAY_ENABLED) return 0;
  const min = env.DOWNLOAD_DELAY_MIN_MS;
  const max = env.DOWNLOAD_DELAY_MAX_MS;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// JOB STORE - Async Polling Pattern Implementation (Challenge 2)
// Using Redis for production-ready distributed job storage
// ============================================================================

// Redis key helper
const getRedisKey = (userId) => `${env.REDIS_KEY_PREFIX}${userId}`;

// Redis job store helper functions
const jobStore = {
  async get(userId) {
    try {
      const data = await redis.get(getRedisKey(userId));
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[Redis] Error getting job for userId=${userId}:`, err);
      return null;
    }
  },

  async set(userId, job) {
    try {
      await redis.setex(
        getRedisKey(userId),
        env.REDIS_JOB_TTL_SECONDS,
        JSON.stringify(job),
      );
      return true;
    } catch (err) {
      console.error(`[Redis] Error setting job for userId=${userId}:`, err);
      return false;
    }
  },

  async delete(userId) {
    try {
      await redis.del(getRedisKey(userId));
    } catch (err) {
      console.error(`[Redis] Error deleting job for userId=${userId}:`, err);
    }
  },

  async updateProgress(userId, progress) {
    const job = await this.get(userId);
    if (job) {
      job.progress = progress;
      job.updatedAt = Date.now();
      await this.set(userId, job);
    }
  },
};

// Background job processor
const processDownloadJob = async (userId) => {
  const job = await jobStore.get(userId);
  if (!job) return;

  const startTime = Date.now();

  // Update status to processing
  job.status = "processing";
  job.updatedAt = Date.now();

  // Get random delay (simulating real processing)
  const delayMs = getRandomDelay();
  job.estimatedDelayMs = delayMs;

  // Save initial processing state to Redis
  await jobStore.set(userId, job);

  console.log(
    `[Download] Processing userId=${userId} file_id=${String(job.fileId)} delay=${String(delayMs)}ms`,
  );

  // Progress update loop - updates Redis every second
  const progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(Math.floor((elapsed / delayMs) * 100), 99);
    jobStore.updateProgress(userId, progress).catch((err) => {
      console.error(`[Download] Progress update error: ${String(err)}`);
    });
  }, 1000);

  try {
    // Simulate long-running process
    await sleep(delayMs);

    clearInterval(progressInterval);

    // Check S3 availability
    const s3Result = await checkS3Availability(job.fileId);
    const processingTimeMs = Date.now() - startTime;

    job.processingTimeMs = processingTimeMs;
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    job.progress = 100;

    if (s3Result.available) {
      job.status = "completed";
      job.downloadUrl = `/v1/download/file/${String(job.fileId)}`;
      job.size = s3Result.size;
      job.message = `Download ready after ${(processingTimeMs / 1000).toFixed(1)} seconds`;
    } else {
      job.status = "failed";
      job.message = `File not found after ${(processingTimeMs / 1000).toFixed(1)} seconds of processing`;
    }

    // Save final state to Redis
    await jobStore.set(userId, job);

    console.log(
      `[Download] Completed userId=${userId} status=${job.status} time=${String(processingTimeMs)}ms`,
    );
  } catch (error) {
    clearInterval(progressInterval);
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Unknown error";
    job.updatedAt = Date.now();
    job.completedAt = Date.now();
    job.progress = 100;

    // Save error state to Redis
    await jobStore.set(userId, job);

    console.error(`[Download] Failed userId=${userId} error=${job.error}`);
  }
};

// Routes
const rootRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["General"],
  summary: "Root endpoint",
  description: "Returns a welcome message",
  responses: {
    200: {
      description: "Successful response",
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
    },
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check endpoint",
  description: "Returns the health status of the service and its dependencies",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
    503: {
      description: "Service is unhealthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

// Debug route to verify Sentry is working
const debugSentryRoute = createRoute({
  method: "get",
  path: "/debug-sentry",
  tags: ["Debug"],
  summary: "Test Sentry integration",
  description: "Triggers an intentional error to verify Sentry is working",
  responses: {
    500: {
      description: "Error captured by Sentry",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Route handlers
app.openapi(rootRoute, (c) => {
  return c.json({ message: "Hello Hono!" }, 200);
});

app.openapi(debugSentryRoute, (c) => {
  try {
    throw new Error("My first Sentry error!");
  } catch (e) {
    Sentry.captureException(e);
    return c.json(
      { error: "Sentry Test", message: "Error captured and sent to Sentry!" },
      500,
    );
  }
});

app.openapi(healthRoute, async (c) => {
  const storageHealthy = await checkS3Health();
  const storageStatus = s3CircuitOpen
    ? "circuit_open"
    : storageHealthy
      ? "ok"
      : "error";
  const redisStatus = redisConnected ? "ok" : "error";
  const allHealthy = storageHealthy && redisConnected && !s3CircuitOpen;
  const status = allHealthy ? "healthy" : "unhealthy";
  const httpStatus = allHealthy ? 200 : 503;
  return c.json(
    {
      status,
      checks: {
        storage: storageStatus,
        redis: redisStatus,
      },
    },
    httpStatus,
  );
});

// Download API Routes
const downloadInitiateRoute = createRoute({
  method: "post",
  path: "/v1/download/initiate",
  tags: ["Download"],
  summary: "Initiate download job",
  description: "Initiates a download job for multiple IDs",
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadInitiateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download job initiated",
      content: {
        "application/json": {
          schema: DownloadInitiateResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const downloadCheckRoute = createRoute({
  method: "post",
  path: "/v1/download/check",
  tags: ["Download"],
  summary: "Check download availability",
  description:
    "Checks if a single ID is available for download in S3. Add ?sentry_test=true to trigger an error for Sentry testing.",
  request: {
    query: z.object({
      sentry_test: z.string().optional().openapi({
        description:
          "Set to 'true' to trigger an intentional error for Sentry testing",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: DownloadCheckRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Availability check result",
      content: {
        "application/json": {
          schema: DownloadCheckResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(downloadInitiateRoute, (c) => {
  const { file_ids } = c.req.valid("json");
  const jobId = crypto.randomUUID();
  return c.json(
    {
      jobId,
      status: "queued",
      totalFileIds: file_ids.length,
    },
    200,
  );
});

app.openapi(downloadCheckRoute, async (c) => {
  const { sentry_test } = c.req.valid("query");
  const { file_id } = c.req.valid("json");

  // Intentional error for Sentry testing (hackathon challenge)
  if (sentry_test === "true") {
    throw new Error(
      `Sentry test error triggered for file_id=${String(file_id)} - This should appear in Sentry!`,
    );
  }

  const s3Result = await checkS3Availability(file_id);
  return c.json(
    {
      file_id,
      ...s3Result,
    },
    200,
  );
});

// Download Start Route - ASYNC PATTERN (Challenge 2)
// Returns immediately with jobId, processing happens in background
const downloadStartRoute = createRoute({
  method: "post",
  path: "/v1/download/start",
  tags: ["Download"],
  summary: "Start file download (async - returns immediately)",
  description: `Initiates a file download job that processes in the background.
    Returns immediately with a jobId and pollUrl.
    Use GET /v1/download/status/:userId to check progress.
    Processing time varies between ${String(env.DOWNLOAD_DELAY_MIN_MS / 1000)}s and ${String(env.DOWNLOAD_DELAY_MAX_MS / 1000)}s.
    IDEMPOTENT: Multiple requests with same user_id return the existing job.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadStartRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download job initiated (or existing job returned)",
      content: {
        "application/json": {
          schema: DownloadStartResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    503: {
      description: "Service unavailable (Redis down)",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Download Status Route - Poll for job status
const downloadStatusRoute = createRoute({
  method: "get",
  path: "/v1/download/status/{userId}",
  tags: ["Download"],
  summary: "Get download job status by user ID",
  description:
    "Poll this endpoint to check the status of a user's download job. Returns progress, status, and downloadUrl when complete.",
  request: {
    params: z.object({
      userId: z
        .string()
        .min(1)
        .openapi({ description: "User ID to check status for" }),
    }),
  },
  responses: {
    200: {
      description: "Job status",
      content: {
        "application/json": {
          schema: DownloadStatusResponseSchema,
        },
      },
    },
    404: {
      description: "No active job found for this user",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// ASYNC Download Start Handler - Returns IMMEDIATELY
app.openapi(downloadStartRoute, async (c) => {
  const { file_id, user_id } = c.req.valid("json");

  // Check Redis connectivity - return 503 if Redis is down (fixes silent failure bug)
  if (!redisConnected) {
    console.error(
      `[Download] Redis unavailable - rejecting job for userId=${user_id}`,
    );
    return c.json(
      {
        error: "Service Unavailable",
        message:
          "Job storage temporarily unavailable. Please retry in a few moments.",
        requestId: c.get("requestId"),
      },
      503,
    );
  }

  // Check if user already has an active job (idempotency) - Redis lookup
  const existingJob = await jobStore.get(user_id);

  if (
    existingJob &&
    (existingJob.status === "queued" || existingJob.status === "processing")
  ) {
    // Return existing job (idempotent)
    console.log(
      `[Download] Returning existing job for userId=${user_id} jobId=${existingJob.jobId} status=${existingJob.status}`,
    );
    return c.json(
      {
        jobId: existingJob.jobId,
        userId: user_id,
        fileId: existingJob.fileId,
        status: existingJob.status,
        progress: existingJob.progress,
        message: "Download job already in progress",
        pollUrl: `/v1/download/status/${user_id}`,
      },
      200,
    );
  }

  // Create new job
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    userId: user_id,
    fileId: file_id,
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Store job in Redis with userId as key
  const stored = await jobStore.set(user_id, job);

  // If storage failed, return 503 (fixes silent failure bug)
  if (!stored) {
    console.error(
      `[Download] Failed to store job in Redis for userId=${user_id}`,
    );
    return c.json(
      {
        error: "Service Unavailable",
        message: "Failed to queue job. Please retry in a few moments.",
        requestId: c.get("requestId"),
      },
      503,
    );
  }

  console.log(
    `[Download] Created new job userId=${user_id} jobId=${jobId} fileId=${String(file_id)}`,
  );

  // Start background processing (non-blocking - don't await!)
  processDownloadJob(user_id).catch((err) => {
    console.error(`[Download] Background processing error: ${String(err)}`);
  });

  // Return immediately (< 100ms response time!)
  return c.json(
    {
      jobId,
      userId: user_id,
      fileId: file_id,
      status: "queued",
      message: "Download job queued. Poll the status URL for updates.",
      pollUrl: `/v1/download/status/${user_id}`,
    },
    200,
  );
});

// Download Status Handler
app.openapi(downloadStatusRoute, async (c) => {
  const { userId } = c.req.valid("param");

  // Get job from Redis
  const job = await jobStore.get(userId);

  if (!job) {
    return c.json(
      {
        error: "Not Found",
        message: "No active download job found for this user",
        requestId: c.get("requestId"),
      },
      404,
    );
  }

  return c.json(
    {
      jobId: job.jobId,
      userId: job.userId,
      fileId: job.fileId,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt ?? null,
      downloadUrl: job.downloadUrl ?? null,
      size: job.size ?? null,
      processingTimeMs: job.processingTimeMs ?? null,
      message: job.message ?? null,
      error: job.error ?? null,
    },
    200,
  );
});

// ============================================================================
// FILE UPLOAD API - Upload files to S3 bucket
// ============================================================================

// Upload response schema
const UploadResponseSchema = z
  .object({
    success: z.boolean(),
    fileId: z.number().int(),
    s3Key: z.string(),
    size: z.number().int(),
    message: z.string(),
  })
  .openapi("UploadResponse");

// List files response schema
const ListFilesResponseSchema = z
  .object({
    files: z.array(
      z.object({
        key: z.string(),
        size: z.number().int(),
        lastModified: z.string(),
        fileId: z.number().int().nullable(),
      }),
    ),
    totalCount: z.number().int(),
  })
  .openapi("ListFilesResponse");

// Upload file route
const uploadFileRoute = createRoute({
  method: "post",
  path: "/v1/upload",
  tags: ["Upload"],
  summary: "Upload a file to S3",
  description: "Upload a file to the S3 bucket with a specified file ID",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ description: "File to upload" }),
            file_id: z
              .string()
              .openapi({ description: "File ID (10000-100000000)" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "File uploaded successfully",
      content: {
        "application/json": {
          schema: UploadResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Upload failed",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// List files route
const listFilesRoute = createRoute({
  method: "get",
  path: "/v1/files",
  tags: ["Upload"],
  summary: "List files in S3 bucket",
  description: "List all files in the downloads S3 bucket",
  responses: {
    200: {
      description: "List of files",
      content: {
        "application/json": {
          schema: ListFilesResponseSchema,
        },
      },
    },
    500: {
      description: "Failed to list files",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Upload file handler
app.openapi(uploadFileRoute, async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const fileIdStr = formData.get("file_id");

    if (!file || !(file instanceof File)) {
      return c.json(
        {
          error: "Bad Request",
          message: "No file provided",
          requestId: c.get("requestId"),
        },
        400,
      );
    }

    const fileId = parseInt(fileIdStr, 10);
    if (isNaN(fileId) || fileId < 10000 || fileId > 100000000) {
      return c.json(
        {
          error: "Bad Request",
          message: "file_id must be between 10000 and 100000000",
          requestId: c.get("requestId"),
        },
        400,
      );
    }

    const s3Key = `downloads/${fileId}.zip`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3 with original filename in metadata (uses circuit breaker)
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: file.type || "application/octet-stream",
      Metadata: {
        "original-filename": encodeURIComponent(file.name),
      },
    });

    await s3Send(command);

    console.log(`[Upload] File uploaded: ${s3Key} (${buffer.length} bytes)`);

    return c.json(
      {
        success: true,
        fileId,
        s3Key,
        size: buffer.length,
        message: `File uploaded successfully as ${s3Key}`,
      },
      200,
    );
  } catch (error) {
    // Circuit breaker open - fail fast
    if (error instanceof Error && error.name === "CircuitBreakerOpen") {
      return c.json(
        {
          error: "Service Unavailable",
          message:
            "Storage service temporarily unavailable. Please retry in a few moments.",
          requestId: c.get("requestId"),
        },
        503,
      );
    }

    console.error("[Upload] Error:", error);
    return c.json(
      {
        error: "Upload Failed",
        message: error instanceof Error ? error.message : "Unknown error",
        requestId: c.get("requestId"),
      },
      500,
    );
  }
});

// List files handler
app.openapi(listFilesRoute, async (c) => {
  try {
    // If mock mode, return empty list
    if (env.S3_MOCK_MODE || !env.S3_BUCKET_NAME) {
      return c.json(
        {
          files: [],
          totalCount: 0,
        },
        200,
      );
    }

    const command = new ListObjectsV2Command({
      Bucket: env.S3_BUCKET_NAME,
    });

    const response = await s3Send(command);
    const files = (response.Contents || []).map((obj) => {
      // Extract file ID from key (e.g., "downloads/12345.zip" -> 12345)
      const match = obj.Key?.match(/downloads\/(\d+)\.zip/);
      const fileId = match ? parseInt(match[1], 10) : null;

      return {
        key: obj.Key || "",
        size: obj.Size || 0,
        lastModified: obj.LastModified?.toISOString() || "",
        fileId,
      };
    });

    return c.json(
      {
        files,
        totalCount: files.length,
      },
      200,
    );
  } catch (error) {
    // Circuit breaker open - fail fast
    if (error instanceof Error && error.name === "CircuitBreakerOpen") {
      return c.json(
        {
          error: "Service Unavailable",
          message:
            "Storage service temporarily unavailable. Please retry in a few moments.",
          requestId: c.get("requestId"),
        },
        503,
      );
    }

    console.error("[ListFiles] Error:", error);
    return c.json(
      {
        error: "List Failed",
        message: error instanceof Error ? error.message : "Unknown error",
        requestId: c.get("requestId"),
      },
      500,
    );
  }
});

// ============================================================================
// FILE DOWNLOAD ENDPOINT - Stream files from S3
// ============================================================================

// Download file route
const downloadFileRoute = createRoute({
  method: "get",
  path: "/v1/download/file/{fileId}",
  tags: ["Download"],
  summary: "Download a file from S3",
  description: "Stream a file directly from S3 storage",
  request: {
    params: z.object({
      fileId: z.string().openapi({ description: "File ID to download" }),
    }),
  },
  responses: {
    200: {
      description: "File stream",
      content: {
        "application/octet-stream": {
          schema: z.any(),
        },
      },
    },
    404: {
      description: "File not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Download failed",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Download file handler
app.openapi(downloadFileRoute, async (c) => {
  const { fileId } = c.req.valid("param");
  const fileIdNum = parseInt(fileId, 10);

  if (isNaN(fileIdNum) || fileIdNum < 10000 || fileIdNum > 100000000) {
    return c.json(
      {
        error: "Bad Request",
        message: "Invalid file ID",
        requestId: c.get("requestId"),
      },
      400,
    );
  }

  const s3Key = sanitizeS3Key(fileIdNum);

  try {
    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
    });

    const response = await s3Send(command);

    if (!response.Body) {
      return c.json(
        {
          error: "Not Found",
          message: "File not found",
          requestId: c.get("requestId"),
        },
        404,
      );
    }

    // Get original filename from metadata, fallback to fileId
    const originalFilename = response.Metadata?.["original-filename"]
      ? decodeURIComponent(response.Metadata["original-filename"])
      : `${fileId}.zip`;

    // Set headers for file download
    c.header(
      "Content-Type",
      response.ContentType || "application/octet-stream",
    );
    c.header("Content-Length", String(response.ContentLength || 0));
    c.header(
      "Content-Disposition",
      `attachment; filename="${originalFilename}"`,
    );

    // Stream the response
    return new Response(response.Body, {
      status: 200,
      headers: c.res.headers,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") {
      return c.json(
        {
          error: "Not Found",
          message: "File not found in storage",
          requestId: c.get("requestId"),
        },
        404,
      );
    }

    // Circuit breaker open - fail fast
    if (error instanceof Error && error.name === "CircuitBreakerOpen") {
      return c.json(
        {
          error: "Service Unavailable",
          message:
            "Storage service temporarily unavailable. Please retry in a few moments.",
          requestId: c.get("requestId"),
        },
        503,
      );
    }

    console.error("[Download] Error:", error);
    return c.json(
      {
        error: "Download Failed",
        message: error instanceof Error ? error.message : "Unknown error",
        requestId: c.get("requestId"),
      },
      500,
    );
  }
});

// OpenAPI spec endpoint (disabled in production)
if (env.NODE_ENV !== "production") {
  app.doc("/openapi", {
    openapi: "3.0.0",
    info: {
      title: "Delineate Hackathon Challenge API",
      version: "1.0.0",
      description: "API for Delineate Hackathon Challenge",
    },
    servers: [{ url: "http://localhost:3000", description: "Local server" }],
  });

  // Scalar API docs
  app.get("/docs", Scalar({ url: "/openapi" }));
}

// Graceful shutdown handler
const gracefulShutdown = (server) => (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed");

    // Shutdown OpenTelemetry to flush traces
    shutdownOtel()
      .catch((err) => {
        console.error("Error shutting down OpenTelemetry:", err);
      })
      .finally(() => {
        // Disconnect Redis
        redis
          .quit()
          .then(() => {
            console.log("Redis client disconnected");
          })
          .catch((err) => {
            console.error("Error disconnecting Redis:", err);
          })
          .finally(() => {
            // Destroy S3 client
            s3Client.destroy();
            console.log("S3 client destroyed");
            console.log("Graceful shutdown completed");
          });
      });
  });
};

// Start server
const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${String(info.port)}`);
    console.log(`Environment: ${env.NODE_ENV}`);
    if (env.NODE_ENV !== "production") {
      console.log(`API docs: http://localhost:${String(info.port)}/docs`);
    }
  },
);

// Register shutdown handlers
const shutdown = gracefulShutdown(server);
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
