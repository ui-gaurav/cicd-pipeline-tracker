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
