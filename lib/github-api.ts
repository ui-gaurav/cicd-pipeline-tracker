import 'server-only';

export interface GitHubRepoStats {
  stars: number;
  openIssues: number;
  totalCommits: number;
  contributors: number;
  primaryLanguage: string | null;
}

export interface FailureDetails {
  jobName: string;
  stepName: string;
  annotations: string[];
  reasonLines: string[];
  logTail: string;
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

/**
 * Sanitizes raw log text by:
 * 1. Normalising CRLF to LF
 * 2. Stripping ANSI colour codes
 * 3. Stripping leading timestamps
 * 4. Masking tokens (ghp_, gho_, ghs_, ghu_, ghr_, github_pat_, Bearer values)
 */
export function sanitizeLogLines(rawLogs: string): string[] {
  const normLogs = rawLogs.replace(/\r\n/g, '\n');
  const ansiRegex =
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  const noAnsi = normLogs.replace(ansiRegex, '');

  const lines = noAnsi.split('\n');

  const timestampRegex =
    /^\[?\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/;
  const tokenRegex =
    /(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/g;
  const bearerRegex =
    /(Bearer\s+)["']?\S+?["']?(?=[\s,;]|"|'|$)/gi;

  return lines.map((line) => {
    return line
      .replace(timestampRegex, '')
      .replace(bearerRegex, '$1***')
      .replace(tokenRegex, '***');
  });
}

export function cleanJobLog(rawLogs: string): string {
  const cleanedLines = sanitizeLogLines(rawLogs);
  return cleanedLines.slice(-150).join('\n');
}

/**
 * Fetches failure details for a GitHub Actions workflow run.
 *
 * Rules:
 * - Read GITHUB_TOKEN inside the function
 * - Each request has 10s timeout, entire function has 20s deadline
 * - Optional 4th parameter fetchImpl defaults to global fetch
 * - Never throw (returns null on error)
 * - GET /repos/{owner}/{repo}/actions/runs/{runId}/jobs
 * - Parallel GET annotations and GET logs
 */
export async function fetchFailureDetails(
  owner: string,
  repo: string,
  runId: string | number,
  fetchImpl: typeof fetch = fetch
): Promise<FailureDetails | null> {
  try {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cicd-pipeline-tracker',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const overallSignal = AbortSignal.timeout(20000);
    const makeRequestSignal = () => AbortSignal.any([overallSignal, AbortSignal.timeout(10000)]);

    // 1. GET /repos/{owner}/{repo}/actions/runs/{runId}/jobs
    const jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
    const jobsRes = await fetchImpl(jobsUrl, {
      headers,
      signal: makeRequestSignal(),
    });

    if (!jobsRes.ok) {
      return null;
    }

    const jobsData = (await jobsRes.json()) as {
      jobs?: Array<{
        id: number;
        name?: string;
        conclusion: string | null;
        steps?: Array<{
          name?: string;
          conclusion: string | null;
        }>;
      }>;
    };

    if (!jobsData.jobs || !Array.isArray(jobsData.jobs)) {
      return null;
    }

    // First job with conclusion failure or timed_out
    const failedJob = jobsData.jobs.find((job) => {
      const conc = job.conclusion?.toLowerCase();
      return conc === 'failure' || conc === 'timed_out';
    });

    if (!failedJob) {
      return null;
    }

    const jobName = failedJob.name || 'unknown job';
    const failedStep = failedJob.steps?.find(
      (s) => s.conclusion?.toLowerCase() === 'failure'
    );
    const stepName = failedStep?.name || 'unknown step';
    const jobId = failedJob.id;

    // Run annotations and log requests in parallel
    const annotationsUrl = `https://api.github.com/repos/${owner}/${repo}/check-runs/${jobId}/annotations`;
    const logsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;

    const [annotationsRes, logsRes] = await Promise.all([
      fetchImpl(annotationsUrl, {
        headers,
        signal: makeRequestSignal(),
      }).catch(() => null),
      fetchImpl(logsUrl, {
        headers,
        signal: makeRequestSignal(),
        redirect: 'follow',
      }).catch(() => null),
    ]);

    // Parse annotations: up to 5 as "path:line message", skipping generic exit code message when others exist.
    // On 403, 404, or failure continue without annotations.
    let annotations: string[] = [];
    if (annotationsRes && annotationsRes.ok) {
      try {
        const rawAnnotations = (await annotationsRes.json()) as Array<{
          path?: string;
          start_line?: number;
          end_line?: number;
          message?: string;
        }>;
        if (Array.isArray(rawAnnotations)) {
          const isGeneric = (msg: string) =>
            /Process completed with exit code \d+/i.test(msg);
          const nonGeneric = rawAnnotations.filter((a) => !isGeneric(a.message || ''));
          const chosen = (nonGeneric.length > 0 ? nonGeneric : rawAnnotations).slice(0, 5);
          annotations = chosen.map((a) => {
            const line = a.start_line ?? a.end_line ?? 1;
            const path = a.path || 'unknown';
            const msg = a.message ? ` ${a.message.trim()}` : '';
            return `${path}:${line}${msg}`.trim();
          });
        }
      } catch {
        annotations = [];
      }
    }

    // Parse logs
    if (!logsRes || !logsRes.ok) {
      return null;
    }

    const rawLogs = await logsRes.text();
    if (!rawLogs) {
      return null;
    }

    const cleanedLines = sanitizeLogLines(rawLogs);
    const tailLines = cleanedLines.slice(-150);
    const logTail = tailLines.join('\n');

    // Isolate failed step's section between its ##[group] markers when possible
    let candidateLines = tailLines;
    if (stepName !== 'unknown step') {
      const stepLower = stepName.toLowerCase();
      const groupStartIdx = cleanedLines.findIndex(
        (l) => l.startsWith('##[group]') && l.toLowerCase().includes(stepLower)
      );
      if (groupStartIdx !== -1) {
        let groupEndIdx = cleanedLines.findIndex(
          (l, idx) =>
            idx > groupStartIdx &&
            (l.startsWith('##[group]') || l.startsWith('##[endgroup]'))
        );
        if (groupEndIdx === -1) {
          groupEndIdx = cleanedLines.length;
        }
        const isolated = cleanedLines.slice(groupStartIdx + 1, groupEndIdx);
        if (isolated.length > 0) {
          candidateLines = isolated;
        }
      }
    }

    // Extract reasonLines:
    // lines starting with "##[error]" first (prefix removed),
    // then lines matching /error|failed|exit code|cannot find|not assignable/i,
    // up to 8 in total, deduplicated, in order.
    // If there are none, use the annotations.
    const reasonLines: string[] = [];
    const seen = new Set<string>();

    for (const line of candidateLines) {
      if (line.startsWith('##[error]')) {
        const text = line.slice('##[error]'.length).trim();
        if (text && !seen.has(text)) {
          seen.add(text);
          reasonLines.push(text);
          if (reasonLines.length >= 8) break;
        }
      }
    }

    if (reasonLines.length < 8) {
      const errorRegex = /error|failed|exit code|cannot find|not assignable/i;
      for (const line of candidateLines) {
        const text = line.startsWith('##[error]')
          ? line.slice('##[error]'.length).trim()
          : line.trim();
        if (text && errorRegex.test(text) && !seen.has(text)) {
          seen.add(text);
          reasonLines.push(text);
          if (reasonLines.length >= 8) break;
        }
      }
    }

    if (reasonLines.length === 0 && annotations.length > 0) {
      for (const ann of annotations) {
        if (!seen.has(ann)) {
          seen.add(ann);
          reasonLines.push(ann);
          if (reasonLines.length >= 8) break;
        }
      }
    }

    return {
      jobName,
      stepName,
      annotations,
      reasonLines,
      logTail,
    };
  } catch {
    return null;
  }
}

export async function fetchFailedJobLog(
  owner: string,
  repo: string,
  runId: string | number
): Promise<string | null> {
  const details = await fetchFailureDetails(owner, repo, runId);
  return details ? details.logTail : null;
}
