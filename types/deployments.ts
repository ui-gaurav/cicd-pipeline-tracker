export interface DeploymentItem {
  id: string;
  runId: string;
  deliveryId: string | null;
  commitSha: string;
  commitAuthor: string;
  branch: string;
  environment: 'STAGING' | 'PRODUCTION';
  status: string;
  timestamp: string;
  repositoryId: string;
  hasLogs: boolean;
}

export interface RepositoryDeployments {
  id: string;
  name: string;
  owner: string;
  latestByEnvironment: {
    STAGING: DeploymentItem | null;
    PRODUCTION: DeploymentItem | null;
  };
  latest: {
    STAGING: DeploymentItem | null;
    PRODUCTION: DeploymentItem | null;
  };
  recentRuns: DeploymentItem[];
}
