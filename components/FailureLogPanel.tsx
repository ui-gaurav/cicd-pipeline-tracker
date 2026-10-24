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
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          ref={panelRef}
          className="w-screen max-w-2xl flex flex-col border-l border-[var(--border)]"
          style={{
            backgroundColor: 'var(--card)',
            color: 'var(--card-foreground)',
            borderRadius: '2px',
          }}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="section-label">FAILURE LOG</span>
              <div className="flex items-center gap-2">
                <h2
                  id="failure-log-title"
                  className="text-base font-medium text-[var(--foreground)]"
                >
                  {repoName || data?.repository?.name || 'Repository'}
                </h2>
                {data && <StatusBadge status={data.status} />}
              </div>
              <p className="text-xs text-[var(--muted-foreground)] font-mono">
                Run #{data?.runId || 'N/A'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {processedLogs && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1 text-xs font-mono border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] rounded-[2px] transition-colors cursor-pointer"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close failure log panel"
                className="px-2 py-1 text-xs font-mono border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] rounded-[2px] transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>

          {/* Metadata bar */}
          {data && (
            <div className="px-6 py-2.5 border-b border-[var(--border)] bg-[var(--background)] text-xs text-[var(--muted-foreground)] flex flex-wrap gap-x-6 gap-y-1 font-mono">
              <div>
                <span>SHA:</span>{' '}
                <span className="text-[var(--foreground)]">{data.commitSha.slice(0, 7)}</span>
              </div>
              <div>
                <span>Author:</span>{' '}
                <span className="text-[var(--foreground)]">{data.commitAuthor}</span>
              </div>
              <div>
                <span>Branch:</span>{' '}
                <span className="text-[var(--foreground)]">{data.branch}</span>
              </div>
              <div>
                <span>Env:</span>{' '}
                <span className="text-[var(--foreground)]">{data.environment}</span>
              </div>
            </div>
          )}

          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col">
            {isLoading && (
              <div className="flex flex-col items-center justify-center h-64 text-[var(--muted-foreground)]">
                <p className="text-xs font-mono uppercase tracking-wider">Loading run details...</p>
              </div>
            )}

            {error && (
              <div className="p-4 border border-[var(--destructive)] bg-[var(--card)] text-[var(--destructive)] text-xs font-mono rounded-[2px]">
                <p className="font-bold">Error loading run details</p>
                <p className="mt-1">{error.message || 'Error fetching run logs'}</p>
              </div>
            )}

            {!isLoading && !error && data && (
              <div className="flex-1 flex flex-col">
                {processedLogs ? (
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <span className="section-label">
                        {logLineCount > 200
                          ? `Last 200 lines (of ${logLineCount} total)`
                          : `${logLineCount} lines`}
                      </span>
                    </div>
                    <div
                      className="flex-1 p-4 overflow-auto border border-[var(--border)] rounded-[2px]"
                      style={{
                        backgroundColor: 'var(--muted)',
                        color: 'var(--foreground)',
                      }}
                    >
                      <pre className="font-mono text-[12px] leading-[1.6] whitespace-pre">
                        {processedLogs}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-center p-6 border border-dashed border-[var(--border)] rounded-[2px]">
                    <p className="text-xs font-mono uppercase text-[var(--muted-foreground)]">
                      No logs captured for this run.
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
