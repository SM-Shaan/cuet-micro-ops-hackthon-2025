import { useState } from "react";
import { createSpan, getCurrentTraceId } from "../lib/tracing";
import { addBreadcrumb, captureError } from "../lib/sentry";
import { generateUUID } from "../lib/uuid";

interface DownloadJob {
  id: string;
  fileId: number;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  processingTimeMs?: number;
  error?: string;
}

export function DownloadTester() {
  const [fileId, setFileId] = useState(70000);
  const [loading, setLoading] = useState(false);
  const [currentJob, setCurrentJob] = useState<DownloadJob | null>(null);

  const emitMetric = (type: string, value: number) => {
    window.dispatchEvent(
      new CustomEvent("metricUpdate", { detail: { type, value } }),
    );
  };

  const emitJobUpdate = (job: DownloadJob) => {
    window.dispatchEvent(new CustomEvent("downloadJobUpdate", { detail: job }));
  };

  const startDownload = async () => {
    if (loading) return;

    setLoading(true);
    const startTime = Date.now();

    const job: DownloadJob = {
      id: generateUUID(),
      fileId,
      status: "processing",
      progress: 0,
      startedAt: new Date(),
    };

    setCurrentJob(job);
    emitJobUpdate(job);
    emitMetric("activeJobs", 1);
    emitMetric("request", 1);

    try {
      addBreadcrumb("Starting download", "download", { fileId });

      const result = await createSpan(
        "download-start",
        async () => {
          const response = await fetch("/api/v1/download/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_id: fileId }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Download failed");
          }

          return response.json();
        },
        {
          "download.file_id": fileId,
          "download.trace_id": getCurrentTraceId() || "",
        },
      );

      const completedJob: DownloadJob = {
        ...job,
        status: result.status === "completed" ? "completed" : "failed",
        progress: 100,
        completedAt: new Date(),
        processingTimeMs: result.processingTimeMs,
        error: result.status === "failed" ? result.message : undefined,
      };

      setCurrentJob(completedJob);
      emitJobUpdate(completedJob);
      emitMetric("responseTime", result.processingTimeMs);

      if (result.status === "failed") {
        emitMetric("error", 1);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      captureError(error, { fileId });

      const failedJob: DownloadJob = {
        ...job,
        status: "failed",
        progress: 0,
        completedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
        error: error.message,
      };

      setCurrentJob(failedJob);
      emitJobUpdate(failedJob);
      emitMetric("responseTime", failedJob.processingTimeMs || 0);
      emitMetric("error", 1);
    } finally {
      setLoading(false);
      emitMetric("activeJobs", -1);
    }
  };

  const checkAvailability = async () => {
    try {
      addBreadcrumb("Checking file availability", "download", { fileId });

      const result = await createSpan(
        "download-check",
        async () => {
          const response = await fetch("/api/v1/download/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_id: fileId }),
          });

          if (!response.ok) {
            throw new Error("Check failed");
          }

          return response.json();
        },
        { "check.file_id": fileId },
      );

      alert(
        result.available
          ? `File ${fileId} is available! Size: ${result.size} bytes`
          : `File ${fileId} is not available`,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      captureError(error, { fileId });
      alert(`Error: ${error.message}`);
    }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Download Tester</h2>

      <div className="space-y-4">
        {/* File ID Input */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            File ID (10,000 - 100,000,000)
          </label>
          <input
            type="number"
            min={10000}
            max={100000000}
            value={fileId}
            onChange={(e) => setFileId(Number(e.target.value))}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={startDownload}
            disabled={loading}
            className={`flex-1 py-2 px-4 rounded font-medium transition-colors ${
              loading
                ? "bg-gray-600 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing...
              </span>
            ) : (
              "Start Download"
            )}
          </button>

          <button
            onClick={checkAvailability}
            disabled={loading}
            className="px-4 py-2 rounded font-medium bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            Check Availability
          </button>
        </div>

        {/* Current Job Status */}
        {currentJob && (
          <div className="bg-gray-700/50 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Current Job</span>
              <span className={`status-badge status-${currentJob.status}`}>
                {currentJob.status}
              </span>
            </div>

            <div className="text-sm font-mono">
              ID: {currentJob.id.slice(0, 8)}...
            </div>

            {currentJob.status === "processing" && (
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full animate-pulse"
                  style={{ width: "50%" }}
                />
              </div>
            )}

            {currentJob.processingTimeMs && (
              <div className="text-sm text-gray-400">
                Processing time:{" "}
                {(currentJob.processingTimeMs / 1000).toFixed(1)}s
              </div>
            )}

            {currentJob.error && (
              <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">
                {currentJob.error}
              </div>
            )}

            {getCurrentTraceId() && (
              <div className="text-xs text-gray-500 font-mono">
                trace: {getCurrentTraceId()?.slice(0, 16)}...
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-gray-500">
          <p>
            Downloads have simulated delays (5-15s in dev, 10-120s in prod).
          </p>
          <p>
            Trace IDs are propagated to the backend for distributed tracing.
          </p>
        </div>
      </div>
    </div>
  );
}
