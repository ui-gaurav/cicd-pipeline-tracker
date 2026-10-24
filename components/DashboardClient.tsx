'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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

function extractCardsMap(repos: RepositoryDeployments[]): Map<string, { status: string; runId: string }> {
  const map = new Map<string, { status: string; runId: string }>();
  for (const repo of repos) {
    if (repo.latestByEnvironment?.STAGING) {
      map.set(`${repo.id}-STAGING`, {
        status: repo.latestByEnvironment.STAGING.status,
        runId: repo.latestByEnvironment.STAGING.id,
      });
    }
    if (repo.latestByEnvironment?.PRODUCTION) {
      map.set(`${repo.id}-PRODUCTION`, {
        status: repo.latestByEnvironment.PRODUCTION.status,
        runId: repo.latestByEnvironment.PRODUCTION.id,
      });
    }
  }
  return map;
}

export function DashboardClient({ initialData, userRole }: DashboardClientProps) {
  const [selectedTab, setSelectedTab] = useState<EnvironmentTab>('ALL');
  const [activeFailureLog, setActiveFailureLog] = useState<{ id: string; repoName: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(10);
  const [flashedCards, setFlashedCards] = useState<Set<string>>(new Set());

  // Initialize with initialData so first load never flashes
  const prevCardsRef = useRef<Map<string, { status: string; runId: string }>>(
    extractCardsMap(initialData)
  );
  const isFirstLoadRef = useRef<boolean>(true);

  const { data, error, mutate } = useSWR<RepositoryDeployments[]>(
    '/api/deployments',
    fetcher,
    {
      fallbackData: initialData,
      refreshInterval: 10000, // Poll every 10 seconds
      revalidateOnFocus: true,
      dedupingInterval: 3000,
      onSuccess: (newData) => {
        setSecondsLeft(10);

        if (isFirstLoadRef.current) {
          isFirstLoadRef.current = false;
          prevCardsRef.current = extractCardsMap(newData);
          return;
        }

        const nextMap = extractCardsMap(newData);
        const changedKeys = new Set<string>();

        for (const [key, cur] of nextMap.entries()) {
          const prev = prevCardsRef.current.get(key);
          if (prev) {
            if (prev.status !== cur.status || prev.runId !== cur.runId) {
              changedKeys.add(key);
            }
          } else {
            changedKeys.add(key);
          }
        }

        prevCardsRef.current = nextMap;

        if (changedKeys.size > 0) {
          setFlashedCards(changedKeys);
          setTimeout(() => {
            setFlashedCards(new Set());
          }, 200);
        }
      },
    }
  );

  // 10s countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 1 ? prev - 1 : 10));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
          cardKey: `${repo.id}-STAGING`,
          repoId: repo.id,
          repoName: repo.name,
          repoOwner: repo.owner,
          run: repo.latestByEnvironment.STAGING,
        });
      }
      if (repo.latestByEnvironment?.PRODUCTION) {
        prodCount++;
        cards.push({
          cardKey: `${repo.id}-PRODUCTION`,
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
    <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
      {/* Top Header / Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-[var(--foreground)]">
            Pipeline Status Board
          </h1>
          <div className="mt-1 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 shrink-0 inline-block"
                style={{ backgroundColor: 'var(--accent)' }}
                aria-hidden="true"
              />
              <span className="section-label">
                Refreshing in {secondsLeft}s
              </span>
            </div>
          </div>
        </div>

        {/* Right side toolbar */}
        <div className="flex items-center gap-3 shrink-0">
          {isAdmin && (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] border border-[var(--border)] bg-transparent text-[var(--foreground)] opacity-50 cursor-not-allowed rounded-[2px]"
              title="Sync stats (Coming soon)"
            >
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

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 border border-[var(--destructive)] bg-[var(--card)] text-[var(--destructive)] rounded-[2px] flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase font-bold">
              Failed to update status board
            </p>
            <p className="text-xs font-mono mt-0.5 opacity-80">
              {error.message || 'Network error encountered during polling.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => mutate()}
            className="px-3 py-1 text-xs font-mono uppercase tracking-[0.08em] border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] rounded-[2px] transition-colors cursor-pointer"
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
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {filteredCards.map((card) => (
            <RepoCard
              key={card.cardKey}
              repoName={card.repoName}
              repoOwner={card.repoOwner}
              run={card.run}
              isFlashed={flashedCards.has(card.cardKey)}
              onOpenFailureLogs={(id, name) => {
                setActiveFailureLog({ id, repoName: name });
              }}
            />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center border border-dashed border-[var(--border)] rounded-[2px] bg-[var(--card)]">
          <h3 className="text-sm font-medium text-[var(--foreground)]">
            No pipeline runs found
          </h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-sm mx-auto">
            {selectedTab === 'ALL'
              ? 'No GitHub workflow runs have been recorded yet.'
              : `No runs recorded for the ${selectedTab.toLowerCase()} environment.`}
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
