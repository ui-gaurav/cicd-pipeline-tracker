import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { RepositoryDeployments, DeploymentItem } from '@/types/deployments';

export interface QueryDeploymentsOptions {
  repo?: string | null;
  environment?: 'STAGING' | 'PRODUCTION' | null;
  status?: string | null;
}

export async function getDeploymentsData(options: QueryDeploymentsOptions = {}): Promise<RepositoryDeployments[]> {
  const { repo, environment, status } = options;

  // 1. Base query on repositories
  const repoWhere: Prisma.RepositoryWhereInput = {};

  if (repo) {
    if (repo.includes('/')) {
      const [owner, name] = repo.split('/');
      repoWhere.owner = owner;
      repoWhere.name = name;
    } else {
      repoWhere.OR = [
        { name: { equals: repo, mode: 'insensitive' } },
        { id: repo },
      ];
    }
  }

  // Query 1: Fetch all matching repositories
  const repositories = await prisma.repository.findMany({
    where: repoWhere,
    orderBy: { name: 'asc' },
  });

  if (repositories.length === 0) {
    return [];
  }

  const repoIds = repositories.map((r) => r.id);

  // 2. Build deployment filters: runId must not be null (push rows are never runs)
  const deploymentWhere: Prisma.DeploymentWhereInput = {
    repositoryId: { in: repoIds },
    runId: { not: null },
  };

  if (environment) {
    deploymentWhere.environment = environment;
  }

  if (status) {
    const s = status.toUpperCase();
    if (s === 'PASSING') {
      deploymentWhere.status = 'SUCCESS';
    } else if (s === 'FAILING') {
      deploymentWhere.status = { in: ['FAILED', 'FAILURE', 'CANCELLED', 'TIMED_OUT'] };
    } else if (s === 'PENDING') {
      deploymentWhere.status = { in: ['PENDING', 'RUNNING'] };
    } else {
      deploymentWhere.status = s;
    }
  }

  // Query 2: Fetch runs for all target repositories in a single query
  const runs = await prisma.deployment.findMany({
    where: deploymentWhere,
    orderBy: { timestamp: 'desc' },
    select: {
      id: true,
      runId: true,
      deliveryId: true,
      commitSha: true,
      commitAuthor: true,
      branch: true,
      environment: true,
      status: true,
      timestamp: true,
      repositoryId: true,
      logs: true,
    },
  });

  // 3. Group runs in memory per repository
  const reposMap = new Map<string, RepositoryDeployments>();

  for (const r of repositories) {
    reposMap.set(r.id, {
      id: r.id,
      name: r.name,
      owner: r.owner,
      createdAt: r.createdAt.toISOString(),
      latestByEnvironment: {
        STAGING: null,
        PRODUCTION: null,
      },
      latest: {
        STAGING: null,
        PRODUCTION: null,
      },
      recentRuns: [],
    });
  }

  for (const run of runs) {
    const repoObj = reposMap.get(run.repositoryId);
    if (!repoObj) continue;

    const env = run.environment as 'STAGING' | 'PRODUCTION';
    const item: DeploymentItem = {
      id: run.id,
      runId: run.runId!,
      deliveryId: run.deliveryId,
      commitSha: run.commitSha,
      commitAuthor: run.commitAuthor,
      branch: run.branch,
      environment: env,
      status: run.status,
      timestamp: run.timestamp.toISOString(),
      repositoryId: run.repositoryId,
      hasLogs: run.logs != null && run.logs !== '',
    };

    // Because runs are sorted by timestamp desc, first encountered per environment is the latest
    if (!repoObj.latestByEnvironment[env]) {
      repoObj.latestByEnvironment[env] = item;
      repoObj.latest[env] = item;
    }

    // Keep at most the last 20 runs per repository
    if (repoObj.recentRuns.length < 20) {
      repoObj.recentRuns.push(item);
    }
  }

  // 4. Filters:
  // - With no environment or status filter: include every repository (idle repos appear).
  // - When environment or status filters are set: include only repositories with at least one matching run.
  // - (A repo filter narrows to that repository whether idle or not, handled above when no env/status filter).
  const hasEnvOrStatusFilter = Boolean(environment || status);
  let results = Array.from(reposMap.values());

  if (hasEnvOrStatusFilter) {
    results = results.filter((repo) => repo.recentRuns.length > 0);
  }

  // 5. Sorting:
  // - Repositories by latest run timestamp descending
  // - Idle repositories after active ones, sorted by name ascending
  results.sort((a, b) => {
    const aLatest = a.recentRuns.length > 0 ? new Date(a.recentRuns[0].timestamp).getTime() : null;
    const bLatest = b.recentRuns.length > 0 ? new Date(b.recentRuns[0].timestamp).getTime() : null;

    if (aLatest !== null && bLatest !== null) {
      if (bLatest !== aLatest) {
        return bLatest - aLatest;
      }
      return a.name.localeCompare(b.name);
    }

    if (aLatest !== null && bLatest === null) return -1;
    if (aLatest === null && bLatest !== null) return 1;

    // Both idle
    return a.name.localeCompare(b.name);
  });

  return results;
}
