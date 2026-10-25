import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { fetchRepoStats } from '@/lib/github-api';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repo: string }> }
) {
  // Re-check session.user.role inside handler (401 with no session, 403 for non-admins)
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { repo: repoId } = await params;

  // Look up the repository
  const repository = await prisma.repository.findUnique({
    where: { id: repoId },
    include: { stats: true },
  });

  if (!repository) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
  }

  // Return 429 if lastSyncedAt is less than 60 seconds ago
  if (repository.stats?.lastSyncedAt) {
    const elapsedMs = Date.now() - new Date(repository.stats.lastSyncedAt).getTime();
    if (elapsedMs < 60_000) {
      const waitSeconds = Math.ceil((60_000 - elapsedMs) / 1000);
      return NextResponse.json(
        { error: `Sync rate limit exceeded. Try again in ${waitSeconds}s.` },
        { status: 429 }
      );
    }
  }

  try {
    const ghStats = await fetchRepoStats(repository.owner, repository.name);
    const now = new Date();

    const updatedStats = await prisma.repoStats.upsert({
      where: { repositoryId: repository.id },
      create: {
        repositoryId: repository.id,
        totalCommits: ghStats.totalCommits,
        contributors: ghStats.contributors,
        primaryLanguage: ghStats.primaryLanguage,
        stars: ghStats.stars,
        openIssues: ghStats.openIssues,
        lastSyncedAt: now,
      },
      update: {
        totalCommits: ghStats.totalCommits,
        contributors: ghStats.contributors,
        primaryLanguage: ghStats.primaryLanguage,
        stars: ghStats.stars,
        openIssues: ghStats.openIssues,
        lastSyncedAt: now,
      },
    });

    return NextResponse.json(updatedStats);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Repository not found on GitHub') ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
