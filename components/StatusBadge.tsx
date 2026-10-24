import React from 'react';

export interface StatusBadgeProps {
  status: string;
  className?: string;
  showText?: boolean;
}

type BadgeStatus = 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING';

function getBadgeConfig(status: string | null | undefined): { label: BadgeStatus; color: string } {
  const s = (status ?? '').toUpperCase();
  if (s === 'SUCCESS' || s === 'PASSED') {
    return { label: 'PASSED', color: 'var(--status-pass)' };
  }
  if (['FAILED', 'FAILURE', 'CANCELLED', 'TIMED_OUT'].includes(s)) {
    return { label: 'FAILED', color: 'var(--status-fail)' };
  }
  if (s === 'RUNNING' || s === 'IN_PROGRESS') {
    return { label: 'RUNNING', color: 'var(--status-pending)' };
  }
  if (['PENDING', 'QUEUED', 'WAITING', 'REQUESTED'].includes(s)) {
    return { label: 'PENDING', color: 'var(--status-pending)' };
  }
  return { label: 'PENDING', color: 'var(--status-idle)' };
}

export function StatusBadge({ status, className = '', showText = true }: StatusBadgeProps) {
  const { label, color } = getBadgeConfig(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border border-[var(--border)] rounded-[2px] bg-[var(--card)] text-[var(--foreground)] font-mono text-[11px] uppercase tracking-wider select-none ${className}`}
      style={{
        borderWidth: '1px',
        borderColor: 'var(--border)',
        borderRadius: '2px',
        color: 'var(--foreground)',
      }}
    >
      <span
        className="w-[8px] h-[8px] shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {showText && <span>{label}</span>}
    </span>
  );
}

export default StatusBadge;
