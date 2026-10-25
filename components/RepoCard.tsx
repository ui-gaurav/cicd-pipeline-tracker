'use client';

import React from 'react';
import Link from 'next/link';
import StatusBadge from './StatusBadge';
import RelativeTime from './RelativeTime';
import { isFailingStatus } from '@/lib/status';
import type { DeploymentItem } from '@/types/deployments';

export interface RepoCardProps {
  repoId?: string;
  repoName: string;
  repoOwner?: string;
  run: DeploymentItem;
  isFlashed?: boolean;
  onOpenFailureLogs?: (deploymentId: string, repoName: string) => void;
}

function toSentenceCase(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function RepoCard({ repoId, repoName, repoOwner, run, isFlashed, onOpenFailureLogs }: RepoCardProps) {
  const failing = isFailingStatus(run.status);

  const handleClick = () => {
    if (failing && onOpenFailureLogs) {
      onOpenFailureLogs(run.id, repoName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (failing && onOpenFailureLogs && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpenFailureLogs(run.id, repoName);
    }
  };

  return (
    <div
      role={failing ? 'button' : undefined}
      tabIndex={failing ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`relative flex flex-col justify-between p-4 border transition-colors ${
        failing ? 'cursor-pointer' : ''
      } ${isFlashed ? 'animate-realtime-flash' : ''}`}
      style={{
        backgroundColor: 'var(--card)',
        borderColor: 'var(--border)',
        borderWidth: '1px',
        borderRadius: '2px',
        ...(failing ? { borderLeftWidth: '3px', borderLeftColor: 'var(--status-fail)' } : {}),
      }}
    >
      <div>
        {/* Top row: Repo Name and Environment */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            {repoOwner && (
              <span className="block text-[11px] text-[var(--muted-foreground)] truncate mb-0.5">
                {toSentenceCase(repoOwner)} /
              </span>
            )}
            <h3 className="text-[15px] font-medium text-[var(--card-foreground)] truncate">
              {repoId ? (
                <Link
                  href={`/dashboard/${repoId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:underline focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                >
                  {toSentenceCase(repoName)}
                </Link>
              ) : (
                toSentenceCase(repoName)
              )}
            </h3>
          </div>
          <span className="section-label shrink-0">
            {run.environment}
          </span>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2 mb-3">
          <StatusBadge status={run.status} />
          {run.branch && (
            <span
              className="text-[11px] text-[var(--muted-foreground)] font-mono truncate max-w-[140px]"
              title={run.branch}
            >
              {run.branch}
            </span>
          )}
        </div>
      </div>

      {/* Footer details: SHA, Author, Relative time */}
      <div>
        <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] text-[var(--foreground)]">
              {run.commitSha.slice(0, 7)}
            </span>
            <span
              className="truncate text-[var(--muted-foreground)] text-xs max-w-[110px]"
              title={run.commitAuthor}
            >
              {toSentenceCase(run.commitAuthor)}
            </span>
          </div>
          <div className="shrink-0 text-[var(--muted-foreground)] text-xs">
            <RelativeTime date={run.timestamp} />
          </div>
        </div>

        {/* Failing plain underlined text */}
        {failing && (
          <div className="mt-2 text-right">
            <span className="underline text-[12px] text-[var(--foreground)] hover:text-[var(--muted-foreground)]">
              View log
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default RepoCard;
