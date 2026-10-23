'use client';

import React, { useEffect, useState, useRef } from 'react';
import useSWR from 'swr';
import StatusBadge from './StatusBadge';

interface DeploymentDetail {
  id: string;
  runId: string | null;
  commitSha: string;
  commitAuthor: string;
  branch: string;
  environment: string;
  status: string;
  logs: string | null;
  timestamp: string;
  repository?: {
    name: string;
    owner: string;
  };
}

interface FailureLogPanelProps {
  deploymentId: string | null;
  onClose: () => void;
  repoName?: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Failed to fetch run details (${res.status})`);
  }
  return res.json();
};

export function FailureLogPanel({ deploymentId, onClose, repoName }: FailureLogPanelProps) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data, error, isLoading } = useSWR<DeploymentDetail>(
    deploymentId ? `/api/deployments/${deploymentId}` : null,
    fetcher
  );

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && deploymentId) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deploymentId, onClose]);

  if (!deploymentId) return null;

  // Process logs: last 200 lines
  let processedLogs: string | null = null;
  let logLineCount = 0;
  if (data?.logs) {
    const lines = data.logs.split(/\r?\n/);
    logLineCount = lines.length;
    processedLogs = lines.slice(-200).join('\n');
  }

  const handleCopy = () => {
    if (!processedLogs) return;
    navigator.clipboard.writeText(processedLogs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="failure-log-title"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          ref={panelRef}
          className="w-screen max-w-2xl bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    id="failure-log-title"
                    className="text-lg font-bold text-zinc-900 dark:text-zinc-100"
                  >
                    Failure Logs
                  </h2>
                  {data && <StatusBadge status={data.status} />}
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {repoName || data?.repository?.name || 'Repository'} • Run #{data?.runId || 'N/A'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {processedLogs && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                >
                  {copied ? 'Copied!' : 'Copy logs'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close failure log panel"
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Metadata bar */}
          {data && (
            <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 flex flex-wrap gap-x-6 gap-y-1">
              <div>
                <span className="font-medium text-zinc-900 dark:text-zinc-300">Commit:</span>{' '}
                <span className="font-mono">{data.commitSha.slice(0, 7)}</span>
              </div>
              <div>
                <span className="font-medium text-zinc-900 dark:text-zinc-300">Author:</span>{' '}
                {data.commitAuthor}
              </div>
              <div>
                <span className="font-medium text-zinc-900 dark:text-zinc-300">Branch:</span>{' '}
                {data.branch}
              </div>
              <div>
                <span className="font-medium text-zinc-900 dark:text-zinc-300">Env:</span>{' '}
                {data.environment}
              </div>
            </div>
          )}

          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading && (
              <div className="flex flex-col items-center justify-center h-64 text-zinc-500 dark:text-zinc-400">
                <div className="w-8 h-8 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm">Fetching run details...</p>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-300 text-sm">
                <p className="font-semibold">Failed to load run details</p>
                <p className="mt-1">{error.message || 'Error fetching run logs'}</p>
              </div>
            )}

            {!isLoading && !error && data && (
              <div>
                {processedLogs ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                        {logLineCount > 200
                          ? `Showing last 200 lines (of ${logLineCount} total)`
                          : `${logLineCount} lines`}
                      </span>
                    </div>
                    <div className="bg-zinc-950 text-zinc-200 rounded-lg p-4 font-mono text-xs overflow-x-auto border border-zinc-800 max-h-[calc(100vh-280px)]">
                      <pre className="whitespace-pre">{processedLogs}</pre>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-center p-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                    <svg
                      className="w-10 h-10 text-zinc-400 dark:text-zinc-600 mb-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      No logs captured for this run.
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                      No console output or diagnostic logs were attached with this delivery.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FailureLogPanel;
