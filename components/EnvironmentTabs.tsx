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
      className="inline-flex items-center gap-1.5"
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
            className={`flex items-center gap-1.5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] border border-[var(--border)] rounded-[2px] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--ring)] focus-visible:outline-offset-2 cursor-pointer ${
              isSelected
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
            style={{
              borderColor: 'var(--border)',
              borderRadius: '2px',
              borderWidth: '1px',
            }}
          >
            <span>{tab.label}</span>
            {count !== null && count !== undefined && (
              <span
                className={`text-[10px] ${
                  isSelected ? 'text-[var(--primary-foreground)] opacity-80' : 'text-[var(--muted-foreground)]'
                }`}
              >
                ({count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default EnvironmentTabs;
