import 'server-only';

export interface GitHubRepoStats {
  stars: number;
  openIssues: number;
  totalCommits: number;
  contributors: number;
  primaryLanguage: string | null;
}

function parseLastPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  // Match rel="last" in Link header: <https://api.github.com/...page=123>; rel="last"
  const match = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/i);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchGitHub(url: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cicd-pipeline-tracker',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('GitHub API request timed out after 10 seconds');
    }
    throw new Error(
      `GitHub API network error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (res.status === 404) {
    throw new Error('Repository not found on GitHub');
  }

  if (res.status === 403 || res.status === 429) {
    const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
    throw new Error(
      `GitHub API rate limit exceeded (status ${res.status}${
        rateLimitRemaining !== null ? `, remaining: ${rateLimitRemaining}` : ''
      })`
    );
  }

  if (!res.ok) {
    throw new Error(`GitHub API error: HTTP ${res.status} ${res.statusText}`);
  }

  return res;
}

export async function fetchRepoStats(owner: string, repo: string): Promise<GitHubRepoStats> {
  // 1. Stars, open issues, and primary language from GET /repos/{owner}/{repo}
  const repoRes = await fetchGitHub(`https://api.github.com/repos/${owner}/${repo}`);
  const repoData = await repoRes.json();

  const stars: number = repoData.stargazers_count ?? 0;
  const openIssues: number = repoData.open_issues_count ?? 0;
  const primaryLanguage: string | null = repoData.language ?? null;

  // 2. Commits count from GET /repos/{owner}/{repo}/commits?per_page=1
  const commitsRes = await fetchGitHub(
    `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`
  );
  const commitsLink = commitsRes.headers.get('link');
  const commitsLastPage = parseLastPage(commitsLink);
  const commitsData = await commitsRes.json();
  const totalCommits =
    commitsLastPage ?? (Array.isArray(commitsData) ? commitsData.length : 0);

  // 3. Contributors count from GET /repos/{owner}/{repo}/contributors?per_page=1&anon=1
  const contribRes = await fetchGitHub(
    `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=1`
  );
  const contribLink = contribRes.headers.get('link');
  const contribLastPage = parseLastPage(contribLink);
  const contribData = await contribRes.json();
  const contributors =
    contribLastPage ?? (Array.isArray(contribData) ? contribData.length : 0);

  return {
    stars,
    openIssues,
    totalCommits,
    contributors,
    primaryLanguage,
  };
}

export function cleanJobLog(rawLogs: string): string {
  // 1. Strip ANSI colour codes
  const ansiRegex =
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  const noAnsi = rawLogs.replace(ansiRegex, '');

  // 2. Keep only the last 150 lines
  const lines = noAnsi.split(/\r?\n/);
  const last150 = lines.slice(-150);

  // 3. Strip leading timestamps: e.g. "2026-10-25T12:34:56.7890123Z " or "[2026-10-25 12:34:56] "
  const timestampRegex =
    /^\[?\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/;

  // 4. Mask anything that looks like a token (ghp_, github_pat_, Bearer values)
  const cleaned = last150.map((line) => {
    return line
      .replace(timestampRegex, '')
      .replace(/(Bearer\s+)["']?\S+?["']?(?=[\s,;]|"|'|$)/gi, '$1***')
      .replace(/ghp_[A-Za-z0-9_-]+/g, '***')
      .replace(/github_pat_[A-Za-z0-9_-]+/g, '***');
  });

  return cleaned.join('\n');
}

export async function fetchFailedJobLog(
  owner: string,
  repo: string,
  runId: string | number
): Promise<string | null> {
  try {
    // Read GITHUB_TOKEN inside the function, never at module load
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cicd-pipeline-tracker',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // 1. Call GET /repos/{owner}/{repo}/actions/runs/{runId}/jobs
      const jobsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
        {
          headers,
          signal: controller.signal,
        }
      );

      if (!jobsRes.ok) {
        return null;
      }

      const jobsData = (await jobsRes.json()) as {
        jobs?: Array<{
          id: number;
          conclusion: string | null;
        }>;
      };

      if (!jobsData.jobs || !Array.isArray(jobsData.jobs)) {
        return null;
      }

      // Pick the first job whose conclusion is failure or timed_out
      const failedJob = jobsData.jobs.find((job) => {
        const conc = job.conclusion?.toLowerCase();
        return conc === 'failure' || conc === 'timed_out';
      });

      if (!failedJob) {
        return null;
      }

      // 2. Call GET /repos/{owner}/{repo}/actions/jobs/{jobId}/logs (it redirects, follow it)
      const logsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${failedJob.id}/logs`,
        {
          headers,
          signal: controller.signal,
          redirect: 'follow',
        }
      );

      if (!logsRes.ok) {
        return null;
      }

      const rawLogs = await logsRes.text();
      if (!rawLogs) {
        return null;
      }

      const cleaned = cleanJobLog(rawLogs);
      return cleaned.trim() ? cleaned : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Return null on any error; never throw
    return null;
  }
}
