import { useState, useEffect } from "react";
import { createSpan, getCurrentTraceId } from "../lib/tracing";
import { addBreadcrumb } from "../lib/sentry";

interface HealthData {
  status: "healthy" | "unhealthy";
  checks: {
    storage: "ok" | "error" | "circuit_open";
    redis: "ok" | "error";
  };
}

// Helper to get status color and label
const getStatusInfo = (status: string) => {
  switch (status) {
    case "ok":
      return {
        color: "bg-gradient-to-r from-emerald-400 to-teal-500",
        label: "OK",
        badgeClass: "status-healthy",
        glow: "glow-green",
      };
    case "error":
      return {
        color: "bg-gradient-to-r from-red-400 to-rose-500",
        label: "ERROR",
        badgeClass: "status-unhealthy",
        glow: "glow-red",
      };
    case "circuit_open":
      return {
        color: "bg-gradient-to-r from-amber-400 to-orange-500",
        label: "CIRCUIT OPEN",
        badgeClass: "bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 border border-amber-200/50",
        glow: "",
      };
    default:
      return {
        color: "bg-gradient-to-r from-slate-400 to-gray-500",
        label: status.toUpperCase(),
        badgeClass: "status-unhealthy",
        glow: "",
      };
  }
};

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
    const interval = setInterval(checkHealth, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  const storageInfo = health ? getStatusInfo(health.checks.storage) : null;
  const redisInfo = health ? getStatusInfo(health.checks.redis) : null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">System Health</h2>
        </div>
        <button
          onClick={checkHealth}
          disabled={loading}
          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50 flex items-center gap-1"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? "Checking..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="alert-error mb-4">
          <div className="font-medium">Connection Error</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {health && (
        <div className="space-y-4">
          {/* Overall Status */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-slate-50 to-white border border-slate-100">
            <div
              className={`w-4 h-4 rounded-full ${
                health.status === "healthy"
                  ? "bg-gradient-to-r from-emerald-400 to-teal-500 pulse-green"
                  : "bg-gradient-to-r from-red-400 to-rose-500 pulse-red"
              }`}
            />
            <span className="text-lg font-semibold text-slate-900">
              {health.status === "healthy"
                ? "All Systems Operational"
                : "System Degraded"}
            </span>
          </div>

          {/* Service Checks */}
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-sm font-medium text-slate-500 mb-3">
              Service Status
            </h3>
            <div className="space-y-3">
              {/* Storage (S3) */}
              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-slate-50/80 to-blue-50/30 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${storageInfo?.color}`} />
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                    <span className="text-slate-700 font-medium">Storage (S3)</span>
                  </div>
                </div>
                <span className={`status-badge ${storageInfo?.badgeClass}`}>
                  {storageInfo?.label}
                </span>
              </div>

              {/* Redis */}
              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-slate-50/80 to-purple-50/30 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${redisInfo?.color}`} />
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                    <span className="text-slate-700 font-medium">Redis (Job Queue)</span>
                  </div>
                </div>
                <span className={`status-badge ${redisInfo?.badgeClass}`}>
                  {redisInfo?.label}
                </span>
              </div>
            </div>
          </div>

          {/* Circuit Breaker Warning */}
          {health.checks.storage === "circuit_open" && (
            <div className="alert-warning text-sm">
              <div className="font-medium flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Circuit Breaker Active
              </div>
              <div className="text-xs mt-1 opacity-80">
                S3 storage is experiencing issues. Requests will fail fast to
                prevent cascading failures. Auto-retry in 30 seconds.
              </div>
            </div>
          )}

          {/* Redis Down Warning */}
          {health.checks.redis === "error" && (
            <div className="alert-error text-sm">
              <div className="font-medium flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Redis Unavailable
              </div>
              <div className="text-xs mt-1 opacity-80">
                Job queue is offline. New download jobs cannot be started.
              </div>
            </div>
          )}

          {/* Last Checked */}
          {lastChecked && (
            <div className="text-xs text-slate-400 pt-2 border-t border-slate-100 flex justify-between items-center">
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Last checked: {lastChecked.toLocaleTimeString()}
              </span>
              {traceId && (
                <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">
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
