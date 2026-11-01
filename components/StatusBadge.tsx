import React from 'react';
import { normalizeStatus, isStale, statusLabel, statusTone } from '@/lib/status';

export interface StatusBadgeProps {
  status: string | null | undefined;
  timestamp?: string | number | Date | null;
  nowMs?: number;
  stale?: boolean;
  className?: string;
  showText?: boolean;
}

const TONE_BG: Record<string, string> = {
  pass: 'bg-status-pass',
  fail: 'bg-status-fail',
  pending: 'bg-status-pending',
  idle: 'bg-status-idle',
};

export function StatusBadge({
  status,
  timestamp,
  nowMs,
  stale,
  className = '',
  showText = true,
}: StatusBadgeProps) {
  const norm = normalizeStatus(status);
  const tsMs = timestamp ? new Date(timestamp).getTime() : 0;
  const isStaleRun =
    stale !== undefined ? stale : tsMs > 0 && nowMs ? isStale(status, tsMs, nowMs) : false;

  const label = statusLabel(status, isStaleRun);
  const tone = statusTone(status, isStaleRun);
  const shouldPulse = norm === 'active' && !isStaleRun;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-[var(--radius)] bg-card text-foreground font-mono text-[11px] uppercase tracking-wider select-none ${className}`}
    >
      <span
        className={`w-2 h-2 shrink-0 ${TONE_BG[tone] || 'bg-status-idle'} ${
          shouldPulse ? 'animate-status-pulse' : ''
        }`}
        aria-hidden="true"
      />
      {showText && <span className="text-foreground">{label}</span>}
    </span>
  );
}

export default StatusBadge;
