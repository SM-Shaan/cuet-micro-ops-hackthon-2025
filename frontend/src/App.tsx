import { useState } from "react";
import { HealthStatus } from "./components/HealthStatus";
import { DownloadJobs } from "./components/DownloadJobs";
import { ErrorLog } from "./components/ErrorLog";
import { TraceViewer } from "./components/TraceViewer";
import { PerformanceMetrics } from "./components/PerformanceMetrics";
import { DownloadTester } from "./components/DownloadTester";
import { FileUpload } from "./components/FileUpload";

function App() {
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "downloads" | "upload" | "traces"
  >("dashboard");

  return (
    <div className="min-h-screen text-slate-900 relative overflow-hidden">
      {/* Decorative Background Blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="blob blob-pink w-96 h-96 top-20 -left-48 animate-blob"></div>
        <div className="blob blob-blue w-80 h-80 top-40 right-0 animate-blob animation-delay-2000"></div>
        <div className="blob blob-purple w-72 h-72 bottom-40 left-1/3 animate-blob animation-delay-4000"></div>
        <div className="blob blob-green w-64 h-64 bottom-20 right-1/4 animate-blob animation-delay-6000"></div>
        <div className="blob blob-amber w-56 h-56 top-1/2 left-10 animate-blob animation-delay-2000"></div>
      </div>

      {/* Header */}
      <header className="header-gradient border-b border-white/40 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent animate-float">
                Delineate Dashboard
              </h1>
              <p className="text-slate-500 text-sm">
                Observability for Download Service
              </p>
            </div>
            <div className="flex items-center gap-4">
              <a
                href={
                  import.meta.env.VITE_JAEGER_UI_URL || "http://localhost:16686"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-violet-700 hover:text-violet-800 text-sm font-medium bg-gradient-to-r from-violet-100 to-fuchsia-100 hover:from-violet-200 hover:to-fuchsia-200 px-4 py-2 rounded-xl transition-all duration-300 border border-violet-200 shadow-sm hover:shadow-md"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Jaeger UI
              </a>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="mt-4 flex gap-2 bg-gradient-to-r from-amber-50/60 via-rose-50/60 to-violet-50/60 backdrop-blur-sm p-1.5 rounded-2xl w-fit border border-violet-100/40 shadow-sm">
            {[
              { id: "dashboard", icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" },
              { id: "downloads", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" },
              { id: "upload", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" },
              { id: "traces", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`nav-btn flex items-center gap-2 ${
                  activeTab === tab.id
                    ? "nav-btn-active"
                    : "nav-btn-inactive"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                </svg>
                {tab.id.charAt(0).toUpperCase() + tab.id.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* Top Row: Health & Performance */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <HealthStatus />
              <PerformanceMetrics />
            </div>

            {/* Download Tester */}
            <DownloadTester />

            {/* Bottom Row: Recent Jobs & Errors */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DownloadJobs limit={5} />
              <ErrorLog limit={5} />
            </div>
          </div>
        )}

        {activeTab === "downloads" && (
          <div className="space-y-6">
            <DownloadTester />
            <DownloadJobs />
          </div>
        )}

        {activeTab === "upload" && (
          <div className="space-y-6">
            <FileUpload />
          </div>
        )}

        {activeTab === "traces" && (
          <div className="space-y-6">
            <TraceViewer />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gradient-to-r from-amber-50/60 via-rose-50/60 to-violet-50/60 backdrop-blur-md border-t border-violet-100/30 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <span className="text-slate-500 text-sm">
            CUET Micro-Ops Hackathon 2025 -
          </span>
          <span className="bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent font-semibold text-sm">
            {" "}Delineate Challenge
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
