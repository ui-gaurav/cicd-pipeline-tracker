export type StatusNorm = 'pass' | 'fail' | 'active' | 'idle';
export type StatusTone = 'pass' | 'fail' | 'pending' | 'idle';
export type StatusCategory = 'passing' | 'failing' | 'pending';

/**
 * Normalizes any GitHub or system status string into one of 4 canonical states:
 * - 'pass': SUCCESS, PASSED (case-insensitive)
 * - 'fail': FAILED, FAILURE, CANCELLED, TIMED_OUT (case-insensitive)
 * - 'active': PENDING, RUNNING, QUEUED, IN_PROGRESS (case-insensitive)
 * - 'idle': anything else, null, undefined
 */
export function normalizeStatus(raw: string | null | undefined): StatusNorm {
  if (!raw) return 'idle';
  const s = raw.trim().toUpperCase();
  if (s === 'SUCCESS' || s === 'PASSED') {
    return 'pass';
  }
  if (s === 'FAILED' || s === 'FAILURE' || s === 'CANCELLED' || s === 'TIMED_OUT') {
    return 'fail';
  }
  if (s === 'PENDING' || s === 'RUNNING' || s === 'QUEUED' || s === 'IN_PROGRESS') {
    return 'active';
  }
  return 'idle';
}

/**
 * Determines whether an active run has been in progress for longer than 6 hours.
 */
export function isStale(
  status: string | null | undefined,
  timestampMs: number,
  nowMs: number
): boolean {
  if (normalizeStatus(status) !== 'active') {
    return false;
  }
  if (!timestampMs || isNaN(timestampMs) || !nowMs || isNaN(nowMs)) {
    return false;
  }
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  return nowMs - timestampMs > SIX_HOURS_MS;
}

/**
 * Generates the uppercase display label for a status:
 * - stale gives STALE
 * - pass gives PASSED
 * - fail: stored FAILURE is displayed as FAILED; CANCELLED and TIMED_OUT are shown as stored
 * - active shows the stored status (PENDING or RUNNING, uppercased)
 * - idle gives IDLE
 */
export function statusLabel(raw: string | null | undefined, stale?: boolean): string {
  if (stale) {
    return 'STALE';
  }
  const norm = normalizeStatus(raw);
  const s = (raw ?? '').trim().toUpperCase();

  switch (norm) {
    case 'pass':
      return 'PASSED';
    case 'fail':
      if (s === 'CANCELLED') return 'CANCELLED';
      if (s === 'TIMED_OUT') return 'TIMED_OUT';
      return 'FAILED'; // Covers 'FAILURE', 'FAILED', or any other fail
    case 'active':
      if (s === 'RUNNING') return 'RUNNING';
      if (s === 'PENDING') return 'PENDING';
      if (s === 'QUEUED') return 'QUEUED';
      if (s === 'IN_PROGRESS') return 'IN_PROGRESS';
      return s || 'PENDING';
    case 'idle':
    default:
      return 'IDLE';
  }
}

/**
 * Maps a status and staleness to its color token tone:
 * - pass -> 'pass' (var(--status-pass))
 * - fail -> 'fail' (var(--status-fail))
 * - active -> 'pending' (var(--status-pending))
 * - idle and stale -> 'idle' (var(--status-idle))
 */
export function statusTone(raw: string | null | undefined, stale?: boolean): StatusTone {
  if (stale) {
    return 'idle';
  }
  const norm = normalizeStatus(raw);
  switch (norm) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'active':
      return 'pending';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * Helper to check if a status represents a failure.
 */
export function isFailingStatus(status: string | null | undefined): boolean {
  return normalizeStatus(status) === 'fail';
}

/**
 * Legacy category mapping for backward compatibility.
 */
export function mapStatusCategory(status: string | null | undefined): StatusCategory {
  const norm = normalizeStatus(status);
  if (norm === 'pass') return 'passing';
  if (norm === 'fail') return 'failing';
  return 'pending';
}
