import { useState, useEffect } from "react";

interface Metric {
  name: string;
  value: number;
  unit: string;
  change?: number;
}

export function PerformanceMetrics() {
  const [metrics, setMetrics] = useState<Metric[]>([
    { name: "Avg Response Time", value: 0, unit: "ms" },
    { name: "Success Rate", value: 100, unit: "%" },
    { name: "Total Requests", value: 0, unit: "" },
    { name: "Active Jobs", value: 0, unit: "" },
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
        setMetrics(JSON.parse(stored));
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
      { name: "Avg Response Time", value: 0, unit: "ms" },
      { name: "Success Rate", value: 100, unit: "%" },
      { name: "Total Requests", value: 0, unit: "" },
      { name: "Active Jobs", value: 0, unit: "" },
    ]);
    localStorage.removeItem("performanceMetrics");
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Performance Metrics</h2>
        <button
          onClick={resetMetrics}
          className="text-sm text-gray-400 hover:text-gray-300"
        >
          Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.name}
            className="bg-gray-700/50 rounded-lg p-4 text-center"
          >
            <div className="text-2xl font-bold text-white">
              {metric.value.toLocaleString()}
              <span className="text-sm text-gray-400 ml-1">{metric.unit}</span>
            </div>
            <div className="text-sm text-gray-400 mt-1">{metric.name}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="text-xs text-gray-500">
          Metrics are calculated locally from your session. They reset on page
          refresh or can be cleared manually.
        </div>
      </div>
    </div>
  );
}
