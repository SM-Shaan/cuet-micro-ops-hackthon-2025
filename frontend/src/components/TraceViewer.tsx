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
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Trace Viewer</h2>

      <div className="space-y-4">
        {/* Jaeger Link */}
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <h3 className="text-sm font-medium text-slate-700 mb-2">Jaeger UI</h3>
          <p className="text-sm text-slate-500 mb-3">
            View distributed traces in the Jaeger UI to analyze request flows
            and identify performance bottlenecks.
          </p>
          <a
            href={jaegerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors shadow-sm font-medium"
          >
            Open Jaeger UI
          </a>
        </div>

        {/* Trace ID Lookup */}
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <h3 className="text-sm font-medium text-slate-700 mb-2">
            Lookup Trace by ID
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder="Enter trace ID..."
              className="input flex-1"
            />
            <button
              onClick={viewTrace}
              disabled={!traceId}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium"
            >
              View
            </button>
          </div>
        </div>

        {/* Recent Trace */}
        {recentTraceId && (
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h3 className="text-sm font-medium text-slate-700 mb-2">
              Most Recent Trace
            </h3>
            <div className="flex items-center gap-3">
              <code className="bg-white px-3 py-1.5 rounded-lg text-sm font-mono text-blue-600 border border-slate-200">
                {recentTraceId}
              </code>
              <button
                onClick={() => {
                  window.open(`${jaegerUrl}/trace/${recentTraceId}`, "_blank");
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                View in Jaeger
              </button>
            </div>
          </div>
        )}

        {/* How Tracing Works */}
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <h3 className="text-sm font-medium text-slate-700 mb-2">
            How Tracing Works
          </h3>
          <div className="text-sm text-slate-500 space-y-2">
            <p>
              1. When you interact with the dashboard, OpenTelemetry creates a
              trace with a unique ID.
            </p>
            <p>
              2. The trace ID is propagated to the backend via the{" "}
              <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">traceparent</code>{" "}
              header.
            </p>
            <p>
              3. The backend logs and traces include this ID for correlation.
            </p>
            <p>
              4. Errors in Sentry are tagged with the trace ID for debugging.
            </p>
          </div>

          <div className="mt-4 p-3 bg-slate-800 rounded-lg font-mono text-xs">
            <div className="text-slate-400">// Example trace correlation</div>
            <div className="text-emerald-400">Frontend span: trace_id=abc123</div>
            <div className="text-blue-400">
              API request: traceparent: 00-abc123-...
            </div>
            <div className="text-amber-400">
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
