import { normalizeStatus, isStale, statusLabel, statusTone } from '../lib/status';
import { computeKpis } from '../lib/kpi';
import type { RepositoryDeployments, DeploymentItem } from '../types/deployments';

let passedTests = 0;
let failedTests = 0;

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    passedTests++;
    console.log(`  PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  FAIL: ${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
  }
}

console.log('--- 1. Testing normalizeStatus ---');
// Aliases: pass
assertEqual(normalizeStatus('SUCCESS'), 'pass', 'normalizeStatus SUCCESS -> pass');
assertEqual(normalizeStatus('PASSED'), 'pass', 'normalizeStatus PASSED -> pass');
assertEqual(normalizeStatus('success'), 'pass', 'normalizeStatus success -> pass');
assertEqual(normalizeStatus('passed'), 'pass', 'normalizeStatus passed -> pass');
assertEqual(normalizeStatus('Success'), 'pass', 'normalizeStatus Success -> pass');
assertEqual(normalizeStatus('Passed'), 'pass', 'normalizeStatus Passed -> pass');

// Aliases: fail
assertEqual(normalizeStatus('FAILED'), 'fail', 'normalizeStatus FAILED -> fail');
assertEqual(normalizeStatus('FAILURE'), 'fail', 'normalizeStatus FAILURE -> fail');
assertEqual(normalizeStatus('CANCELLED'), 'fail', 'normalizeStatus CANCELLED -> fail');
assertEqual(normalizeStatus('TIMED_OUT'), 'fail', 'normalizeStatus TIMED_OUT -> fail');
assertEqual(normalizeStatus('failed'), 'fail', 'normalizeStatus failed -> fail');
assertEqual(normalizeStatus('failure'), 'fail', 'normalizeStatus failure -> fail');
assertEqual(normalizeStatus('cancelled'), 'fail', 'normalizeStatus cancelled -> fail');
assertEqual(normalizeStatus('timed_out'), 'fail', 'normalizeStatus timed_out -> fail');
assertEqual(normalizeStatus('Failed'), 'fail', 'normalizeStatus Failed -> fail');
assertEqual(normalizeStatus('Failure'), 'fail', 'normalizeStatus Failure -> fail');
assertEqual(normalizeStatus('Cancelled'), 'fail', 'normalizeStatus Cancelled -> fail');
assertEqual(normalizeStatus('Timed_Out'), 'fail', 'normalizeStatus Timed_Out -> fail');

// Aliases: active
assertEqual(normalizeStatus('PENDING'), 'active', 'normalizeStatus PENDING -> active');
assertEqual(normalizeStatus('RUNNING'), 'active', 'normalizeStatus RUNNING -> active');
assertEqual(normalizeStatus('QUEUED'), 'active', 'normalizeStatus QUEUED -> active');
assertEqual(normalizeStatus('IN_PROGRESS'), 'active', 'normalizeStatus IN_PROGRESS -> active');
assertEqual(normalizeStatus('pending'), 'active', 'normalizeStatus pending -> active');
assertEqual(normalizeStatus('running'), 'active', 'normalizeStatus running -> active');
assertEqual(normalizeStatus('queued'), 'active', 'normalizeStatus queued -> active');
assertEqual(normalizeStatus('in_progress'), 'active', 'normalizeStatus in_progress -> active');
assertEqual(normalizeStatus('Pending'), 'active', 'normalizeStatus Pending -> active');
assertEqual(normalizeStatus('Running'), 'active', 'normalizeStatus Running -> active');

// Unknown / Empty / Null
assertEqual(normalizeStatus('unknown'), 'idle', 'normalizeStatus unknown -> idle');
assertEqual(normalizeStatus('foo_bar'), 'idle', 'normalizeStatus foo_bar -> idle');
assertEqual(normalizeStatus(''), 'idle', 'normalizeStatus empty string -> idle');
assertEqual(normalizeStatus(null), 'idle', 'normalizeStatus null -> idle');
assertEqual(normalizeStatus(undefined), 'idle', 'normalizeStatus undefined -> idle');

console.log('\n--- 2. Testing statusLabel & statusTone ---');
assertEqual(statusLabel('FAILURE'), 'FAILED', 'statusLabel FAILURE -> FAILED');
assertEqual(statusLabel('FAILED'), 'FAILED', 'statusLabel FAILED -> FAILED');
assertEqual(statusLabel('CANCELLED'), 'CANCELLED', 'statusLabel CANCELLED -> CANCELLED');
assertEqual(statusLabel('TIMED_OUT'), 'TIMED_OUT', 'statusLabel TIMED_OUT -> TIMED_OUT');
assertEqual(statusLabel('PENDING'), 'PENDING', 'statusLabel PENDING -> PENDING');
assertEqual(statusLabel('RUNNING'), 'RUNNING', 'statusLabel RUNNING -> RUNNING');
assertEqual(statusLabel('SUCCESS'), 'PASSED', 'statusLabel SUCCESS -> PASSED');
assertEqual(statusLabel('PASSED'), 'PASSED', 'statusLabel PASSED -> PASSED');
assertEqual(statusLabel('RUNNING', true), 'STALE', 'statusLabel RUNNING (stale=true) -> STALE');
assertEqual(statusLabel('PENDING', true), 'STALE', 'statusLabel PENDING (stale=true) -> STALE');
assertEqual(statusLabel('', false), 'IDLE', 'statusLabel empty -> IDLE');
assertEqual(statusLabel(null, false), 'IDLE', 'statusLabel null -> IDLE');

assertEqual(statusTone('SUCCESS'), 'pass', 'statusTone SUCCESS -> pass');
assertEqual(statusTone('FAILURE'), 'fail', 'statusTone FAILURE -> fail');
assertEqual(statusTone('RUNNING'), 'pending', 'statusTone RUNNING -> pending');
assertEqual(statusTone('RUNNING', true), 'idle', 'statusTone RUNNING (stale=true) -> idle');
assertEqual(statusTone('IDLE'), 'idle', 'statusTone IDLE -> idle');
assertEqual(statusTone(null), 'idle', 'statusTone null -> idle');

console.log('\n--- 3. Testing isStale ---');
const baseNow = 1700000000000;
const fiveHours59MinsMs = (5 * 60 + 59) * 60 * 1000;
const sixHours1MinMs = (6 * 60 + 1) * 60 * 1000;

assertEqual(
  isStale('RUNNING', baseNow - fiveHours59MinsMs, baseNow),
  false,
  'isStale active at 5h59m -> false'
);
assertEqual(
  isStale('RUNNING', baseNow - sixHours1MinMs, baseNow),
  true,
  'isStale active at 6h01m -> true'
);
assertEqual(
  isStale('PENDING', baseNow - sixHours1MinMs, baseNow),
  true,
  'isStale pending at 6h01m -> true'
);
assertEqual(
  isStale('SUCCESS', baseNow - sixHours1MinMs, baseNow),
  false,
  'isStale success at 6h01m -> false'
);
assertEqual(
  isStale('FAILED', baseNow - sixHours1MinMs, baseNow),
  false,
  'isStale failed at 6h01m -> false'
);

console.log('\n--- 4. Testing computeKpis ---');

// 4a. Empty input
const kpiNull = computeKpis(null, baseNow, 'ALL');
assertEqual(kpiNull.runs24h, 0, 'computeKpis(null) runs24h === 0');
assertEqual(kpiNull.reposPassing, '0 of 0', 'computeKpis(null) reposPassing === "0 of 0"');
assertEqual(kpiNull.runningNow, 0, 'computeKpis(null) runningNow === 0');

const kpiUndefined = computeKpis(undefined, baseNow, 'ALL');
assertEqual(kpiUndefined.runs24h, 0, 'computeKpis(undefined) runs24h === 0');
assertEqual(kpiUndefined.reposPassing, '0 of 0', 'computeKpis(undefined) reposPassing === "0 of 0"');

const kpiEmpty = computeKpis([], baseNow, 'ALL');
assertEqual(kpiEmpty.runs24h, 0, 'computeKpis([]) runs24h === 0');
assertEqual(kpiEmpty.reposPassing, '0 of 0', 'computeKpis([]) reposPassing === "0 of 0"');

// Helper to make mock DeploymentItem
function makeRun(id: string, status: string, env: 'STAGING' | 'PRODUCTION', ageMs: number): DeploymentItem {
  return {
    id,
    runId: `run-${id}`,
    deliveryId: null,
    commitSha: 'abcdef1',
    commitAuthor: 'tester',
    branch: 'main',
    status,
    environment: env,
    timestamp: new Date(baseNow - ageMs).toISOString(),
    repositoryId: 'mock-repo',
    hasLogs: false,
  };
}

// 4b. Only idle repositories (no runs)
const idleRepos: RepositoryDeployments[] = [
  {
    id: 'repo-idle-1',
    name: 'idle-repo',
    owner: 'owner1',
    latestByEnvironment: {
      STAGING: null,
      PRODUCTION: null,
    },
    latest: {
      STAGING: null,
      PRODUCTION: null,
    },
    recentRuns: [],
  },
];

const kpiIdleAll = computeKpis(idleRepos, baseNow, 'ALL');
assertEqual(kpiIdleAll.runs24h, 0, 'idle repos ALL: runs24h === 0');
assertEqual(kpiIdleAll.reposPassing, '0 of 0', 'idle repos ALL: reposPassing === "0 of 0"');
assertEqual(kpiIdleAll.runningNow, 0, 'idle repos ALL: runningNow === 0');

const kpiIdleStaging = computeKpis(idleRepos, baseNow, 'STAGING');
assertEqual(kpiIdleStaging.reposPassing, '0 of 0', 'idle repos STAGING: reposPassing === "0 of 0"');

// 4c. Mixed statuses and 24h boundary
const oneHour = 60 * 60 * 1000;
const twoHours = 2 * oneHour;
const sevenHours = 7 * oneHour;
const twentyFiveHours = 25 * oneHour;

const mixedRepos: RepositoryDeployments[] = [
  // Repo A: Latest finished is SUCCESS (2h ago)
  {
    id: 'repo-a',
    name: 'repo-a',
    owner: 'owner1',
    latestByEnvironment: {
      STAGING: makeRun('run-a1', 'SUCCESS', 'STAGING', twoHours),
      PRODUCTION: null,
    },
    latest: {
      STAGING: makeRun('run-a1', 'SUCCESS', 'STAGING', twoHours),
      PRODUCTION: null,
    },
    recentRuns: [makeRun('run-a1', 'SUCCESS', 'STAGING', twoHours)],
  },
  // Repo B: Latest finished is FAILED (1h ago), older run passed (25h ago)
  {
    id: 'repo-b',
    name: 'repo-b',
    owner: 'owner1',
    latestByEnvironment: {
      STAGING: null,
      PRODUCTION: makeRun('run-b1', 'FAILED', 'PRODUCTION', oneHour),
    },
    latest: {
      STAGING: null,
      PRODUCTION: makeRun('run-b1', 'FAILED', 'PRODUCTION', oneHour),
    },
    recentRuns: [
      makeRun('run-b1', 'FAILED', 'PRODUCTION', oneHour),
      makeRun('run-b2', 'SUCCESS', 'PRODUCTION', twentyFiveHours),
    ],
  },
  // Repo C: Running now (1h ago, active, not stale)
  {
    id: 'repo-c',
    name: 'repo-c',
    owner: 'owner1',
    latestByEnvironment: {
      STAGING: makeRun('run-c1', 'RUNNING', 'STAGING', oneHour),
      PRODUCTION: null,
    },
    latest: {
      STAGING: makeRun('run-c1', 'RUNNING', 'STAGING', oneHour),
      PRODUCTION: null,
    },
    recentRuns: [makeRun('run-c1', 'RUNNING', 'STAGING', oneHour)],
  },
  // Repo D: Active but STALE (7h ago)
  {
    id: 'repo-d',
    name: 'repo-d',
    owner: 'owner1',
    latestByEnvironment: {
      STAGING: null,
      PRODUCTION: makeRun('run-d1', 'IN_PROGRESS', 'PRODUCTION', sevenHours),
    },
    latest: {
      STAGING: null,
      PRODUCTION: makeRun('run-d1', 'IN_PROGRESS', 'PRODUCTION', sevenHours),
    },
    recentRuns: [makeRun('run-d1', 'IN_PROGRESS', 'PRODUCTION', sevenHours)],
  },
];

const kpiMixedAll = computeKpis(mixedRepos, baseNow, 'ALL');
// Runs in 24h:
// Repo A: run-a1 (2h) -> yes (1)
// Repo B: run-b1 (1h) -> yes (2), run-b2 (25h) -> no (excluded > 24h)
// Repo C: run-c1 (1h) -> yes (3)
// Repo D: run-d1 (7h) -> yes (4)
assertEqual(kpiMixedAll.runs24h, 4, 'mixed repos ALL: runs24h === 4 (25h run excluded)');

// Repos passing:
// Repo A latest finished: SUCCESS -> pass (1)
// Repo B latest finished: FAILED (even though 25h run was SUCCESS) -> fail
// Repo C has no finished runs -> excluded from M
// Repo D has no finished runs -> excluded from M
// Total finished = 2 (Repo A and Repo B), Passing = 1 (Repo A)
assertEqual(kpiMixedAll.reposPassing, '1 of 2', 'mixed repos ALL: reposPassing === "1 of 2"');

// Running now:
// Repo C run-c1 (1h) -> active, not stale -> yes (1)
// Repo D run-d1 (7h) -> active, but stale (>6h) -> excluded
assertEqual(kpiMixedAll.runningNow, 1, 'mixed repos ALL: runningNow === 1 (stale run excluded)');

// 4d. Environment filter
const kpiMixedStaging = computeKpis(mixedRepos, baseNow, 'STAGING');
// Staging runs: run-a1 (2h), run-c1 (1h) -> 2 runs in 24h
assertEqual(kpiMixedStaging.runs24h, 2, 'mixed repos STAGING: runs24h === 2');
// Repos in Staging: Repo A (finished pass), Repo C (active only, no finished) -> "1 of 1"
assertEqual(kpiMixedStaging.reposPassing, '1 of 1', 'mixed repos STAGING: reposPassing === "1 of 1"');
// Running in Staging: run-c1 (1h) -> 1
assertEqual(kpiMixedStaging.runningNow, 1, 'mixed repos STAGING: runningNow === 1');

const kpiMixedProd = computeKpis(mixedRepos, baseNow, 'PRODUCTION');
// Prod runs: run-b1 (1h), run-d1 (7h) [run-b2 is >24h] -> 2 runs in 24h
assertEqual(kpiMixedProd.runs24h, 2, 'mixed repos PRODUCTION: runs24h === 2');
// Repos in Prod: Repo B (finished fail), Repo D (active only) -> "0 of 1"
assertEqual(kpiMixedProd.reposPassing, '0 of 1', 'mixed repos PRODUCTION: reposPassing === "0 of 1"');
// Running in Prod: run-d1 is stale -> 0
assertEqual(kpiMixedProd.runningNow, 0, 'mixed repos PRODUCTION: runningNow === 0');

// 4e. Idle repo tab behavior
const mixedWithIdle: RepositoryDeployments[] = [...mixedRepos, ...idleRepos];
// In ALL tab, idle repo is present, but has no finished runs
const kpiIdleWithMixedAll = computeKpis(mixedWithIdle, baseNow, 'ALL');
assertEqual(kpiIdleWithMixedAll.reposPassing, '1 of 2', 'ALL with idle: reposPassing remains "1 of 2"');

// In STAGING tab, idle repo has 0 staging runs, so excluded from tab counts
const kpiIdleWithMixedStaging = computeKpis(mixedWithIdle, baseNow, 'STAGING');
assertEqual(kpiIdleWithMixedStaging.reposPassing, '1 of 1', 'STAGING with idle: reposPassing remains "1 of 1"');

console.log(`\n========================================`);
console.log(`Summary: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log(`========================================`);

if (failedTests > 0) {
  process.exit(1);
}
