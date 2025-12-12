import { useState, useEffect } from "react";

interface DownloadJob {
  id: string;
  fileId: number;
  userId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  processingTimeMs?: number;
  downloadUrl?: string;
  error?: string;
}

interface DownloadJobsProps {
  limit?: number;
}

export function DownloadJobs({ limit }: DownloadJobsProps) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);

  // Load jobs from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("downloadJobs");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setJobs(
          parsed.map((job: DownloadJob) => ({
            ...job,
            startedAt: new Date(job.startedAt),
            completedAt: job.completedAt
              ? new Date(job.completedAt)
              : undefined,
          })),
        );
      } catch {
        console.error("Failed to parse stored jobs");
      }
    }
  }, []);

  // Listen for job updates
  useEffect(() => {
    const handleJobUpdate = (event: CustomEvent<DownloadJob>) => {
      setJobs((prev) => {
        const updated = [...prev];
        const index = updated.findIndex((j) => j.id === event.detail.id);
        if (index >= 0) {
          updated[index] = event.detail;
        } else {
          updated.unshift(event.detail);
        }

        // Persist to localStorage
        localStorage.setItem(
          "downloadJobs",
          JSON.stringify(updated.slice(0, 50)),
        );

        return updated;
      });
    };

    window.addEventListener(
      "downloadJobUpdate",
      handleJobUpdate as EventListener,
    );
    return () => {
      window.removeEventListener(
        "downloadJobUpdate",
        handleJobUpdate as EventListener,
      );
    };
  }, []);

  const clearJobs = () => {
    setJobs([]);
    localStorage.removeItem("downloadJobs");
  };

  const displayJobs = limit ? jobs.slice(0, limit) : jobs;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Download Jobs
          {jobs.length > 0 && (
            <span className="text-sm text-gray-400 ml-2">({jobs.length})</span>
          )}
        </h2>
        {jobs.length > 0 && (
          <button
            onClick={clearJobs}
            className="text-sm text-red-400 hover:text-red-300"
          >
            Clear All
          </button>
        )}
      </div>

      {displayJobs.length === 0 ? (
        <div className="text-gray-400 text-center py-8">
          No download jobs yet. Use the Download Tester to create jobs.
        </div>
      ) : (
        <div className="space-y-3">
          {displayJobs.map((job) => (
            <div
              key={job.id}
              className="bg-gray-700/50 rounded-lg p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">
                    {job.id.slice(0, 8)}
                  </span>
                  <span className="text-gray-400">|</span>
                  <span className="text-sm">File: {job.fileId}</span>
                </div>
                <span className={`status-badge status-${job.status}`}>
                  {job.status}
                </span>
              </div>

              {job.status === "processing" && (
                <div className="w-full bg-gray-600 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Started: {job.startedAt.toLocaleTimeString()}</span>
                {job.processingTimeMs && (
                  <span>{(job.processingTimeMs / 1000).toFixed(1)}s</span>
                )}
              </div>

              {job.error && (
                <div className="text-xs text-red-400 bg-red-500/10 p-2 rounded">
                  {job.error}
                </div>
              )}
            </div>
          ))}

          {limit && jobs.length > limit && (
            <div className="text-center text-sm text-gray-400 pt-2">
              +{jobs.length - limit} more jobs
            </div>
          )}
        </div>
      )}
    </div>
  );
}
