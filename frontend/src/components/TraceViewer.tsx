import { useState } from "react";

export function TraceViewer() {
  const [traceId, setTraceId] = useState("");
  const jaegerUrl =
    import.meta.env.VITE_JAEGER_UI_URL || "http://localhost:16686";

  const viewTrace = () => {
    if (traceId) {
      window.open(`${jaegerUrl}/trace/${traceId}`, "_blank");
    }
  };

  const recentTraceId = sessionStorage.getItem("currentTraceId");

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Trace Viewer</h2>

      <div className="space-y-4">
        {/* Jaeger Link */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Jaeger UI</h3>
          <p className="text-sm text-gray-400 mb-3">
            View distributed traces in the Jaeger UI to analyze request flows
            and identify performance bottlenecks.
          </p>
          <a
            href={jaegerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors"
          >
            Open Jaeger UI
          </a>
        </div>

        {/* Trace ID Lookup */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">
            Lookup Trace by ID
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder="Enter trace ID..."
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={viewTrace}
              disabled={!traceId}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded transition-colors"
            >
              View
            </button>
          </div>
        </div>

        {/* Recent Trace */}
        {recentTraceId && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Most Recent Trace
            </h3>
            <div className="flex items-center gap-3">
              <code className="bg-gray-800 px-3 py-1 rounded text-sm font-mono text-blue-400">
                {recentTraceId}
              </code>
              <button
                onClick={() => {
                  window.open(`${jaegerUrl}/trace/${recentTraceId}`, "_blank");
                }}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                View in Jaeger
              </button>
            </div>
          </div>
        )}

        {/* How Tracing Works */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">
            How Tracing Works
          </h3>
          <div className="text-sm text-gray-400 space-y-2">
            <p>
              1. When you interact with the dashboard, OpenTelemetry creates a
              trace with a unique ID.
            </p>
            <p>
              2. The trace ID is propagated to the backend via the{" "}
              <code className="bg-gray-800 px-1 rounded">traceparent</code>{" "}
              header.
            </p>
            <p>
              3. The backend logs and traces include this ID for correlation.
            </p>
            <p>
              4. Errors in Sentry are tagged with the trace ID for debugging.
            </p>
          </div>

          <div className="mt-4 p-3 bg-gray-800 rounded font-mono text-xs">
            <div className="text-gray-500">// Example trace correlation</div>
            <div className="text-green-400">Frontend span: trace_id=abc123</div>
            <div className="text-blue-400">
              API request: traceparent: 00-abc123-...
            </div>
            <div className="text-yellow-400">
              Backend log: [trace_id=abc123] Processing...
            </div>
            <div className="text-red-400">
              Sentry error: tags.trace_id=abc123
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
