// OpenTelemetry must be initialized BEFORE any other imports
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const otelSDK = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "delineate-hackathon-challenge",
  }),
  traceExporter: otelEndpoint
    ? new OTLPTraceExporter({ url: `${otelEndpoint}/v1/traces` })
    : undefined,
  instrumentations: [new HttpInstrumentation()],
});

otelSDK.start();

if (otelEndpoint) {
  console.log(`[OTEL] Tracing enabled: ${otelEndpoint}`);
}

// Graceful shutdown helper
export const shutdownOtel = async () => {
  await otelSDK.shutdown();
  console.log("[OTEL] SDK shut down");
};

// Initialize Sentry after OTEL
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
});

export { Sentry };
