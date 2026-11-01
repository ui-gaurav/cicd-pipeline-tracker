'use client';

import React from 'react';
import Link from 'next/link';
import StatusBadge from './StatusBadge';
import RelativeTime from './RelativeTime';
import { normalizeStatus, isStale, statusTone } from '@/lib/status';
import type { DeploymentItem } from '@/types/deployments';

export interface RepoCardProps {
  repoId?: string;
  repoName: string;
  repoOwner?: string;
  run?: DeploymentItem | null;
  nowMs?: number;
  isFlashed?: boolean;
  onOpenFailureLogs?: (deploymentId: string, repoName: string) => void;
}

const STRIPE_BORDER: Record<string, string> = {
  pass: 'border-l-status-pass',
  fail: 'border-l-status-fail',
  pending: 'border-l-status-pending',
  idle: 'border-l-status-idle',
};

export function RepoCard({
  repoId,
  repoName,
  repoOwner,
  run,
  nowMs,
  isFlashed,
  onOpenFailureLogs,
}: RepoCardProps) {
  const norm = run ? normalizeStatus(run.status) : 'idle';
  const tsMs = run?.timestamp ? new Date(run.timestamp).getTime() : 0;
  const isStaleRun = run && tsMs > 0 && nowMs ? isStale(run.status, tsMs, nowMs) : false;
  const tone = statusTone(run ? run.status : null, isStaleRun);
  const failing = norm === 'fail';

  const handleClick = () => {
    if (failing && onOpenFailureLogs && run) {
      onOpenFailureLogs(run.id, repoName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (failing && onOpenFailureLogs && run && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpenFailureLogs(run.id, repoName);
    }
  };

  const stripeClass = STRIPE_BORDER[tone] || 'border-l-status-idle';

  return (
    <div
      role={failing ? 'button' : undefined}
      tabIndex={failing ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`relative flex flex-col justify-between p-4 bg-card border border-border border-l-[3px] ${stripeClass} rounded-[var(--radius)] neo-card-interactive ${
        failing ? 'cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring' : ''
      } ${isFlashed ? 'animate-realtime-flash' : ''}`}
    >
      <div>
        {/* Top row: Repo Name and Environment */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            {repoOwner && (
              <span className="block text-[11px] text-muted-foreground truncate mb-0.5">
                {repoOwner} /
              </span>
            )}
            <h3 className="text-[15px] font-medium text-foreground truncate">
              {repoId ? (
                <Link
                  href={`/dashboard/${repoId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-[var(--radius)]"
                >
                  {repoName}
                </Link>
              ) : (
                repoName
              )}
            </h3>
          </div>
          {run && (
            <span className="section-label shrink-0">
              {run.environment}
            </span>
          )}
        </div>

        {/* Status Badge & Branch */}
        <div className="flex items-center gap-2 mb-3">
          <StatusBadge
            status={run ? run.status : 'IDLE'}
            timestamp={run?.timestamp}
            nowMs={nowMs}
          />
          {run?.branch && (
            <span
              className="text-[11px] text-muted-foreground font-mono truncate max-w-[140px]"
              title={run.branch}
            >
              {run.branch}
            </span>
          )}
        </div>
      </div>

      {/* Footer details */}
      <div>
        <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
          {run ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <span className="px-1.5 py-0.5 rounded-[var(--radius)] bg-muted font-mono text-[11px] text-foreground inline-block">
                  {run.commitSha.slice(0, 7)}
                </span>
                <span
                  className="truncate text-muted-foreground text-xs max-w-[110px]"
                  title={run.commitAuthor}
                >
                  {run.commitAuthor}
                </span>
              </div>
              <div className="shrink-0 text-muted-foreground text-xs">
                <RelativeTime date={run.timestamp} />
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground font-mono">
              No runs yet
            </span>
          )}
        </div>

        {/* Failing view log indicator */}
        {failing && (
          <div className="mt-2 text-right">
            <span className="underline text-xs text-foreground hover:text-muted-foreground">
              View log
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default RepoCard;
