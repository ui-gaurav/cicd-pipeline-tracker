import { NextRequest, NextResponse, after } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { validateRepoOwnerAndName } from '@/lib/repo-validation';
import {
  getRepoInfo,
  listRecentRuns,
  fetchFailureDetails,
  GitHubNotFoundError,
  GitHubForbiddenError,
  GitHubRateLimitError,
} from '@/lib/github-api';
import { formatFailureLog } from '@/lib/failure-log';
import { upsertRun, deriveStatus } from '@/lib/deployments-sync';

export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Repos read access granted (GET).',
  });
}

export async function handleAddRepository(
  body: { owner?: unknown; repo?: unknown },
  options?: {
    userRole?: string;
    fetchImpl?: typeof fetch;
  }
) {
  const role = options?.userRole;
  if (role !== 'ADMIN') {
    return {
      status: 403,
      body: { error: 'Forbidden' },
    };
  }

  const { owner, repo } = body;
  const validation = validateRepoOwnerAndName(owner, repo);
  if (!validation.valid || !validation.owner || !validation.repo) {
    return {
      status: 400,
      body: { error: validation.error || 'Invalid owner or repository name' },
    };
  }

  const normOwner = validation.owner.toLowerCase();
  const normRepo = validation.repo.toLowerCase();

  // If already exists, return it without error and without counting it again
  const existingRepo = await prisma.repository.findUnique({
    where: {
      owner_name: {
        owner: normOwner,
        name: normRepo,
      },
    },
  });

  if (existingRepo) {
    return {
      status: 200,
      body: {
        repository: existingRepo,
        importedRuns: 0,
      },
    };
  }

  // Maximum 20 repositories in total
  const totalRepos = await prisma.repository.count();
  if (totalRepos >= 20) {
    return {
      status: 400,
      body: { error: 'Repository limit reached' },
    };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;

  // Call getRepoInfo and check accessibility / private / archived / disabled
  let repoInfo;
  try {
    repoInfo = await getRepoInfo(normOwner, normRepo, fetchImpl);
  } catch (err: unknown) {
    if (err instanceof GitHubNotFoundError || err instanceof GitHubForbiddenError) {
      return {
        status: 404,
        body: { error: 'Repository not found or not accessible' },
      };
    }
    if (err instanceof GitHubRateLimitError) {
      return {
        status: 429,
        body: { error: 'Rate limited, try again later' },
      };
    }
    return {
      status: 502,
      body: { error: 'Repository not found or not accessible' },
    };
  }

  if (repoInfo.private && process.env.ALLOW_PRIVATE_REPOS !== '1') {
    return {
      status: 400,
      body: { error: "Private repositories can't be tracked" },
    };
  }

  if (repoInfo.archived || repoInfo.disabled) {
    return {
      status: 400,
      body: { error: 'Repository is archived or disabled' },
    };
  }

  const now = new Date();
  const repository = await prisma.repository.upsert({
    where: {
      owner_name: {
        owner: normOwner,
        name: normRepo,
      },
    },
    update: {
      lastRefreshedAt: now,
    },
    create: {
      owner: normOwner,
      name: normRepo,
      lastRefreshedAt: now,
    },
  });

  let runs: Awaited<ReturnType<typeof listRecentRuns>> = [];
  try {
    runs = await listRecentRuns(normOwner, normRepo, 20, fetchImpl);
  } catch (err: unknown) {
    console.error(`[repos] Failed to list recent runs for ${normOwner}/${normRepo}:`, err);
  }

  let importedRuns = 0;
  for (const run of runs) {
    const res = await upsertRun(repository.id, run);
    if (res) importedRuns++;
  }

  const failedRuns = runs
    .filter((r) => {
      const s = deriveStatus(r.status, r.conclusion);
      return s === 'FAILURE' || s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT';
    })
    .slice(0, 3);

  return {
    status: 200,
    body: {
      repository,
      importedRuns,
    },
    afterWork: async () => {
      if (failedRuns.length === 0) return;
      const deadline = Date.now() + 40000;
      for (const run of failedRuns) {
        if (Date.now() >= deadline) break;
        try {
          const details = await fetchFailureDetails(normOwner, normRepo, run.id, fetchImpl);
          if (details) {
            const formatted = formatFailureLog(details);
            await upsertRun(repository.id, run, { logs: formatted });
          }
        } catch (err) {
          console.error(`[repos] Failed to fetch failure details for run ${run.id}:`, err);
        }
      }
    },
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = await handleAddRepository(body, {
    userRole: session.user.role,
  });

  if (result.afterWork) {
    after(result.afterWork);
  }

  return NextResponse.json(result.body, { status: result.status });
}
