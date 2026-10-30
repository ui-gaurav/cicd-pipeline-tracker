import { NextRequest, NextResponse, after } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { listRecentRuns, fetchFailureDetails } from '@/lib/github-api';
import { formatFailureLog } from '@/lib/failure-log';
import { upsertRun, deriveStatus } from '@/lib/deployments-sync';

export const maxDuration = 60;

export async function handleRefreshRepo(
  repoId: string,
  options?: {
    isLoggedIn?: boolean;
    fetchImpl?: typeof fetch;
  }
) {
  if (options?.isLoggedIn === false) {
    return {
      status: 401,
      body: { error: 'Unauthorized' },
    };
  }

  const now = new Date();
  const sixtySecsAgo = new Date(now.getTime() - 60_000);

  // Conditional update: only update if lastRefreshedAt is null or <= 60s ago
  // This guarantees that two concurrent callers cannot both proceed
  const updateResult = await prisma.repository.updateMany({
    where: {
      id: repoId,
      OR: [
        { lastRefreshedAt: null },
        { lastRefreshedAt: { lte: sixtySecsAgo } },
      ],
    },
    data: {
      lastRefreshedAt: now,
    },
  });

  if (updateResult.count === 0) {
    // Under 60 seconds old or repository does not exist
    const current = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { id: true, lastRefreshedAt: true },
    });

    if (!current) {
      return {
        status: 404,
        body: { error: 'Repository not found' },
      };
    }

    const elapsedMs = current.lastRefreshedAt
      ? Date.now() - new Date(current.lastRefreshedAt).getTime()
      : 0;
    const retryAfter = Math.max(1, Math.ceil((60_000 - elapsedMs) / 1000));
    return {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
      body: {
        error: `Rate limited. Try again in ${retryAfter}s.`,
        retryAfter,
      },
    };
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { id: true, owner: true, name: true },
  });

  if (!repository) {
    return {
      status: 404,
      body: { error: 'Repository not found' },
    };
  }

  const existingDeployments = await prisma.deployment.findMany({
    where: { repositoryId: repository.id },
    select: { runId: true, status: true, logs: true },
  });
  const existingMap = new Map(existingDeployments.map((d) => [d.runId, d]));

  const fetchImpl = options?.fetchImpl ?? fetch;

  let runs: Awaited<ReturnType<typeof listRecentRuns>> = [];
  try {
    runs = await listRecentRuns(repository.owner, repository.name, 20, fetchImpl);
  } catch (err: unknown) {
    console.error(`[refresh] Failed to list recent runs for ${repository.owner}/${repository.name}:`, err);
  }

  for (const run of runs) {
    await upsertRun(repository.id, run);
  }

  // Failure details only for new failed runs, at most 2, inside after() with 40s budget
  const newFailedRuns = runs
    .filter((r) => {
      const s = deriveStatus(r.status, r.conclusion);
      const isFail = s === 'FAILURE' || s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT';
      if (!isFail) return false;
      const existing = existingMap.get(String(r.id));
      if (!existing) return true; // new run
      const hadFetchedLogs = typeof existing.logs === 'string' && !existing.logs.startsWith('Workflow:');
      return !hadFetchedLogs; // previously didn't have fetched failure details
    })
    .slice(0, 2);

  return {
    status: 200,
    body: {
      success: true,
      refreshedRuns: runs.length,
    },
    afterWork: async () => {
      if (newFailedRuns.length === 0) return;
      const deadline = Date.now() + 40000;
      for (const run of newFailedRuns) {
        if (Date.now() >= deadline) break;
        try {
          const details = await fetchFailureDetails(repository.owner, repository.name, run.id, fetchImpl);
          if (details) {
            const formatted = formatFailureLog(details);
            await upsertRun(repository.id, run, { logs: formatted });
          }
        } catch (err) {
          console.error(`[refresh] Failed to fetch failure details for run ${run.id}:`, err);
        }
      }
    },
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repo: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { repo: repoId } = await params;

  const result = await handleRefreshRepo(repoId, {
    isLoggedIn: true,
  });

  if (result.afterWork) {
    after(result.afterWork);
  }

  const responseInit: ResponseInit = { status: result.status };
  if (result.headers) {
    responseInit.headers = result.headers;
  }

  return NextResponse.json(result.body, responseInit);
}
