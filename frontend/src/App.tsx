import { useState } from 'react';
import { HealthStatus } from './components/HealthStatus';
import { DownloadJobs } from './components/DownloadJobs';
import { ErrorLog } from './components/ErrorLog';
import { TraceViewer } from './components/TraceViewer';
import { PerformanceMetrics } from './components/PerformanceMetrics';
import { DownloadTester } from './components/DownloadTester';

function App() {
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'downloads' | 'traces'
  >('dashboard');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Delineate Dashboard</h1>
              <p className="text-gray-400 text-sm">
                Observability for Download Service
              </p>
            </div>
            <div className="flex items-center gap-4">
              <a
                href={
                  import.meta.env.VITE_JAEGER_UI_URL || 'http://localhost:16686'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Open Jaeger UI
              </a>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="mt-4 flex gap-4">
            {['dashboard', 'downloads', 'traces'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as typeof activeTab)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'dashboard' && (
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

        {activeTab === 'downloads' && (
          <div className="space-y-6">
            <DownloadTester />
            <DownloadJobs />
          </div>
        )}

        {activeTab === 'traces' && (
          <div className="space-y-6">
            <TraceViewer />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-400 text-sm">
          CUET Micro-Ops Hackathon 2025 - Delineate Challenge
        </div>
      </footer>
    </div>
  );
}

export default App;
