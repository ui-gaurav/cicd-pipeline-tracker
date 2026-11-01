import { normalizeStatus, isStale } from '@/lib/status';
import type { RepositoryDeployments, DeploymentItem } from '@/types/deployments';

export interface KpiResult {
  runs24h: number;
  reposPassing: string;
  runningNow: number;
  passingReposCount: number;
  finishedReposCount: number;
}

/**
 * Pure function to compute KPI strip metrics from SWR deployment data.
 * No React or server imports.
 *
 * Metrics:
 * - "Runs in last 24h (recent)": runs with timestamp in the last 24 hours.
 * - "Repos passing": "N of M", where M counts repositories whose latest run
 *   is a finished run (pass or fail) and N those whose latest finished run is pass.
 *   Repositories with no finished run are excluded.
 * - "Running now": runs whose normalizeStatus is 'active' and that are not stale.
 *
 * Tab rule:
 * - A repository with no runs appears only under 'ALL'.
 * - Under 'STAGING' or 'PRODUCTION', a repository appears only if it has a run in that environment.
 */
export function computeKpis(
  data: RepositoryDeployments[] | null | undefined,
  nowMs: number,
  environment: 'ALL' | 'STAGING' | 'PRODUCTION' | string = 'ALL'
): KpiResult {
  const env = (environment || 'ALL').toUpperCase();

  if (!data || !Array.isArray(data) || data.length === 0) {
    return {
      runs24h: 0,
      reposPassing: '0 of 0',
      runningNow: 0,
      passingReposCount: 0,
      finishedReposCount: 0,
    };
  }

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  let runs24h = 0;
  let runningNow = 0;
  let finishedReposCount = 0;
  let passingReposCount = 0;

  for (const repo of data) {
    // 1. Collect all runs for this repository
    const allRepoRunsMap = new Map<string, DeploymentItem>();

    if (repo.latestByEnvironment?.STAGING) {
      allRepoRunsMap.set(repo.latestByEnvironment.STAGING.id, repo.latestByEnvironment.STAGING);
    }
    if (repo.latestByEnvironment?.PRODUCTION) {
      allRepoRunsMap.set(repo.latestByEnvironment.PRODUCTION.id, repo.latestByEnvironment.PRODUCTION);
    }
    if (Array.isArray(repo.recentRuns)) {
      for (const r of repo.recentRuns) {
        if (r && r.id && !allRepoRunsMap.has(r.id)) {
          allRepoRunsMap.set(r.id, r);
        }
      }
    }

    const allRepoRuns = Array.from(allRepoRunsMap.values());

    // 2. Filter runs for the active environment tab
    const envRuns = allRepoRuns.filter((r) => {
      if (env === 'ALL') return true;
      return r.environment === env;
    });

    // 3. Tab rule: A repo appears only under ALL if it has no runs.
    // Under STAGING or PRODUCTION, it is hidden if it has no runs in that environment.
    if (env !== 'ALL' && envRuns.length === 0) {
      continue;
    }

    // 4. "Runs in last 24h" and "Running now"
    for (const r of envRuns) {
      const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0;
      if (ts > 0 && nowMs - ts <= TWENTY_FOUR_HOURS_MS && ts <= nowMs + 60000) {
        runs24h++;
      }

      const norm = normalizeStatus(r.status);
      if (norm === 'active') {
        const stale = isStale(r.status, ts, nowMs);
        if (!stale) {
          runningNow++;
        }
      }
    }

    // 5. "Repos passing":
    // Find this repo's latest finished run in this environment.
    // Sort envRuns by timestamp descending to find the latest finished run.
    const finishedRuns = envRuns
      .filter((r) => {
        const norm = normalizeStatus(r.status);
        return norm === 'pass' || norm === 'fail';
      })
      .sort((a, b) => {
        const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tB - tA;
      });

    if (finishedRuns.length > 0) {
      const latestFinished = finishedRuns[0];
      finishedReposCount++;
      if (normalizeStatus(latestFinished.status) === 'pass') {
        passingReposCount++;
      }
    }
  }

  return {
    runs24h,
    reposPassing: `${passingReposCount} of ${finishedReposCount}`,
    runningNow,
    passingReposCount,
    finishedReposCount,
  };
}

