export type StatusCategory = 'passing' | 'failing' | 'pending';

/**
 * Maps deployment status strings into 3 categories:
 * - SUCCESS = passing (green)
 * - FAILED, FAILURE, CANCELLED, TIMED_OUT = failing (red)
 * - PENDING, RUNNING = pending (amber)
 */
export function mapStatusCategory(status: string | null | undefined): StatusCategory {
  if (!status) return 'pending';
  const s = status.toUpperCase();
  if (s === 'SUCCESS') {
    return 'passing';
  }
  if (['FAILED', 'FAILURE', 'CANCELLED', 'TIMED_OUT'].includes(s)) {
    return 'failing';
  }
  return 'pending'; // PENDING, RUNNING, or other
}

export function isFailingStatus(status: string | null | undefined): boolean {
  return mapStatusCategory(status) === 'failing';
}
