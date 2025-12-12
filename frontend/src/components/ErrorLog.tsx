import { useState, useEffect } from "react";
import { Sentry } from "../lib/sentry";
import { generateUUID } from "../lib/uuid";

interface ErrorEntry {
  id: string;
  message: string;
  timestamp: Date;
  traceId?: string;
  context?: Record<string, unknown>;
}

interface ErrorLogProps {
  limit?: number;
}

export function ErrorLog({ limit }: ErrorLogProps) {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);

  // Listen for errors
  useEffect(() => {
    const handleError = (event: CustomEvent<ErrorEntry>) => {
      setErrors((prev) => [event.detail, ...prev].slice(0, 100));
    };

    window.addEventListener("appError", handleError as EventListener);

    // Also capture console errors
    const originalError = console.error;
    console.error = (...args) => {
      const message = args.map(String).join(" ");
      const errorEntry: ErrorEntry = {
        id: generateUUID(),
        message,
        timestamp: new Date(),
        traceId: sessionStorage.getItem("currentTraceId") || undefined,
      };

      window.dispatchEvent(new CustomEvent("appError", { detail: errorEntry }));

      originalError.apply(console, args);
    };

    return () => {
      window.removeEventListener("appError", handleError as EventListener);
      console.error = originalError;
    };
  }, []);

  // Load errors from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("errorLog");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setErrors(
          parsed.map((e: ErrorEntry) => ({
            ...e,
            timestamp: new Date(e.timestamp),
          })),
        );
      } catch {
        console.warn("Failed to parse stored errors");
      }
    }
  }, []);

  // Persist errors
  useEffect(() => {
    localStorage.setItem("errorLog", JSON.stringify(errors.slice(0, 50)));
  }, [errors]);

  const clearErrors = () => {
    setErrors([]);
    localStorage.removeItem("errorLog");
  };

  const triggerTestError = async () => {
    try {
      const response = await fetch("/api/v1/download/check?sentry_test=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: 70000 }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Sentry test error triggered");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.captureException(error);

      const errorEntry: ErrorEntry = {
        id: generateUUID(),
        message: error.message,
        timestamp: new Date(),
        traceId: sessionStorage.getItem("currentTraceId") || undefined,
      };

      setErrors((prev) => [errorEntry, ...prev]);
    }
  };

  const displayErrors = limit ? errors.slice(0, limit) : errors;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Error Log
          {errors.length > 0 && (
            <span className="text-sm text-red-400 ml-2">({errors.length})</span>
          )}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={triggerTestError}
            className="text-sm text-yellow-400 hover:text-yellow-300"
          >
            Test Sentry
          </button>
          {errors.length > 0 && (
            <button
              onClick={clearErrors}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {displayErrors.length === 0 ? (
        <div className="text-gray-400 text-center py-8">
          No errors recorded. Click "Test Sentry" to generate a test error.
        </div>
      ) : (
        <div className="space-y-2">
          {displayErrors.map((error) => (
            <div
              key={error.id}
              className="bg-red-500/10 border border-red-500/20 rounded p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-red-300 break-all">
                  {error.message}
                </p>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {error.timestamp.toLocaleTimeString()}
                </span>
              </div>
              {error.traceId && (
                <div className="text-xs text-gray-500 mt-1 font-mono">
                  trace: {error.traceId.slice(0, 16)}...
                </div>
              )}
            </div>
          ))}

          {limit && errors.length > limit && (
            <div className="text-center text-sm text-gray-400 pt-2">
              +{errors.length - limit} more errors
            </div>
          )}
        </div>
      )}
    </div>
  );
}
