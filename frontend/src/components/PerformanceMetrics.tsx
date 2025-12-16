import { useState, useEffect } from "react";

interface Metric {
  name: string;
  value: number;
  unit: string;
  change?: number;
  color: string;
  icon: string;
}

export function PerformanceMetrics() {
  const [metrics, setMetrics] = useState<Metric[]>([
    { name: "Avg Response Time", value: 0, unit: "ms", color: "from-blue-400 to-indigo-500", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
    { name: "Success Rate", value: 100, unit: "%", color: "from-emerald-400 to-teal-500", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    { name: "Total Requests", value: 0, unit: "", color: "from-purple-400 to-pink-500", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
    { name: "Active Jobs", value: 0, unit: "", color: "from-amber-400 to-orange-500", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
  ]);

  // Listen for metric updates
  useEffect(() => {
    const updateMetrics = (
      event: CustomEvent<{ type: string; value: number }>,
    ) => {
      const { type, value } = event.detail;

      setMetrics((prev) => {
        const updated = [...prev];

        if (type === "responseTime") {
          const idx = updated.findIndex((m) => m.name === "Avg Response Time");
          if (idx >= 0) {
            const current = updated[idx].value;
            // Rolling average
            updated[idx] = {
              ...updated[idx],
              value: current === 0 ? value : Math.round((current + value) / 2),
            };
          }
        }

        if (type === "request") {
          const idx = updated.findIndex((m) => m.name === "Total Requests");
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
              value: updated[idx].value + 1,
            };
          }
        }

        if (type === "error") {
          const reqIdx = updated.findIndex((m) => m.name === "Total Requests");
          const successIdx = updated.findIndex(
            (m) => m.name === "Success Rate",
          );
          if (reqIdx >= 0 && successIdx >= 0 && updated[reqIdx].value > 0) {
            const total = updated[reqIdx].value;
            const errors =
              Math.round((total * (100 - updated[successIdx].value)) / 100) + 1;
            updated[successIdx] = {
              ...updated[successIdx],
              value: Math.round(((total - errors) / total) * 100),
            };
          }
        }

        if (type === "activeJobs") {
          const idx = updated.findIndex((m) => m.name === "Active Jobs");
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
              value: Math.max(0, updated[idx].value + value),
            };
          }
        }

        return updated;
      });
    };

    window.addEventListener("metricUpdate", updateMetrics as EventListener);
    return () => {
      window.removeEventListener(
        "metricUpdate",
        updateMetrics as EventListener,
      );
    };
  }, []);

  // Load from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("performanceMetrics");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Merge with default colors/icons
        setMetrics(prev =>
          prev.map((m, i) => ({
            ...m,
            value: parsed[i]?.value ?? m.value
          }))
        );
      } catch {
        console.warn("Failed to parse stored metrics");
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem("performanceMetrics", JSON.stringify(metrics));
  }, [metrics]);

  const resetMetrics = () => {
    setMetrics([
      { name: "Avg Response Time", value: 0, unit: "ms", color: "from-blue-400 to-indigo-500", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
      { name: "Success Rate", value: 100, unit: "%", color: "from-emerald-400 to-teal-500", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
      { name: "Total Requests", value: 0, unit: "", color: "from-purple-400 to-pink-500", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
      { name: "Active Jobs", value: 0, unit: "", color: "from-amber-400 to-orange-500", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
    ]);
    localStorage.removeItem("performanceMetrics");
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Performance Metrics</h2>
        </div>
        <button
          onClick={resetMetrics}
          className="text-sm text-slate-500 hover:text-slate-700 font-medium flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.name}
            className="metric-card group hover:scale-[1.02]"
          >
            <div className={`w-10 h-10 mx-auto mb-3 rounded-xl bg-gradient-to-br ${metric.color} flex items-center justify-center shadow-lg transition-transform group-hover:scale-110`}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={metric.icon} />
              </svg>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {metric.value.toLocaleString()}
              <span className="text-sm text-slate-400 ml-1">{metric.unit}</span>
            </div>
            <div className="text-sm text-slate-500 mt-1">{metric.name}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="text-xs text-slate-400 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Metrics are calculated locally from your session
        </div>
      </div>
    </div>
  );
}
