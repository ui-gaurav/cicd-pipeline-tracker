'use client';

import React, { useRef } from 'react';

export type EnvironmentTab = 'ALL' | 'STAGING' | 'PRODUCTION';

interface EnvironmentTabsProps {
  selectedTab: EnvironmentTab;
  onSelectTab: (tab: EnvironmentTab) => void;
  counts?: {
    ALL: number;
    STAGING: number;
    PRODUCTION: number;
  };
}

const TABS: { id: EnvironmentTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'STAGING', label: 'Staging' },
  { id: 'PRODUCTION', label: 'Production' },
];

export function EnvironmentTabs({ selectedTab, onSelectTab, counts }: EnvironmentTabsProps) {
  const tabRefs = useRef<{ [key in EnvironmentTab]?: HTMLButtonElement | null }>({});

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let newIndex = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      newIndex = (index + 1) % TABS.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      newIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      newIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      newIndex = TABS.length - 1;
    } else {
      return;
    }

    const nextTab = TABS[newIndex].id;
    onSelectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Filter deployments by environment"
      className="inline-flex p-1 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/60"
      style={{ borderRadius: 'var(--tab-radius, 0.5rem)' }}
    >
      {TABS.map((tab, idx) => {
        const isSelected = selectedTab === tab.id;
        const count = counts ? counts[tab.id] : null;

        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            role="tab"
            id={`tab-${tab.id.toLowerCase()}`}
            aria-selected={isSelected}
            aria-controls={`tabpanel-${tab.id.toLowerCase()}`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900 cursor-pointer ${
              isSelected
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-xs font-semibold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50'
            }`}
            style={{ borderRadius: 'calc(var(--tab-radius, 0.5rem) - 2px)' }}
          >
            <span>{tab.label}</span>
            {count !== null && count !== undefined && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-xs ${
                  isSelected
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                    : 'bg-zinc-200/80 dark:bg-zinc-700/70 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default EnvironmentTabs;
