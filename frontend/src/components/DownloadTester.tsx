import { useState, useRef } from "react";
import { createSpan, getCurrentTraceId } from "../lib/tracing";
import { addBreadcrumb, captureError } from "../lib/sentry";
import { generateUUID } from "../lib/uuid";

interface DownloadJob {
  id: string;
  fileId: number;
  userId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  processingTimeMs?: number;
  downloadUrl?: string;
  error?: string;
}

export function DownloadTester() {
  const [fileId, setFileId] = useState(70000);
  const [loading, setLoading] = useState(false);
  const [currentJob, setCurrentJob] = useState<DownloadJob | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const emitMetric = (type: string, value: number) => {
    window.dispatchEvent(
      new CustomEvent("metricUpdate", { detail: { type, value } }),
    );
  };

  const emitJobUpdate = (job: DownloadJob) => {
    window.dispatchEvent(new CustomEvent("downloadJobUpdate", { detail: job }));
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const pollStatus = async (userId: string, job: DownloadJob) => {
    try {
      const response = await fetch(`/api/v1/download/status/${userId}`);
      if (!response.ok) {
        if (response.status === 404) {
          // Job not found, might have expired
          return;
        }
        throw new Error("Failed to fetch status");
      }

      const status = await response.json();

      const updatedJob: DownloadJob = {
        ...job,
        status: status.status,
        progress: status.progress || 0,
        processingTimeMs: status.processingTimeMs,
        downloadUrl: status.downloadUrl,
        error: status.error || status.message,
      };

      if (status.status === "completed" || status.status === "failed") {
        updatedJob.completedAt = new Date();
        stopPolling();
        setLoading(false);
        emitMetric("activeJobs", -1);
        emitMetric("responseTime", status.processingTimeMs || 0);

        if (status.status === "failed") {
          emitMetric("error", 1);
        }
      }

      setCurrentJob(updatedJob);
      emitJobUpdate(updatedJob);
    } catch (err) {
      console.error("Polling error:", err);
    }
  };

  const startDownload = async () => {
    if (loading) return;

    stopPolling();
    setLoading(true);
    const startTime = Date.now();
    const userId = `user-${generateUUID().slice(0, 8)}`;

    const job: DownloadJob = {
      id: generateUUID(),
      fileId,
      userId,
      status: "pending",
      progress: 0,
      startedAt: new Date(),
    };

    setCurrentJob(job);
    emitJobUpdate(job);
    emitMetric("activeJobs", 1);
    emitMetric("request", 1);

    try {
      addBreadcrumb("Starting download", "download", { fileId, userId });

      const result = await createSpan(
        "download-start",
        async () => {
          const response = await fetch("/api/v1/download/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_id: fileId, user_id: userId }),
          });

          if (!response.ok) {
            const error = await response.json();
            // Handle 503 Service Unavailable specifically
            if (response.status === 503) {
              const serviceError = new Error(
                error.message || "Service temporarily unavailable",
              );
              (
                serviceError as Error & { isServiceError: boolean }
              ).isServiceError = true;
              throw serviceError;
            }
            throw new Error(error.message || "Download failed");
          }

          return response.json();
        },
        {
          "download.file_id": fileId,
          "download.user_id": userId,
          "download.trace_id": getCurrentTraceId() || "",
        },
      );

      // Update job with server response
      const queuedJob: DownloadJob = {
        ...job,
        id: result.jobId,
        status: "processing",
        progress: 0,
      };

      setCurrentJob(queuedJob);
      emitJobUpdate(queuedJob);

      // Start polling for status updates
      pollIntervalRef.current = setInterval(() => {
        pollStatus(userId, queuedJob);
      }, 1000);

      // Initial poll
      setTimeout(() => pollStatus(userId, queuedJob), 500);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      captureError(error, { fileId, userId });

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
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Download Tester</h2>

      <div className="space-y-4">
        {/* File ID Input */}
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            File ID (10,000 - 100,000,000)
          </label>
          <input
            type="number"
            min={10000}
            max={100000000}
            value={fileId}
            onChange={(e) => setFileId(Number(e.target.value))}
            className="input"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={startDownload}
            disabled={loading}
            className={`flex-1 py-2.5 px-4 rounded-lg font-medium transition-colors ${
              loading
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
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
            className="btn-secondary disabled:opacity-50"
          >
            Check Availability
          </button>
        </div>

        {/* Current Job Status */}
        {currentJob && (
          <div className="bg-slate-50 rounded-lg p-4 space-y-3 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Current Job</span>
              <span className={`status-badge status-${currentJob.status}`}>
                {currentJob.status}
              </span>
            </div>

            <div className="text-sm font-mono text-slate-600">
              ID: {currentJob.id.slice(0, 8)}...
            </div>

            {/* Progress Bar */}
            {(currentJob.status === "processing" ||
              currentJob.status === "pending") && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Progress</span>
                  <span>{currentJob.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${currentJob.progress}%` }}
                  />
                </div>
              </div>
            )}

            {currentJob.processingTimeMs && (
              <div className="text-sm text-slate-500">
                Processing time:{" "}
                {(currentJob.processingTimeMs / 1000).toFixed(1)}s
              </div>
            )}

            {/* Download URL */}
            {currentJob.downloadUrl && currentJob.status === "completed" && (
              <div className="text-sm">
                <a
                  href={`/api${currentJob.downloadUrl}`}
                  download
                  className="text-blue-600 hover:text-blue-700 font-medium underline"
                >
                  Download File
                </a>
              </div>
            )}

            {/* Show message for completed jobs */}
            {currentJob.status === "completed" && !currentJob.downloadUrl && (
              <div className="alert-success text-sm">
                Job completed successfully
              </div>
            )}

            {/* Show error/message for failed jobs */}
            {currentJob.status === "failed" && currentJob.error && (
              <div
                className={`text-sm p-3 rounded-lg ${
                  currentJob.error.includes("unavailable") ||
                  currentJob.error.includes("Service")
                    ? "alert-error"
                    : "alert-warning"
                }`}
              >
                <div className="font-medium">
                  {currentJob.error.includes("unavailable") ||
                  currentJob.error.includes("Service")
                    ? "Service Error"
                    : "Job completed with message:"}
                </div>
                <div className="mt-1">{currentJob.error}</div>
                {currentJob.error.includes("unavailable") ||
                currentJob.error.includes("Service") ? (
                  <div className="text-xs opacity-80 mt-2">
                    Check the System Health panel. Redis or S3 may be down.
                    <button
                      onClick={() =>
                        window.dispatchEvent(new CustomEvent("checkHealth"))
                      }
                      className="ml-2 text-blue-600 hover:text-blue-700 underline"
                    >
                      Refresh Health
                    </button>
                  </div>
                ) : (
                  <div className="text-xs opacity-80 mt-1">
                    (File may not exist in S3 storage)
                  </div>
                )}
              </div>
            )}

            {getCurrentTraceId() && (
              <div className="text-xs text-slate-400 font-mono">
                trace: {getCurrentTraceId()?.slice(0, 16)}...
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-slate-400 space-y-1">
          <p>
            Downloads have simulated delays (5-15s in dev, 10-120s in prod).
          </p>
          <p>
            Trace IDs are propagated to the backend for distributed tracing.
          </p>
          <p className="text-emerald-600">
            Mock mode: File IDs divisible by 7 (e.g., 70000, 70007) succeed.
            Other IDs will show "File not found".
          </p>
        </div>
      </div>
    </div>
  );
}
