'use client';

import React from 'react';
import StatusBadge from './StatusBadge';
import RelativeTime from './RelativeTime';
import { isFailingStatus } from '@/lib/status';
import type { DeploymentItem } from '@/types/deployments';

export interface RepoCardProps {
  repoName: string;
  repoOwner?: string;
  run: DeploymentItem;
  onOpenFailureLogs?: (deploymentId: string, repoName: string) => void;
}

export function RepoCard({ repoName, repoOwner, run, onOpenFailureLogs }: RepoCardProps) {
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

  const environmentBadgeStyle =
    run.environment === 'PRODUCTION'
      ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
      : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';

  return (
    <div
      role={failing ? 'button' : undefined}
      tabIndex={failing ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`group relative flex flex-col justify-between p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all duration-150 ${
        failing
          ? 'cursor-pointer hover:border-red-400 dark:hover:border-red-700/80 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500'
          : 'hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-xs'
      }`}
      style={{
        borderRadius: 'var(--card-radius, 0.75rem)',
        borderWidth: 'var(--card-border-width, 1px)',
      }}
    >
      <div>
        {/* Top row: Repo Name and Environment */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {repoOwner && (
              <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 truncate">
                {repoOwner} /
              </span>
            )}
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {repoName}
            </h3>
          </div>
          <span
            className={`px-2 py-0.5 text-2xs font-bold tracking-wider uppercase rounded-md border shrink-0 ${environmentBadgeStyle}`}
          >
            {run.environment}
          </span>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2 mb-4">
          <StatusBadge status={run.status} />
          {run.branch && (
            <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono truncate max-w-[140px]" title={run.branch}>
              {run.branch}
            </span>
          )}
        </div>
      </div>

      {/* Footer details: SHA, Author, Relative time */}
      <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-300 font-medium">
            {run.commitSha.slice(0, 7)}
          </span>
          <span className="truncate max-w-[110px]" title={run.commitAuthor}>
            {run.commitAuthor}
          </span>
        </div>
        <div className="shrink-0 text-zinc-400 dark:text-zinc-500">
          <RelativeTime date={run.timestamp} />
        </div>
      </div>

      {/* Failing hint banner */}
      {failing && (
        <div className="mt-3 -mx-5 -mb-5 px-5 py-2 bg-red-50/80 dark:bg-red-950/30 border-t border-red-100 dark:border-red-900/50 rounded-b-[calc(var(--card-radius,0.75rem)-1px)] flex items-center justify-between text-xs font-medium text-red-700 dark:text-red-400">
          <span>Click to view failure logs</span>
          <svg className="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}
    </div>
  );
}

export default RepoCard;
