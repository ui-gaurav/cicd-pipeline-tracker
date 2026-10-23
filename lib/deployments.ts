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

  const where: Prisma.DeploymentWhereInput = {
    runId: { not: null },
  };

  if (repo) {
    if (repo.includes('/')) {
      const [owner, name] = repo.split('/');
      where.repository = { owner, name };
    } else {
      where.repository = {
        OR: [
          { name: { equals: repo, mode: 'insensitive' } },
          { id: repo },
        ],
      };
    }
  }

  if (environment) {
    where.environment = environment;
  }

  if (status) {
    const s = status.toUpperCase();
    if (s === 'PASSING') {
      where.status = 'SUCCESS';
    } else if (s === 'FAILING') {
      where.status = { in: ['FAILED', 'FAILURE', 'CANCELLED', 'TIMED_OUT'] };
    } else if (s === 'PENDING') {
      where.status = { in: ['PENDING', 'RUNNING'] };
    } else {
      where.status = s;
    }
  }

  // Query 1: Latest run per repository and environment using distinct
  const latestRuns = await prisma.deployment.findMany({
    where,
    distinct: ['repositoryId', 'environment'],
    orderBy: { timestamp: 'desc' },
    include: { repository: true },
  });

  const repoIds = Array.from(new Set(latestRuns.map((r) => r.repositoryId)));

  // Query 2: Recent runs grouped in memory (at most 20 per repository)
  const recentRuns = repoIds.length > 0 ? await prisma.deployment.findMany({
    where: {
      ...where,
      repositoryId: { in: repoIds },
    },
    orderBy: { timestamp: 'desc' },
    take: repoIds.length * 20,
  }) : [];

  const reposMap = new Map<string, RepositoryDeployments>();

  for (const run of latestRuns) {
    if (!reposMap.has(run.repositoryId)) {
      reposMap.set(run.repositoryId, {
        id: run.repository.id,
        name: run.repository.name,
        owner: run.repository.owner,
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
    const repoObj = reposMap.get(run.repositoryId)!;
    const item: DeploymentItem = {
      id: run.id,
      runId: run.runId!,
      deliveryId: run.deliveryId,
      commitSha: run.commitSha,
      commitAuthor: run.commitAuthor,
      branch: run.branch,
      environment: run.environment as 'STAGING' | 'PRODUCTION',
      status: run.status,
      timestamp: run.timestamp.toISOString(),
      repositoryId: run.repositoryId,
      hasLogs: run.logs != null && run.logs !== '',
    };
    repoObj.latestByEnvironment[run.environment as 'STAGING' | 'PRODUCTION'] = item;
    repoObj.latest[run.environment as 'STAGING' | 'PRODUCTION'] = item;
  }

  for (const run of recentRuns) {
    const repoObj = reposMap.get(run.repositoryId);
    if (repoObj && repoObj.recentRuns.length < 20) {
      repoObj.recentRuns.push({
        id: run.id,
        runId: run.runId!,
        deliveryId: run.deliveryId,
        commitSha: run.commitSha,
        commitAuthor: run.commitAuthor,
        branch: run.branch,
        environment: run.environment as 'STAGING' | 'PRODUCTION',
        status: run.status,
        timestamp: run.timestamp.toISOString(),
        repositoryId: run.repositoryId,
        hasLogs: run.logs != null && run.logs !== '',
      });
    }
  }

  return Array.from(reposMap.values());
}
