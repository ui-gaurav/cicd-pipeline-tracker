'use client';

import React, { useState, useMemo } from 'react';
import useSWR from 'swr';
import EnvironmentTabs, { EnvironmentTab } from './EnvironmentTabs';
import RepoCard from './RepoCard';
import FailureLogPanel from './FailureLogPanel';
import type { RepositoryDeployments, DeploymentItem } from '@/types/deployments';

interface DashboardClientProps {
  initialData: RepositoryDeployments[];
  userRole?: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Request failed with status ${res.status}`);
  }
  return res.json();
};

interface FlatCard {
  cardKey: string;
  repoId: string;
  repoName: string;
  repoOwner: string;
  run: DeploymentItem;
}

export function DashboardClient({ initialData, userRole }: DashboardClientProps) {
  const [selectedTab, setSelectedTab] = useState<EnvironmentTab>('ALL');
  const [activeFailureLog, setActiveFailureLog] = useState<{ id: string; repoName: string } | null>(null);

  const { data, error, isValidating, mutate } = useSWR<RepositoryDeployments[]>(
    '/api/deployments',
    fetcher,
    {
      fallbackData: initialData,
      refreshInterval: 10000, // Poll every 10 seconds
      revalidateOnFocus: true,
      dedupingInterval: 3000,
    }
  );

  const repositories = useMemo(() => {
    return Array.isArray(data) ? data : initialData;
  }, [data, initialData]);

  // Compute flattened cards and counts
  const { allCards, counts } = useMemo(() => {
    const cards: FlatCard[] = [];
    let stagingCount = 0;
    let prodCount = 0;

    for (const repo of repositories) {
      if (repo.latestByEnvironment?.STAGING) {
        stagingCount++;
        cards.push({
          cardKey: `${repo.id}-STAGING-${repo.latestByEnvironment.STAGING.id}`,
          repoId: repo.id,
          repoName: repo.name,
          repoOwner: repo.owner,
          run: repo.latestByEnvironment.STAGING,
        });
      }
      if (repo.latestByEnvironment?.PRODUCTION) {
        prodCount++;
        cards.push({
          cardKey: `${repo.id}-PRODUCTION-${repo.latestByEnvironment.PRODUCTION.id}`,
          repoId: repo.id,
          repoName: repo.name,
          repoOwner: repo.owner,
          run: repo.latestByEnvironment.PRODUCTION,
        });
      }
    }

    return {
      allCards: cards,
      counts: {
        ALL: cards.length,
        STAGING: stagingCount,
        PRODUCTION: prodCount,
      },
    };
  }, [repositories]);

  // Filter cards based on selected tab
  const filteredCards = useMemo(() => {
    if (selectedTab === 'ALL') return allCards;
    return allCards.filter((card) => card.run.environment === selectedTab);
  }, [allCards, selectedTab]);

  const isAdmin = userRole === 'ADMIN';

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
      {/* Top Header / Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Pipeline Status Board
            </h1>
            {isValidating && (
              <span
                title="Updating status..."
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                Live
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Real-time multi-environment deployment health. Auto-refreshes every 10 seconds.
          </p>
        </div>

        {/* Right side toolbar */}
        <div className="flex items-center gap-3 shrink-0">
          {isAdmin && (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700/60 cursor-not-allowed select-none"
              title="Sync stats (Coming soon)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync stats
            </button>
          )}

          <EnvironmentTabs
            selectedTab={selectedTab}
            onSelectTab={setSelectedTab}
            counts={counts}
          />
        </div>
      </div>

      {/* Error state with retry and skeleton */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                Failed to update status board
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                {error.message || 'Network error encountered during polling.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => mutate()}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white dark:bg-zinc-900 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Cards Grid or Empty State */}
      {filteredCards.length > 0 ? (
        <div
          role="tabpanel"
          id={`tabpanel-${selectedTab.toLowerCase()}`}
          aria-labelledby={`tab-${selectedTab.toLowerCase()}`}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {filteredCards.map((card) => (
            <RepoCard
              key={card.cardKey}
              repoName={card.repoName}
              repoOwner={card.repoOwner}
              run={card.run}
              onOpenFailureLogs={(id, name) => {
                setActiveFailureLog({ id, repoName: name });
              }}
            />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/40">
          <div className="w-12 h-12 mx-auto rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 dark:text-zinc-500 mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            No pipeline runs found
          </h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
            {selectedTab === 'ALL'
              ? 'No GitHub workflow runs have been received yet. Once GitHub sends webhook events with a valid run ID, they will appear here.'
              : `No runs currently recorded for the ${selectedTab.toLowerCase()} environment.`}
          </p>
        </div>
      )}

      {/* Failure Log Drawer / Panel */}
      <FailureLogPanel
        deploymentId={activeFailureLog?.id ?? null}
        repoName={activeFailureLog?.repoName}
        onClose={() => setActiveFailureLog(null)}
      />
    </div>
  );
}

export default DashboardClient;
