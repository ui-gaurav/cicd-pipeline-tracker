import React from 'react';
import { mapStatusCategory, StatusCategory } from '@/lib/status';

export interface StatusBadgeProps {
  status: string;
  className?: string;
  showText?: boolean;
}

export function StatusBadge({ status, className = '', showText = true }: StatusBadgeProps) {
  const category: StatusCategory = mapStatusCategory(status);

  const styleConfig = {
    passing: {
      style: {
        backgroundColor: 'var(--status-passing-bg)',
        color: 'var(--status-passing-text)',
        borderColor: 'var(--status-passing-border)',
        borderWidth: 'var(--badge-border-width, 1px)',
        borderRadius: 'var(--badge-radius, 9999px)',
      },
      dotColor: 'var(--status-passing-dot)',
      label: status.toUpperCase() === 'SUCCESS' ? 'Passing' : status,
    },
    failing: {
      style: {
        backgroundColor: 'var(--status-failing-bg)',
        color: 'var(--status-failing-text)',
        borderColor: 'var(--status-failing-border)',
        borderWidth: 'var(--badge-border-width, 1px)',
        borderRadius: 'var(--badge-radius, 9999px)',
      },
      dotColor: 'var(--status-failing-dot)',
      label: ['FAILED', 'FAILURE'].includes(status.toUpperCase()) ? 'Failed' : status,
    },
    pending: {
      style: {
        backgroundColor: 'var(--status-pending-bg)',
        color: 'var(--status-pending-text)',
        borderColor: 'var(--status-pending-border)',
        borderWidth: 'var(--badge-border-width, 1px)',
        borderRadius: 'var(--badge-radius, 9999px)',
      },
      dotColor: 'var(--status-pending-dot)',
      label: status.toUpperCase() === 'RUNNING' ? 'Running' : 'Pending',
    },
  }[category];

  return (
    <span
      style={styleConfig.style}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider border select-none ${className}`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${category === 'pending' ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: styleConfig.dotColor }}
        aria-hidden="true"
      />
      {showText && <span>{styleConfig.label}</span>}
    </span>
  );
}

export default StatusBadge;
