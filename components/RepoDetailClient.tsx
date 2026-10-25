'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import StatusBadge from './StatusBadge';
import RelativeTime from './RelativeTime';
import FailureLogPanel from './FailureLogPanel';
import { isFailingStatus } from '@/lib/status';
import type { RepoDetailData } from '@/lib/repo-stats';

interface RepoDetailClientProps {
  initialData: RepoDetailData;
  userRole?: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Failed to fetch repo stats (${res.status})`);
  }
  return res.json();
};

function toSentenceCase(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function RepoDetailClient({ initialData, userRole }: RepoDetailClientProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activeFailureLog, setActiveFailureLog] = useState<{ id: string; repoName: string } | null>(null);

  const { data, mutate } = useSWR<RepoDetailData>(
    `/api/repos/${initialData.repository.id}/stats`,
    fetcher,
    {
      fallbackData: initialData,
      revalidateOnFocus: true,
    }
  );

  const repo = data || initialData;
  const isAdmin = userRole === 'ADMIN';

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncError(null);

    try {
      const res = await fetch(`/api/repos/${repo.repository.id}/sync`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Sync failed with status ${res.status}`);
      }

      await mutate();
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : 'Failed to sync repository stats');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
      {/* Back Link */}
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        >
          ← Back to dashboard
        </Link>
      </div>

      {/* Header with Title and Sync stats button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-4 border-b border-[var(--border)]">
        <div>
          <span className="section-label">
            {toSentenceCase(repo.repository.owner)} /
          </span>
          <h1 className="text-2xl font-medium tracking-tight text-[var(--foreground)] mt-0.5">
            {toSentenceCase(repo.repository.name)}
          </h1>
        </div>

        {/* Sync stats button: active for ADMIN, hidden for VIEWER */}
        {isAdmin && (
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] border border-[var(--border)] bg-[var(--primary)] text-[var(--primary-foreground)] rounded-[2px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--ring)] focus-visible:outline-offset-2"
            >
              {isSyncing ? 'Syncing...' : 'Sync stats'}
            </button>
          </div>
        )}
      </div>

      {/* Sync Error State */}
      {syncError && (
        <div className="mb-6 p-4 border border-[var(--destructive)] bg-[var(--card)] text-[var(--destructive)] rounded-[2px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold uppercase">Sync error:</span>
            <span className="font-mono text-xs">{syncError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncError(null)}
            className="text-xs font-mono uppercase underline text-[var(--destructive)] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Two Groups: Deployment activity & Repository stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Group 1: Deployment activity */}
        <section aria-labelledby="deployment-activity-heading">
          <div className="mb-3">
            <h2 id="deployment-activity-heading" className="section-label">
              Deployment activity
            </h2>
          </div>

          {/* Counts and Success Rate */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div
              className="p-3 border border-[var(--border)] rounded-[2px]"
              style={{ backgroundColor: 'var(--card)' }}
            >
              <span className="section-label block mb-1">Total runs</span>
              <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                {repo.totalRuns}
              </span>
            </div>

            <div
              className="p-3 border border-[var(--border)] rounded-[2px]"
              style={{ backgroundColor: 'var(--card)' }}
            >
              <span className="section-label block mb-1">Passed</span>
              <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                {repo.passed}
              </span>
            </div>

            <div
              className="p-3 border border-[var(--border)] rounded-[2px]"
              style={{ backgroundColor: 'var(--card)' }}
            >
              <span className="section-label block mb-1">Failed</span>
              <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                {repo.failed}
              </span>
            </div>

            <div
              className="p-3 border border-[var(--border)] rounded-[2px]"
              style={{ backgroundColor: 'var(--card)' }}
            >
              <span className="section-label block mb-1">Success rate</span>
              <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                {repo.successRate}%
              </span>
            </div>
          </div>

          {/* Recent Runs (Last 10) */}
          <div>
            <h3 className="section-label mb-2">Recent runs (last 10)</h3>
            {repo.recentRuns.length > 0 ? (
              <div
                className="border border-[var(--border)] rounded-[2px] overflow-hidden"
                style={{ backgroundColor: 'var(--card)' }}
              >
                <div className="divide-y divide-[var(--border)]">
                  {repo.recentRuns.map((run) => {
                    const failing = isFailingStatus(run.status);
                    return (
                      <div
                        key={run.id}
                        className={`p-3 flex items-center justify-between gap-3 text-xs ${
                          failing ? 'border-l-[3px] border-l-[var(--status-fail)]' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <StatusBadge status={run.status} />
                          <span className="font-mono text-[11px] text-[var(--foreground)]">
                            {run.sha.slice(0, 7)}
                          </span>
                          <span
                            className="text-[var(--muted-foreground)] truncate max-w-[120px]"
                            title={run.author}
                          >
                            {toSentenceCase(run.author)}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="section-label">{run.environment}</span>
                          <RelativeTime
                            date={run.timestamp}
                            className="text-[var(--muted-foreground)] text-xs"
                          />
                          {failing && (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveFailureLog({
                                  id: run.id,
                                  repoName: repo.repository.name,
                                })
                              }
                              className="underline text-[11px] text-[var(--foreground)] hover:text-[var(--muted-foreground)] cursor-pointer"
                            >
                              View log
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div
                className="p-8 text-center border border-dashed border-[var(--border)] rounded-[2px]"
                style={{ backgroundColor: 'var(--card)' }}
              >
                <p className="text-xs font-mono uppercase text-[var(--muted-foreground)]">
                  No pipeline runs recorded for this repository.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Group 2: Repository stats */}
        <section aria-labelledby="repository-stats-heading">
          <div className="mb-3">
            <h2 id="repository-stats-heading" className="section-label">
              Repository stats
            </h2>
          </div>

          {repo.stats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div
                  className="p-3 border border-[var(--border)] rounded-[2px]"
                  style={{ backgroundColor: 'var(--card)' }}
                >
                  <span className="section-label block mb-1">Total commits</span>
                  <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                    {repo.stats.totalCommits.toLocaleString()}
                  </span>
                </div>

                <div
                  className="p-3 border border-[var(--border)] rounded-[2px]"
                  style={{ backgroundColor: 'var(--card)' }}
                >
                  <span className="section-label block mb-1">Contributors</span>
                  <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                    {repo.stats.contributors.toLocaleString()}
                  </span>
                </div>

                <div
                  className="p-3 border border-[var(--border)] rounded-[2px]"
                  style={{ backgroundColor: 'var(--card)' }}
                >
                  <span className="section-label block mb-1">Stars</span>
                  <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                    {repo.stats.stars.toLocaleString()}
                  </span>
                </div>

                <div
                  className="p-3 border border-[var(--border)] rounded-[2px]"
                  style={{ backgroundColor: 'var(--card)' }}
                >
                  <span className="section-label block mb-1">Open issues</span>
                  <span className="text-xl font-mono font-medium text-[var(--foreground)]">
                    {repo.stats.openIssues.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Language & Last Synced footer */}
              <div
                className="p-3 border border-[var(--border)] rounded-[2px] flex items-center justify-between text-xs font-mono"
                style={{ backgroundColor: 'var(--card)' }}
              >
                <div>
                  <span className="text-[var(--muted-foreground)]">Language: </span>
                  <span className="text-[var(--foreground)]">
                    {repo.stats.primaryLanguage || 'Not specified'}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--muted-foreground)]">Last synced: </span>
                  {repo.stats.lastSyncedAt ? (
                    <RelativeTime
                      date={repo.stats.lastSyncedAt}
                      className="text-[var(--foreground)]"
                    />
                  ) : (
                    <span className="text-[var(--muted-foreground)]">Never</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              className="p-8 text-center border border-dashed border-[var(--border)] rounded-[2px]"
              style={{ backgroundColor: 'var(--card)' }}
            >
              <p className="text-xs font-mono uppercase text-[var(--muted-foreground)] mb-2">
                No repository stats synced yet.
              </p>
              {isAdmin ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Click the &quot;Sync stats&quot; button above to fetch commits, contributors, stars, and open issues from GitHub.
                </p>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">
                  An administrator has not synced stats from GitHub for this repository yet.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Failure Log Drawer / Panel */}
      <FailureLogPanel
        deploymentId={activeFailureLog?.id ?? null}
        repoName={activeFailureLog?.repoName}
        onClose={() => setActiveFailureLog(null)}
      />
    </div>
  );
}

export default RepoDetailClient;
