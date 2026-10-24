'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  const interval = setInterval(callback, 15000);
  return () => clearInterval(interval);
}

function getSnapshot(dateInput: string | Date | number): string {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  const now = Date.now();
  const diffInSeconds = Math.floor((now - date.getTime()) / 1000);

  if (isNaN(diffInSeconds)) return '';
  if (diffInSeconds < 10) return 'Just now';
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;

  const minutes = Math.floor(diffInSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

interface RelativeTimeProps {
  date: string | Date;
  className?: string;
}

export function RelativeTime({ date, className = '' }: RelativeTimeProps) {
  const formatted = useSyncExternalStore(
    subscribe,
    () => getSnapshot(date),
    () => '' // SSR fallback to avoid hydration mismatches
  );

  if (!formatted) {
    return <span className={`inline-block opacity-0 ${className}`}>--</span>;
  }

  const fullDate = new Date(date).toLocaleString();

  return (
    <time dateTime={new Date(date).toISOString()} title={fullDate} className={className}>
      {formatted}
    </time>
  );
}

export default RelativeTime;
