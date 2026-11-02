import { prisma } from '../lib/prisma';
import { getDeploymentsData } from '../lib/deployments';
import type { Repository } from '@prisma/client';

let passedTests = 0;
let failedTests = 0;

function report(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

const FAKE_OWNER = 'test-owner';
const ZERO_REPO_NAME = 'deploy-test-zero';
const PUSH_REPO_NAME = 'deploy-test-push';
const STAGING_REPO_NAME = 'deploy-test-staging';
const PROD_REPO_NAME = 'deploy-test-prod';

async function main() {
  console.log('\n=== Deployments Data (Idle & Zero-Run Repositories) Tests ===\n');

  // Baseline row count check
  const reposBefore = await prisma.repository.count({
    where: { owner: { not: FAKE_OWNER } },
  });
  const deploymentsBefore = await prisma.deployment.count({
    where: { repository: { owner: { not: FAKE_OWNER } } },
  });
  console.log(`Baseline other repositories: ${reposBefore} repo(s), ${deploymentsBefore} deployment(s)`);

  // Ensure clean slate for test-owner
  await prisma.deployment.deleteMany({
    where: { repository: { owner: FAKE_OWNER } },
  });
  await prisma.repository.deleteMany({
    where: { owner: FAKE_OWNER },
  });

  let zeroRepo: Repository | undefined;
  let pushRepo: Repository | undefined;
  let stagingRepo: Repository | undefined;
  let prodRepo: Repository | undefined;

  try {
    const now = Date.now();

    // 1. Create fake repositories
    zeroRepo = await prisma.repository.create({
      data: {
        name: ZERO_REPO_NAME,
        owner: FAKE_OWNER,
      },
    });

    pushRepo = await prisma.repository.create({
      data: {
        name: PUSH_REPO_NAME,
        owner: FAKE_OWNER,
      },
    });

    stagingRepo = await prisma.repository.create({
      data: {
        name: STAGING_REPO_NAME,
        owner: FAKE_OWNER,
      },
    });

    prodRepo = await prisma.repository.create({
      data: {
        name: PROD_REPO_NAME,
        owner: FAKE_OWNER,
      },
    });

    if (!zeroRepo || !pushRepo || !stagingRepo || !prodRepo) {
      throw new Error('Failed to create test repositories');
    }

    const zeroId = zeroRepo.id;
    const pushId = pushRepo.id;
    const stagingId = stagingRepo.id;
    const prodId = prodRepo.id;

    // 2. Create deployments
    // Push-only row (runId is null)
    await prisma.deployment.create({
      data: {
        repositoryId: pushRepo.id,
        runId: null,
        branch: 'main',
        commitSha: 'sha-push-1234567',
        commitAuthor: 'pusher-bot',
        environment: 'STAGING',
        status: 'SUCCESS',
        timestamp: new Date(now - 3600000), // 60 mins ago
      },
    });

    // Staging run (30 mins ago, SUCCESS)
    await prisma.deployment.create({
      data: {
        repositoryId: stagingRepo.id,
        runId: 'run-staging-101',
        branch: 'main',
        commitSha: 'sha-staging-1234',
        commitAuthor: 'developer-alice',
        environment: 'STAGING',
        status: 'SUCCESS',
        timestamp: new Date(now - 1800000), // 30 mins ago
        logs: 'Workflow: CI\nStatus: completed\nConclusion: success',
      },
    });

    // Production run (15 mins ago, FAILURE)
    await prisma.deployment.create({
      data: {
        repositoryId: prodRepo.id,
        runId: 'run-prod-202',
        branch: 'main',
        commitSha: 'sha-prod-5678',
        commitAuthor: 'developer-bob',
        environment: 'PRODUCTION',
        status: 'FAILURE',
        timestamp: new Date(now - 900000), // 15 mins ago
        logs: 'FAILED STEP: deploy\nREASON:\nDeployment timed out\n\n--- LOG (last 150 lines) ---\nerror log tail',
      },
    });

    // ─── Test 1: Zero-run repository included with empty run list ──────────────────
    console.log('\n-- Test 1: Zero-run repository included with empty run list');
    const allData = await getDeploymentsData();
    const zeroFound = allData.find((r) => r.id === zeroId);

    report(
      Boolean(zeroFound),
      'Zero-run repository is included in dashboard data',
      `found=${Boolean(zeroFound)} id=${zeroId}`
    );
    report(
      Boolean(
        zeroFound &&
        zeroFound.recentRuns.length === 0 &&
        zeroFound.latestByEnvironment.STAGING === null &&
        zeroFound.latestByEnvironment.PRODUCTION === null &&
        zeroFound.latest.STAGING === null &&
        zeroFound.latest.PRODUCTION === null
      ),
      'Zero-run repository has an empty run list and null latestByEnvironment',
      `recentRuns.length=${zeroFound?.recentRuns?.length} latestSTAGING=${zeroFound?.latestByEnvironment?.STAGING}`
    );

    // ─── Test 2: Repository with only push rows is idle ───────────────────────────
    console.log('\n-- Test 2: Repository with only push row is idle');
    const pushFound = allData.find((r) => r.id === pushId);

    report(
      Boolean(pushFound),
      'Push-only repository is included in dashboard data',
      `found=${Boolean(pushFound)} id=${pushId}`
    );
    report(
      Boolean(
        pushFound &&
        pushFound.recentRuns.length === 0 &&
        pushFound.latestByEnvironment.STAGING === null &&
        pushFound.latestByEnvironment.PRODUCTION === null
      ),
      'Push row (runId null) is not counted as a run; repository is idle with empty run list',
      `recentRuns.length=${pushFound?.recentRuns?.length}`
    );

    // ─── Test 3: Active repositories appear with runs & sort before idle ones ──────
    console.log('\n-- Test 3: Sorting (latest run timestamp desc, idle repos after sorted by name asc)');
    const stagingFound = allData.find((r) => r.id === stagingId);
    const prodFound = allData.find((r) => r.id === prodId);

    report(
      Boolean(stagingFound && stagingFound.recentRuns.length === 1 && stagingFound.latestByEnvironment.STAGING),
      'Repository with staging run appears with its run in latestByEnvironment and recentRuns',
      `runId=${stagingFound?.latestByEnvironment?.STAGING?.runId}`
    );
    report(
      Boolean(prodFound && prodFound.recentRuns.length === 1 && prodFound.latestByEnvironment.PRODUCTION),
      'Repository with production run appears with its run in latestByEnvironment and recentRuns',
      `runId=${prodFound?.latestByEnvironment?.PRODUCTION?.runId}`
    );

    // Filter to our 4 test repositories in allData to check their relative ordering
    const testReposInOrder = allData.filter((r) => r.owner === FAKE_OWNER);
    const orderNames = testReposInOrder.map((r) => r.name);

    // Expected order:
    // 1. deploy-test-prod (15m ago)
    // 2. deploy-test-staging (30m ago)
    // 3. deploy-test-push (idle, name 'deploy-test-push' < 'deploy-test-zero')
    // 4. deploy-test-zero (idle, name 'deploy-test-zero')
    const expectedOrder = [PROD_REPO_NAME, STAGING_REPO_NAME, PUSH_REPO_NAME, ZERO_REPO_NAME];
    const isSortedCorrectly =
      testReposInOrder.length === 4 &&
      orderNames[0] === PROD_REPO_NAME &&
      orderNames[1] === STAGING_REPO_NAME &&
      orderNames[2] === PUSH_REPO_NAME &&
      orderNames[3] === ZERO_REPO_NAME;

    report(
      isSortedCorrectly,
      'Active repositories sort before idle ones by timestamp desc, and idle repos sort by name asc',
      `actualOrder=[${orderNames.join(', ')}] expected=[${expectedOrder.join(', ')}]`
    );

    // ─── Test 4: Environment filter (STAGING) ──────────────────────────────────────
    console.log('\n-- Test 4: environment=STAGING filter');
    const stagingData = await getDeploymentsData({ environment: 'STAGING' });
    const stagingTestRepos = stagingData.filter((r) => r.owner === FAKE_OWNER);

    report(
      stagingTestRepos.some((r) => r.name === STAGING_REPO_NAME),
      'environment=STAGING includes repository with STAGING run',
      `stagingRepo included=${stagingTestRepos.some((r) => r.name === STAGING_REPO_NAME)}`
    );
    report(
      !stagingTestRepos.some((r) => r.name === PROD_REPO_NAME),
      'environment=STAGING excludes repository with only PRODUCTION run',
      `prodRepo excluded=${!stagingTestRepos.some((r) => r.name === PROD_REPO_NAME)}`
    );
    report(
      !stagingTestRepos.some((r) => r.name === ZERO_REPO_NAME || r.name === PUSH_REPO_NAME),
      'environment=STAGING excludes idle repositories (zero-run & push-only)',
      `idle repos in staging=${stagingTestRepos.filter((r) => r.name === ZERO_REPO_NAME || r.name === PUSH_REPO_NAME).length}`
    );

    // ─── Test 5: Status filter ────────────────────────────────────────────────────
    console.log('\n-- Test 5: status=PASSING and status=FAILING filters');
    const passingData = await getDeploymentsData({ status: 'PASSING' });
    const passingTestRepos = passingData.filter((r) => r.owner === FAKE_OWNER);

    report(
      passingTestRepos.some((r) => r.name === STAGING_REPO_NAME) &&
      !passingTestRepos.some((r) => r.name === PROD_REPO_NAME) &&
      !passingTestRepos.some((r) => r.name === ZERO_REPO_NAME || r.name === PUSH_REPO_NAME),
      'status=PASSING includes passing repo and excludes failing and idle repos',
      `passingCount=${passingTestRepos.length} names=[${passingTestRepos.map((r) => r.name).join(', ')}]`
    );

    const failingData = await getDeploymentsData({ status: 'FAILING' });
    const failingTestRepos = failingData.filter((r) => r.owner === FAKE_OWNER);

    report(
      failingTestRepos.some((r) => r.name === PROD_REPO_NAME) &&
      !failingTestRepos.some((r) => r.name === STAGING_REPO_NAME) &&
      !failingTestRepos.some((r) => r.name === ZERO_REPO_NAME || r.name === PUSH_REPO_NAME),
      'status=FAILING includes failing repo and excludes passing and idle repos',
      `failingCount=${failingTestRepos.length} names=[${failingTestRepos.map((r) => r.name).join(', ')}]`
    );

    // ─── Test 6: Repo filter ──────────────────────────────────────────────────────
    console.log('\n-- Test 6: repo filter narrows to specific repository (idle or active)');
    const singleZeroData = await getDeploymentsData({ repo: `${FAKE_OWNER}/${ZERO_REPO_NAME}` });
    report(
      singleZeroData.length === 1 && singleZeroData[0].name === ZERO_REPO_NAME && singleZeroData[0].recentRuns.length === 0,
      'repo filter narrows to idle repository without error',
      `returnedCount=${singleZeroData.length} name=${singleZeroData[0]?.name}`
    );

    const singleActiveData = await getDeploymentsData({ repo: `${FAKE_OWNER}/${PROD_REPO_NAME}` });
    report(
      singleActiveData.length === 1 && singleActiveData[0].name === PROD_REPO_NAME && singleActiveData[0].recentRuns.length === 1,
      'repo filter narrows to active repository',
      `returnedCount=${singleActiveData.length} name=${singleActiveData[0]?.name}`
    );

    // ─── Test 7: Returned shape contract verification ─────────────────────────────
    console.log('\n-- Test 7: Returned shape contract verification');
    const sampleRepo = allData.find((r) => r.id === stagingId)!;
    const sampleRun = sampleRepo.recentRuns[0];

    const hasRepoFields =
      typeof sampleRepo.id === 'string' &&
      typeof sampleRepo.name === 'string' &&
      typeof sampleRepo.owner === 'string' &&
      (sampleRepo.createdAt === undefined || typeof sampleRepo.createdAt === 'string') &&
      typeof sampleRepo.latestByEnvironment === 'object' &&
      typeof sampleRepo.latest === 'object' &&
      Array.isArray(sampleRepo.recentRuns);

    report(hasRepoFields, 'Repository object matches expected contract shape');

    const hasRunFields =
      typeof sampleRun.id === 'string' &&
      typeof sampleRun.runId === 'string' &&
      (sampleRun.deliveryId === null || typeof sampleRun.deliveryId === 'string') &&
      typeof sampleRun.commitSha === 'string' &&
      typeof sampleRun.commitAuthor === 'string' &&
      typeof sampleRun.branch === 'string' &&
      (sampleRun.environment === 'STAGING' || sampleRun.environment === 'PRODUCTION') &&
      typeof sampleRun.status === 'string' &&
      typeof sampleRun.timestamp === 'string' &&
      typeof sampleRun.repositoryId === 'string' &&
      typeof sampleRun.hasLogs === 'boolean';

    report(hasRunFields, 'DeploymentItem object matches expected contract shape');

    const rawRun = sampleRun as unknown as Record<string, unknown>;
    const logsStripped = rawRun.logs === undefined;
    report(logsStripped, 'Response is free of logs string (hasLogs boolean preserved)', `hasLogs=${sampleRun.hasLogs}`);

  } finally {
    // Cleanup
    console.log('\n=== Cleanup ===');
    const deletedDeployments = await prisma.deployment.deleteMany({
      where: { repository: { owner: FAKE_OWNER } },
    });
    const deletedRepos = await prisma.repository.deleteMany({
      where: { owner: FAKE_OWNER },
    });
    console.log(`Deleted ${deletedDeployments.count} test deployment(s) and ${deletedRepos.count} test repository(ies)`);

    const reposAfter = await prisma.repository.count({
      where: { owner: { not: FAKE_OWNER } },
    });
    const deploymentsAfter = await prisma.deployment.count({
      where: { repository: { owner: { not: FAKE_OWNER } } },
    });
    console.log(`Other repositories unchanged: ${reposAfter} repo(s) (before=${reposBefore} after=${reposAfter}), ${deploymentsAfter} deployment(s) (before=${deploymentsBefore} after=${deploymentsAfter})`);

    report(
      reposBefore === reposAfter && deploymentsBefore === deploymentsAfter,
      'No other repositories or deployments were modified or deleted'
    );
  }

  console.log(`\n========================================`);
  console.log(`Deployments Data Tests Summary: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in test script:', err);
  process.exit(1);
});
