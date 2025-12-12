import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
});

export { Sentry };
