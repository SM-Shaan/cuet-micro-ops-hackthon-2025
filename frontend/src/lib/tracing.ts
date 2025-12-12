import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let tracerProvider: WebTracerProvider | null = null;

export function initTracing() {
  const endpoint = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) {
    console.warn("OTEL endpoint not configured. Tracing disabled.");
    return;
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: "delineate-dashboard",
  });

  tracerProvider = new WebTracerProvider({ resource });

  const exporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  tracerProvider.addSpanProcessor(new BatchSpanProcessor(exporter));

  // Register context manager
  tracerProvider.register({
    contextManager: new ZoneContextManager(),
  });

  // Setup fetch instrumentation
  const fetchInstrumentation = new FetchInstrumentation({
    propagateTraceHeaderCorsUrls: [/.*/],
    clearTimingResources: true,
  });
  fetchInstrumentation.setTracerProvider(tracerProvider);
  fetchInstrumentation.enable();

  console.log("OpenTelemetry tracing initialized");
}

export function getTracer() {
  return trace.getTracer("delineate-dashboard");
}

export function getCurrentTraceId(): string | null {
  const span = trace.getSpan(context.active());
  if (span) {
    const spanContext = span.spanContext();
    return spanContext.traceId;
  }
  return null;
}

export function createSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }

      // Store trace ID for Sentry correlation
      sessionStorage.setItem("currentTraceId", span.spanContext().traceId);

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    } finally {
      span.end();
    }
  });
}

export function withTracing<T extends (...args: unknown[]) => Promise<unknown>>(
  name: string,
  fn: T,
): T {
  return (async (...args: Parameters<T>) => {
    return createSpan(name, () => fn(...args));
  }) as T;
}
