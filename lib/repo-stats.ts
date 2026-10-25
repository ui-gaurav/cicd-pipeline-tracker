import { prisma } from '@/lib/prisma';
import { mapStatusCategory } from '@/lib/status';

export interface RecentRunItem {
  id: string;
  status: string;
  sha: string;
  author: string;
  environment: string;
  timestamp: string;
}

export interface RepoDetailData {
  repository: {
    id: string;
    name: string;
    owner: string;
  };
  totalRuns: number;
  passed: number;
  failed: number;
  successRate: number; // Rounded to whole percent (0 - 100)
  recentRuns: RecentRunItem[];
  stats: {
    totalCommits: number;
    contributors: number;
    stars: number;
    openIssues: number;
    primaryLanguage: string | null;
    lastSyncedAt: string | null;
  } | null;
}

export async function getRepoDetailStats(repoId: string): Promise<RepoDetailData | null> {
  const repository = await prisma.repository.findUnique({
    where: { id: repoId },
    include: { stats: true },
  });

  if (!repository) {
    return null;
  }

  // Use groupBy on status where runId IS NOT NULL (no per-row queries)
  const statusGroups = await prisma.deployment.groupBy({
    by: ['status'],
    where: {
      repositoryId: repository.id,
      runId: { not: null },
    },
    _count: {
      _all: true,
    },
  });

  let totalRuns = 0;
  let passed = 0;
  let failed = 0;

  for (const group of statusGroups) {
    const count = group._count._all;
    totalRuns += count;
    const cat = mapStatusCategory(group.status);
    if (cat === 'passing') {
      passed += count;
    } else if (cat === 'failing') {
      failed += count;
    }
  }

  const successRate = totalRuns > 0 ? Math.round((passed / totalRuns) * 100) : 0;

  // Last 10 runs (status, sha, author, environment, timestamp)
  const lastRuns = await prisma.deployment.findMany({
    where: {
      repositoryId: repository.id,
      runId: { not: null },
    },
    orderBy: { timestamp: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      commitSha: true,
      commitAuthor: true,
      environment: true,
      timestamp: true,
    },
  });

  const recentRuns: RecentRunItem[] = lastRuns.map((r) => ({
    id: r.id,
    status: r.status,
    sha: r.commitSha,
    author: r.commitAuthor,
    environment: r.environment,
    timestamp: r.timestamp.toISOString(),
  }));

  const stats = repository.stats
    ? {
        totalCommits: repository.stats.totalCommits,
        contributors: repository.stats.contributors,
        stars: repository.stats.stars,
        openIssues: repository.stats.openIssues,
        primaryLanguage: repository.stats.primaryLanguage,
        lastSyncedAt: repository.stats.lastSyncedAt
          ? repository.stats.lastSyncedAt.toISOString()
          : null,
      }
    : null;

  return {
    repository: {
      id: repository.id,
      name: repository.name,
      owner: repository.owner,
    },
    totalRuns,
    passed,
    failed,
    successRate,
    recentRuns,
    stats,
  };
}
