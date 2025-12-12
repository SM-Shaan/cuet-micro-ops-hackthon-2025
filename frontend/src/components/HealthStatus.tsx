import { useState, useEffect } from "react";
import { createSpan, getCurrentTraceId } from "../lib/tracing";
import { addBreadcrumb } from "../lib/sentry";

interface HealthData {
  status: "healthy" | "unhealthy";
  checks: {
    storage: "ok" | "error";
  };
}

export function HealthStatus() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await createSpan(
        "health-check",
        async () => {
          addBreadcrumb("Checking API health", "api");

          const response = await fetch("/api/health");
          if (!response.ok) {
            throw new Error(`Health check failed: ${response.status}`);
          }
          return response.json();
        },
        { "health.endpoint": "/api/health" },
      );

      setHealth(data);
      setLastChecked(new Date());
      setTraceId(getCurrentTraceId());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">API Health</h2>
        <button
          onClick={checkHealth}
          disabled={loading}
          className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
        >
          {loading ? "Checking..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4">
          {error}
        </div>
      )}

      {health && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                health.status === "healthy" ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-lg font-medium">
              {health.status === "healthy" ? "Healthy" : "Unhealthy"}
            </span>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Checks</h3>
            <div className="flex items-center justify-between">
              <span>Storage (S3)</span>
              <span
                className={`status-badge ${
                  health.checks.storage === "ok"
                    ? "status-healthy"
                    : "status-unhealthy"
                }`}
              >
                {health.checks.storage.toUpperCase()}
              </span>
            </div>
          </div>

          {lastChecked && (
            <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
              Last checked: {lastChecked.toLocaleTimeString()}
              {traceId && (
                <span className="ml-2 font-mono">
                  trace: {traceId.slice(0, 8)}...
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
