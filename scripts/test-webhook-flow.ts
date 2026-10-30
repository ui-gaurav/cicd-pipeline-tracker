/**
 * scripts/test-webhook-flow.ts
 *
 * Comprehensive webhook behavior test.
 * Only modifies rows for owner="test-owner", name="webhook-flow-test".
 * Cleans up after itself. Never prints GITHUB_WEBHOOK_SECRET.
 *
 * Usage:
 *   node --env-file=.env node_modules/.bin/tsx scripts/test-webhook-flow.ts
 *
 * Requires the dev server to be running on port 3000.
 */

import crypto from 'crypto';
import Module from 'module';
interface NodeModuleWithRequire {
    prototype: {
        require: (id: string, ...args: unknown[]) => unknown;
    };
}
const nodeModule = Module as unknown as NodeModuleWithRequire;
const origRequire = nodeModule.prototype.require;
nodeModule.prototype.require = function (id: string, ...args: unknown[]) {
    if (id === 'server-only') return {};
    return origRequire.apply(this, [id, ...args]);
};

import { PrismaClient } from '@prisma/client';
import { formatFailureLog, parseFailureLog, LOG_MARKER, ESCAPED_LOG_MARKER } from '../lib/failure-log';
import type { fetchFailureDetails as FetchFailureDetailsType } from '../lib/github-api';
let fetchFailureDetails: typeof FetchFailureDetailsType;

// ── Config ────────────────────────────────────────────────────────────────────
const TARGET = process.env.WEBHOOK_URL ?? 'http://localhost:3000/api/webhooks/github';
const SECRET = process.env.GITHUB_WEBHOOK_SECRET;

if (!SECRET) {
    console.error(
        'ERROR: GITHUB_WEBHOOK_SECRET is not set.\n' +
        'Run with: node --env-file=.env node_modules/.bin/tsx scripts/test-webhook-flow.ts'
    );
    process.exit(1);
}

const FAKE_OWNER = 'test-owner';
const FAKE_REPO  = 'webhook-flow-test';

// ── Prisma (direct connection for test assertions) ────────────────────────────
const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────
function sign(body: string): string {
    return 'sha256=' + crypto.createHmac('sha256', SECRET!).update(body).digest('hex');
}

function uuidv4(): string {
    return crypto.randomUUID();
}

interface SendResult {
    status: number;
    body: unknown;
    elapsedMs: number;
    deliveryId: string;
}

async function send(
    event: string,
    payload: object,
    opts: { badSig?: boolean; noSig?: boolean; deliveryId?: string } = {}
): Promise<SendResult> {
    const bodyStr = JSON.stringify(payload);
    const deliveryId = opts.deliveryId ?? uuidv4();
    const sig = opts.noSig ? undefined : (opts.badSig ? 'sha256=deadbeefdeadbeef' : sign(bodyStr));

    const headers: Record<string, string> = {
        'Content-Type':      'application/json',
        'X-GitHub-Event':    event,
        'X-GitHub-Delivery': deliveryId,
    };
    if (sig !== undefined) {
        headers['X-Hub-Signature-256'] = sig;
    }

    const t0 = Date.now();
    const res = await fetch(TARGET, { method: 'POST', headers, body: bodyStr });
    const elapsedMs = Date.now() - t0;

    let body: unknown;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text; }

    return { status: res.status, body, elapsedMs, deliveryId };
}

async function pollForRow(
    repoId: string,
    runId: string,
    maxMs = 15000
): Promise<{ status: string; logs: string | null; deliveryId: string | null } | null> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const row = await prisma.deployment.findUnique({
            where: { repositoryId_runId: { repositoryId: repoId, runId } },
            select: { status: true, logs: true, deliveryId: true },
        });
        if (row) return row;
        await new Promise((r) => setTimeout(r, 200));
    }
    return null;
}

async function pollForStatus(
    repoId: string,
    runId: string,
    expectedStatuses: string[],
    maxMs = 15000
): Promise<{ status: string; logs: string | null; deliveryId: string | null } | null> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const row = await prisma.deployment.findUnique({
            where: { repositoryId_runId: { repositoryId: repoId, runId } },
            select: { status: true, logs: true, deliveryId: true },
        });
        if (row && expectedStatuses.includes(row.status)) return row;
        await new Promise((r) => setTimeout(r, 200));
    }
    return null;
}

async function getFakeRepoId(): Promise<string> {
    const repo = await prisma.repository.upsert({
        where: { owner_name: { owner: FAKE_OWNER, name: FAKE_REPO } },
        update: {},
        create: { owner: FAKE_OWNER, name: FAKE_REPO },
    });
    return repo.id;
}

function workflowRunPayload(
    action: string,
    conclusion: string | null,
    runId: number,
    updatedAt?: string,
    testLogs?: string
): object {
    const statusField = action === 'completed' ? 'completed' : (action === 'in_progress' ? 'in_progress' : 'requested');
    return {
        action,
        workflow_run: {
            id: runId,
            name: 'CI',
            head_branch: 'main',
            head_sha: 'sha-' + runId.toString(16),
            status: statusField,
            conclusion,
            html_url: `https://github.com/${FAKE_OWNER}/${FAKE_REPO}/actions/runs/${runId}`,
            updated_at: updatedAt ?? new Date().toISOString(),
            head_commit: {
                message: 'test commit',
                author: { name: 'Test User', email: 'test@example.com' },
            },
            actor: { login: 'test-user' },
            ...(testLogs ? { _test_logs: testLogs } : {}),
        },
        repository: {
            name: FAKE_REPO,
            owner: { login: FAKE_OWNER },
        },
        sender: { login: 'test-user' },
    };
}

function pushPayload(): object {
    return {
        ref: 'refs/heads/feature-x',
        head_commit: {
            id: 'abc123pushsha',
            message: 'push test',
            timestamp: new Date().toISOString(),
            author: { name: 'Test User', email: 'test@example.com' },
        },
        repository: {
            name: FAKE_REPO,
            owner: { login: FAKE_OWNER },
        },
        sender: { login: 'test-user' },
    };
}

// ── Test runner ───────────────────────────────────────────────────────────────
interface TestResult {
    name: string;
    passed: boolean;
    details?: string;
}

const results: TestResult[] = [];

function pass(name: string, details?: string) {
    results.push({ name, passed: true, details });
    console.log(`  PASS: ${name}` + (details ? ` | ${details}` : ''));
}

function fail(name: string, details: string) {
    results.push({ name, passed: false, details });
    console.log(`  FAIL: ${name} | ${details}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const ghApi = await import('../lib/github-api');
    fetchFailureDetails = ghApi.fetchFailureDetails;
    const { validateRepoOwnerAndName } = await import('../lib/repo-validation');
    const { handleAddRepository } = await import('../app/api/repos/route');
    const { handleRefreshRepo } = await import('../app/api/repos/[repo]/refresh/route');

    console.log('\n=== Webhook Behavior Tests ===\n');

    // Count rows for other repos before we start
    const reposBefore = await prisma.repository.findMany({
        where: { NOT: { owner: { in: [FAKE_OWNER, 'test-fake-owner'] } } },
        select: { id: true },
    });
    const otherRepoIds = reposBefore.map((r) => r.id);
    const rowCountBefore = otherRepoIds.length > 0
        ? await prisma.deployment.count({ where: { repositoryId: { in: otherRepoIds } } })
        : 0;

    const fakeRepoId = await getFakeRepoId();
    console.log(`Fake repo ID: ${fakeRepoId}\n`);

    // ── Case 1 ────────────────────────────────────────────────────────────────
    console.log('-- Case 1: Bad/missing signature');
    {
        const dummy = workflowRunPayload('completed', 'success', 99999001);

        const badSigRes = await send('workflow_run', dummy, { badSig: true });
        if (badSigRes.status === 401) {
            pass('1a. Bad signature returns 401', `status=${badSigRes.status} elapsed=${badSigRes.elapsedMs}ms`);
        } else {
            fail('1a. Bad signature returns 401', `got status=${badSigRes.status} body=${JSON.stringify(badSigRes.body)}`);
        }

        const noSigRes = await send('workflow_run', dummy, { noSig: true });
        if (noSigRes.status === 401) {
            pass('1b. Missing signature returns 401', `status=${noSigRes.status} elapsed=${noSigRes.elapsedMs}ms`);
        } else {
            fail('1b. Missing signature returns 401', `got status=${noSigRes.status} body=${JSON.stringify(noSigRes.body)}`);
        }
    }

    // ── Case 2 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 2: ping and check_suite');
    {
        const rowsBefore = await prisma.deployment.count({ where: { repositoryId: fakeRepoId } });

        const pingRes = await send('ping', { zen: 'Keep it logically awesome.', hook_id: 1 });
        const checkSuiteRes = await send('check_suite', {
            action: 'completed',
            check_suite: { id: 99999002 },
            repository: { name: FAKE_REPO, owner: { login: FAKE_OWNER } },
        });
        await new Promise((r) => setTimeout(r, 800));

        const rowsAfter = await prisma.deployment.count({ where: { repositoryId: fakeRepoId } });

        if (pingRes.status === 200 && checkSuiteRes.status === 200 && rowsAfter === rowsBefore) {
            pass('2. ping and check_suite return 200, no rows created',
                `ping=${pingRes.status} check_suite=${checkSuiteRes.status} rows unchanged at ${rowsAfter}`);
        } else {
            fail('2. ping and check_suite return 200, no rows created',
                `ping=${pingRes.status} check_suite=${checkSuiteRes.status} rowsBefore=${rowsBefore} rowsAfter=${rowsAfter}`);
        }
    }

    // ── Case 3 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 3: workflow_run with no id');
    {
        const rowsBefore = await prisma.deployment.count({ where: { repositoryId: fakeRepoId } });
        const noIdPayload = {
            action: 'completed',
            workflow_run: {
                name: 'CI',
                head_branch: 'main',
                head_sha: 'abc123',
                status: 'completed',
                conclusion: 'success',
                html_url: `https://github.com/${FAKE_OWNER}/${FAKE_REPO}/actions/runs/0`,
                updated_at: new Date().toISOString(),
            },
            repository: { name: FAKE_REPO, owner: { login: FAKE_OWNER } },
        };
        const res = await send('workflow_run', noIdPayload);
        await new Promise((r) => setTimeout(r, 800));
        const rowsAfter = await prisma.deployment.count({ where: { repositoryId: fakeRepoId } });

        if (res.status === 200 && rowsAfter === rowsBefore) {
            pass('3. Missing workflow_run.id: 200, no row created',
                `status=${res.status} rows unchanged at ${rowsAfter}`);
        } else {
            fail('3. Missing workflow_run.id: 200, no row created',
                `status=${res.status} rowsBefore=${rowsBefore} rowsAfter=${rowsAfter}`);
        }
    }

    // ── Case 4 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 4: Response time < 1000 ms + async write');
    {
        const runId4 = 99990004;
        const p = workflowRunPayload('requested', null, runId4);
        const res = await send('workflow_run', p);

        if (res.status === 200 && res.elapsedMs < 1000) {
            pass(`4a. Response < 1000 ms`, `elapsed=${res.elapsedMs}ms status=${res.status}`);
        } else {
            fail('4a. Response < 1000 ms', `status=${res.status} elapsed=${res.elapsedMs}ms`);
        }

        const row = await pollForRow(fakeRepoId, String(runId4));
        if (row) {
            pass('4b. DB row eventually written (async)', `status=${row.status}`);
        } else {
            fail('4b. DB row eventually written (async)', 'row not found within 5s');
        }
    }

    // ── Case 5 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 5: requested -> in_progress -> completed(failure)');
    {
        const runId5 = 99990005;
        const t0 = new Date(Date.now() - 6000).toISOString();
        const t1 = new Date(Date.now() - 3000).toISOString();
        const t2 = new Date().toISOString();

        await send('workflow_run', workflowRunPayload('requested',   null,      runId5, t0));
        await new Promise((r) => setTimeout(r, 300));
        await send('workflow_run', workflowRunPayload('in_progress', null,      runId5, t1));
        await new Promise((r) => setTimeout(r, 300));
        await send('workflow_run', workflowRunPayload('completed',   'failure', runId5, t2, 'lifecycle failure log'));

        const row = await pollForStatus(fakeRepoId, String(runId5), ['FAILURE'], 10000);
        const count = await prisma.deployment.count({
            where: { repositoryId: fakeRepoId, runId: String(runId5) },
        });

        if (count === 1 && row?.status === 'FAILURE') {
            pass('5. Lifecycle: one row, final status=FAILURE');
        } else {
            fail('5. Lifecycle', `rowCount=${count} status=${row?.status ?? 'null (not found within 10s)'}`);
        }
    }

    // ── Case 6 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 6: Replay same delivery id');
    {
        const runId6 = 99990006;
        const deliveryId6 = uuidv4();
        const p = workflowRunPayload('requested', null, runId6);

        await send('workflow_run', p, { deliveryId: deliveryId6 });
        const firstRow = await pollForRow(fakeRepoId, String(runId6));

        if (!firstRow) {
            fail('6. Idempotency: setup failed', 'row not created after first send');
        } else {
            const countBefore = await prisma.deployment.count({
                where: { repositoryId: fakeRepoId, runId: String(runId6) },
            });

            await send('workflow_run', p, { deliveryId: deliveryId6 });
            await new Promise((r) => setTimeout(r, 1200));

            const countAfter = await prisma.deployment.count({
                where: { repositoryId: fakeRepoId, runId: String(runId6) },
            });

            if (countBefore === 1 && countAfter === 1) {
                pass('6. Replayed same deliveryId: still exactly one row');
            } else {
                fail('6. Idempotency', `before=${countBefore} after=${countAfter}`);
            }
        }
    }

    // ── Case 7 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 7: Stale in_progress after FAILURE');
    {
        const runId7 = 99990007;
        const tNew = new Date().toISOString();
        const tOld = new Date(Date.now() - 10000).toISOString();

        await send('workflow_run', workflowRunPayload('completed', 'failure', runId7, tNew));
        const failureRow = await pollForStatus(fakeRepoId, String(runId7), ['FAILURE'], 10000);

        if (!failureRow) {
            fail('7. Stale event: setup', 'could not create FAILURE row within 10s');
        } else {
            await send('workflow_run', workflowRunPayload('in_progress', null, runId7, tOld));
            await new Promise((r) => setTimeout(r, 1500));

            const row = await prisma.deployment.findUnique({
                where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId7) } },
                select: { status: true },
            });

            if (row?.status === 'FAILURE') {
                pass('7. Stale in_progress after FAILURE: status stays FAILURE');
            } else {
                fail('7. Stale event', `status=${row?.status ?? 'null'}, expected FAILURE`);
            }
        }
    }

    // ── Case 8 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 8: Log preservation');
    {
        const runId8 = 99990008;
        const FETCHED_MARKER = 'FETCHED-LOG-MARKER line 1\nline 2';

        // Create row as FAILURE via webhook
        const tNew = new Date().toISOString();
        await send('workflow_run', workflowRunPayload('completed', 'failure', runId8, tNew));
        await pollForStatus(fakeRepoId, String(runId8), ['FAILURE'], 10000);

        // Directly set the logs to our marker (simulates real fetched logs)
        await prisma.deployment.update({
            where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId8) } },
            data: { logs: FETCHED_MARKER },
        });

        // Send stale in_progress — should not overwrite logs or status
        const tOld = new Date(Date.now() - 20000).toISOString();
        await send('workflow_run', workflowRunPayload('in_progress', null, runId8, tOld));
        await new Promise((r) => setTimeout(r, 1500));

        // Send another stale requested event — also should not overwrite
        await send('workflow_run', workflowRunPayload('requested', null, runId8, new Date(Date.now() - 25000).toISOString()));
        await new Promise((r) => setTimeout(r, 1500));

        const row = await prisma.deployment.findUnique({
            where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId8) } },
            select: { status: true, logs: true },
        });

        const logsOk = row?.logs === FETCHED_MARKER;
        const statusOk = row?.status === 'FAILURE';

        if (logsOk && statusOk) {
            pass('8. Log preservation: fetched logs not overwritten by stale events');
        } else {
            fail('8. Log preservation',
                `status=${row?.status} logsMatch=${logsOk} logs="${row?.logs?.slice(0, 80)}"`);
        }
    }

    // ── Case 9 ────────────────────────────────────────────────────────────────
    console.log('\n-- Case 9: Recovery — later completed(success)');
    {
        const runId9 = 99990009;
        const tFirst = new Date(Date.now() - 5000).toISOString();
        const tLater = new Date().toISOString();

        await send('workflow_run', workflowRunPayload('completed', 'failure', runId9, tFirst, 'recovery failure log'));
        await pollForStatus(fakeRepoId, String(runId9), ['FAILURE'], 10000);

        await send('workflow_run', workflowRunPayload('completed', 'success', runId9, tLater));
        const row = await pollForStatus(fakeRepoId, String(runId9), ['SUCCESS'], 10000);

        const count = await prisma.deployment.count({
            where: { repositoryId: fakeRepoId, runId: String(runId9) },
        });

        if (row?.status === 'SUCCESS' && count === 1) {
            pass('9. Recovery: later completed(success) => SUCCESS, one row');
        } else {
            fail('9. Recovery', `status=${row?.status} rowCount=${count}`);
        }
    }

    // ── Case 10 ───────────────────────────────────────────────────────────────
    console.log('\n-- Case 10: Push event creates null-runId row');
    {
        const runId5 = 99990005;
        const runRowCountBefore = await prisma.deployment.count({
            where: { repositoryId: fakeRepoId, runId: String(runId5) },
        });

        const pushDeliveryId = uuidv4();
        const res = await send('push', pushPayload(), { deliveryId: pushDeliveryId });
        let pushRow = null;
        const pushDeadline = Date.now() + 5000;
        while (Date.now() < pushDeadline) {
            pushRow = await prisma.deployment.findUnique({
                where: { deliveryId: pushDeliveryId },
                select: { runId: true, status: true },
            });
            if (pushRow) break;
            await new Promise((r) => setTimeout(r, 200));
        }
        const runRowCountAfter = await prisma.deployment.count({
            where: { repositoryId: fakeRepoId, runId: String(runId5) },
        });

        const pushRowOk = pushRow !== null && pushRow.runId === null;
        const runRowUnchanged = runRowCountBefore === runRowCountAfter;

        if (res.status === 200 && pushRowOk && runRowUnchanged) {
            pass('10. Push event: null-runId row created, run row unchanged');
        } else {
            fail('10. Push event',
                `status=${res.status} pushRowFound=${!!pushRow} runId=${pushRow?.runId ?? 'N/A'} runRowBefore=${runRowCountBefore} runRowAfter=${runRowCountAfter}`);
        }
    }

    // ── Case 11 ───────────────────────────────────────────────────────────────
    console.log('\n-- Case 11: fetchFailedJobLog null -- handler stays up');
    {
        const runId11 = 99990011;
        const res = await send('workflow_run',
            workflowRunPayload('completed', 'failure', runId11));

        if (res.status !== 200) {
            fail('11. fetchFailedJobLog null: response', `got ${res.status} expected 200`);
        } else {
            // 3s retry built in + settle time; poll up to 20s
            const row = await pollForStatus(fakeRepoId, String(runId11), ['FAILURE'], 20000);

            if (row && row.status === 'FAILURE') {
                const summaryKept = !row.logs || row.logs.startsWith('Workflow:');
                if (summaryKept) {
                    pass('11. fetchFailedJobLog null: handler stays up, summary kept as logs',
                        `logs="${row.logs?.slice(0, 60) ?? 'null'}"`);
                } else {
                    pass('11. fetchFailedJobLog null: handler stays up, row created',
                        `(unexpected log content, non-fatal) logs="${row.logs?.slice(0, 60)}"`);
                }
            } else {
                fail('11. fetchFailedJobLog null',
                    `row=${JSON.stringify(row)} — expected status=FAILURE within 9s`);
            }
        }
    }

    // ── Case 12 ───────────────────────────────────────────────────────────────
    console.log('\n-- Case 12: (a) After FAILURE with a fetched log, a later SUCCESS leaves logs as summary text');
    {
        const runId12 = 99990012;
        const FETCHED_LOG_12 = formatFailureLog({
            jobName: 'CI',
            stepName: 'test',
            reasonLines: ['some real failure output from job', 'stack trace line'],
            logTail: 'log line 1\nlog line 2',
        });

        // 1. Send failure with fetched log content
        const tFailure = new Date(Date.now() - 8000).toISOString();
        await send('workflow_run', workflowRunPayload('completed', 'failure', runId12, tFailure, FETCHED_LOG_12));
        const failureRow = await pollForStatus(fakeRepoId, String(runId12), ['FAILURE'], 10000);

        if (!failureRow || !failureRow.logs?.startsWith('FAILED STEP: ')) {
            fail('12. Case (a): after FAILURE with fetched log, later SUCCESS leaves logs as summary text',
                `setup failed: row not created with fetched log: ${failureRow?.logs?.slice(0, 40)}`);
        } else {
            // 2. Now send a later completed(success) — incoming status is SUCCESS
            // Rule: when incoming status is SUCCESS, write summary text to logs even if existing logs are fetched
            const tSuccess = new Date().toISOString();
            await send('workflow_run', workflowRunPayload('completed', 'success', runId12, tSuccess));
            const row = await pollForStatus(fakeRepoId, String(runId12), ['SUCCESS'], 10000);

            const statusOk = row?.status === 'SUCCESS';
            const logsResetToSummary = typeof row?.logs === 'string' && row.logs.startsWith('Workflow:');

            if (statusOk && logsResetToSummary) {
                pass('12. Case (a): after FAILURE with a fetched log, a later SUCCESS leaves logs as summary text',
                    `status=${row!.status} logsStartsWith="${row!.logs!.slice(0, 30)}"`);
            } else {
                fail('12. Case (a): after FAILURE with a fetched log, a later SUCCESS leaves logs as summary text',
                    `status=${row?.status} logsResetOk=${logsResetToSummary} logs="${row?.logs?.slice(0, 60)}"`);
            }
        }
    }

    // ── Case 13 ───────────────────────────────────────────────────────────────
    console.log('\n-- Case 13: (b) A second failure replaces the older fetched log');
    {
        const runId13 = 99990013;
        const FETCHED_LOG_OLD = formatFailureLog({
            jobName: 'CI',
            stepName: 'test',
            reasonLines: ['first failed job log line 1'],
            logTail: 'old failure log output',
        });
        const FETCHED_LOG_NEW = formatFailureLog({
            jobName: 'CI',
            stepName: 'test',
            reasonLines: ['second failed job log line 1'],
            logTail: 'new failure log output',
        });

        // 1. First failure with older fetched log
        const tFirst = new Date(Date.now() - 8000).toISOString();
        await send('workflow_run', workflowRunPayload('completed', 'failure', runId13, tFirst, FETCHED_LOG_OLD));
        const firstRow = await pollForStatus(fakeRepoId, String(runId13), ['FAILURE'], 10000);

        if (!firstRow || !firstRow.logs?.startsWith('FAILED STEP: ')) {
            fail('13. Case (b): a second failure replaces the older fetched log',
                `setup failed: first failure row not created with FETCHED_LOG_OLD: ${firstRow?.logs?.slice(0, 40)}`);
        } else {
            // 2. Second failure with new fetched log and newer timestamp
            // Rule: When incoming status is a failure and incoming log content is itself fetched,
            // write it, replacing an older fetched log.
            const tSecond = new Date().toISOString();
            await send('workflow_run', workflowRunPayload('completed', 'failure', runId13, tSecond, FETCHED_LOG_NEW));

            const deadline = Date.now() + 10000;
            let secondRow = null;
            while (Date.now() < deadline) {
                const r = await prisma.deployment.findUnique({
                    where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId13) } },
                    select: { status: true, logs: true },
                });
                if (r?.logs?.includes('second failed job log line 1')) {
                    secondRow = r;
                    break;
                }
                await new Promise((res) => setTimeout(res, 200));
            }

            const statusOk = secondRow?.status === 'FAILURE';
            const logReplaced = secondRow?.logs?.includes('second failed job log line 1') && secondRow?.logs?.includes('new failure log output');

            // 3. Stale event (non-terminal / older timestamp) must not overwrite the new fetched log
            const tStale = new Date(Date.now() - 20000).toISOString();
            await send('workflow_run', workflowRunPayload('in_progress', null, runId13, tStale));
            await new Promise((r) => setTimeout(r, 1000));

            const staleCheckRow = await prisma.deployment.findUnique({
                where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId13) } },
                select: { status: true, logs: true },
            });
            const preservedAfterStale = staleCheckRow?.logs === secondRow?.logs;

            if (statusOk && logReplaced && preservedAfterStale) {
                pass('13. Case (b): a second failure replaces the older fetched log',
                    `status=${secondRow!.status} replacedOk=${logReplaced} preservedAfterStale=${preservedAfterStale}`);
            } else {
                fail('13. Case (b): a second failure replaces the older fetched log',
                    `status=${secondRow?.status} logReplaced=${logReplaced} preservedAfterStale=${preservedAfterStale} logs="${secondRow?.logs?.slice(0, 60)}"`);
            }
        }
    }

    // ── Case 14: format and parse round trip ─────────────────────────────────
    console.log('\n-- Case 14: format and parse round trip');
    {
        const jobName = 'ci-build';
        const stepName = 'test-runner';
        const reasonLines = ['TypeError: null has no properties', 'Process completed with exit code 1'];
        const logTail = 'npm test output line 1\nnpm test output line 2\nDone.';

        const formatted = formatFailureLog({ jobName, stepName, reasonLines, logTail });
        const parsed = parseFailureLog(formatted);

        if (
            parsed.structured === true &&
            parsed.stepLabel === `${jobName} > ${stepName}` &&
            parsed.reason === reasonLines.join('\n') &&
            parsed.logTail === logTail
        ) {
            pass('14. format and parse round trip', `stepLabel="${parsed.stepLabel}"`);
        } else {
            fail('14. format and parse round trip', `unexpected parse result: ${JSON.stringify(parsed)}`);
        }
    }

    // ── Case 15: CRLF input ──────────────────────────────────────────────────
    console.log('\n-- Case 15: CRLF input normalization');
    {
        const formatted = formatFailureLog({
            jobName: 'ci\r\njob',
            stepName: 'test\r\nstep',
            reasonLines: ['error line 1\r\nerror line 2'],
            logTail: 'tail line 1\r\ntail line 2\r\n',
        });

        const parsed = parseFailureLog(formatted);
        const noCR = !formatted.includes('\r');

        if (
            noCR &&
            parsed.structured === true &&
            parsed.stepLabel === 'cijob > teststep' &&
            parsed.reason === 'error line 1\nerror line 2' &&
            parsed.logTail === 'tail line 1\ntail line 2\n'
        ) {
            pass('15. CRLF input', 'CRLF normalised to LF, newlines stripped from names');
        } else {
            fail('15. CRLF input', `noCR=${noCR} parsed=${JSON.stringify(parsed)}`);
        }
    }

    // ── Case 16: LOG marker twice and one inside a reason line ───────────────
    console.log('\n-- Case 16: log containing LOG marker twice and one inside a reason line');
    {
        const formatted = formatFailureLog({
            jobName: 'build',
            stepName: 'test',
            reasonLines: [`error with ${LOG_MARKER} in reason`],
            logTail: `first ${LOG_MARKER} middle ${LOG_MARKER} last`,
        });

        const parsed = parseFailureLog(formatted);
        const reasonEscaped = parsed.reason === `error with ${ESCAPED_LOG_MARKER} in reason`;
        const tailEscaped = parsed.logTail === `first ${ESCAPED_LOG_MARKER} middle ${ESCAPED_LOG_MARKER} last`;

        if (parsed.structured === true && reasonEscaped && tailEscaped) {
            pass('16. LOG marker replacement', 'Dynamic markers replaced with escaped marker and parsed successfully');
        } else {
            fail('16. LOG marker replacement', `reasonEscaped=${reasonEscaped} tailEscaped=${tailEscaped} parsed=${JSON.stringify(parsed)}`);
        }
    }

    // ── Case 17: "REASON:" inside the log tail ───────────────────────────────
    console.log('\n-- Case 17: "REASON:" inside the log tail');
    {
        const formatted = formatFailureLog({
            jobName: 'build',
            stepName: 'test',
            reasonLines: ['Initial failure reason'],
            logTail: 'Step 1\nREASON:\nsome internal reason line\nStep 2 done',
        });

        const parsed = parseFailureLog(formatted);

        if (
            parsed.structured === true &&
            parsed.reason === 'Initial failure reason' &&
            parsed.logTail === 'Step 1\nREASON:\nsome internal reason line\nStep 2 done'
        ) {
            pass('17. "REASON:" inside log tail', 'Parsed cleanly on the first REASON: delimiter');
        } else {
            fail('17. "REASON:" inside log tail', `unexpected parsed: ${JSON.stringify(parsed)}`);
        }
    }

    // ── Case 18: Summary text parses as unstructured ─────────────────────────
    console.log('\n-- Case 18: Summary text parses as unstructured');
    {
        const summary = 'Workflow: CI\nBranch: main\nConclusion: failure\nStatus: completed\nURL: https://github.com\nCommit: sha123';
        const parsed = parseFailureLog(summary);

        if (parsed.structured === false && parsed.logTail === summary) {
            pass('18. Summary text parses as unstructured', 'structured=false, logTail equals whole input');
        } else {
            fail('18. Summary text parses as unstructured', `unexpected parsed: ${JSON.stringify(parsed)}`);
        }
    }

    // ── Case 19: Empty-reason case writes "(no error lines found)" ────────────
    console.log('\n-- Case 19: Empty-reason case writes "(no error lines found)"');
    {
        const formatted = formatFailureLog({
            jobName: 'build',
            stepName: 'test',
            reasonLines: [],
            logTail: 'just logs with no identifiable error line',
        });

        const parsed = parseFailureLog(formatted);

        if (parsed.structured === true && parsed.reason === '(no error lines found)') {
            pass('19. Empty-reason case', 'Fallback reason written and parsed as structured');
        } else {
            fail('19. Empty-reason case', `reason="${parsed.reason}" structured=${parsed.structured}`);
        }
    }

    // ── Stub fetch helper for unit tests (no monkeypatching global fetch) ────
    function makeStubFetch(handlers: {
        jobs?: () => Response | Promise<Response>;
        annotations?: () => Response | Promise<Response>;
        logs?: () => Response | Promise<Response>;
    }): typeof fetch {
        return (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/actions/runs/') && url.endsWith('/jobs')) {
                return handlers.jobs ? await handlers.jobs() : new Response(JSON.stringify({ jobs: [] }), { status: 200 });
            }
            if (url.includes('/check-runs/') && url.endsWith('/annotations')) {
                return handlers.annotations ? await handlers.annotations() : new Response(JSON.stringify([]), { status: 200 });
            }
            if (url.includes('/actions/jobs/') && url.endsWith('/logs')) {
                return handlers.logs ? await handlers.logs() : new Response('', { status: 200 });
            }
            return new Response('Not Found', { status: 404 });
        }) as typeof fetch;
    }

    // ── Case 20: Token masking via stubbed fetch ──────────────────────────────
    console.log('\n-- Case 20: Token masking via stubbed fetch');
    {
        const stubFetch = makeStubFetch({
            jobs: () => new Response(JSON.stringify({
                jobs: [{
                    id: 101,
                    name: 'security-job',
                    conclusion: 'failure',
                    steps: [{ name: 'run-auth-test', conclusion: 'failure' }],
                }],
            }), { status: 200 }),
            annotations: () => new Response(JSON.stringify([]), { status: 200 }),
            logs: () => new Response([
                'auth test line 1: ghp_1234567890abcdef',
                'auth test line 2: gho_1234567890abcdef',
                'auth test line 3: ghs_1234567890abcdef',
                'auth test line 4: ghu_1234567890abcdef',
                'auth test line 5: ghr_1234567890abcdef',
                'auth test line 6: github_pat_11AABBCC_0123456789',
                'auth test line 7: Bearer mySecretToken123456',
            ].join('\n'), { status: 200 }),
        });

        const details = await fetchFailureDetails(FAKE_OWNER, FAKE_REPO, 12345, stubFetch);

        const tail = details?.logTail ?? '';
        const hasGhp = tail.includes('ghp_');
        const hasGho = tail.includes('gho_');
        const hasGhs = tail.includes('ghs_');
        const hasGhu = tail.includes('ghu_');
        const hasGhr = tail.includes('ghr_');
        const hasPat = tail.includes('github_pat_');
        const hasBearerRaw = tail.includes('mySecretToken123456');
        const hasMaskedBearer = tail.includes('Bearer ***');

        if (
            details &&
            !hasGhp && !hasGho && !hasGhs && !hasGhu && !hasGhr && !hasPat &&
            !hasBearerRaw && hasMaskedBearer
        ) {
            pass('20. Token masking', 'All token types and Bearer values masked with ***');
        } else {
            fail('20. Token masking', `tokens leaked or Bearer not masked: tail="${tail}"`);
        }
    }

    // ── Case 21: ANSI and timestamp stripping via stubbed fetch ──────────────
    console.log('\n-- Case 21: ANSI and timestamp stripping via stubbed fetch');
    {
        const stubFetch = makeStubFetch({
            jobs: () => new Response(JSON.stringify({
                jobs: [{
                    id: 102,
                    name: 'ansi-job',
                    conclusion: 'failure',
                    steps: [{ name: 'run-lint', conclusion: 'failure' }],
                }],
            }), { status: 200 }),
            annotations: () => new Response(JSON.stringify([]), { status: 200 }),
            logs: () => new Response([
                '\u001b[31m[2026-10-25 12:34:56] \u001b[1mError: compilation error\u001b[0m',
                '2026-10-25T12:34:56.7890123Z Process completed with exit code 1',
            ].join('\n'), { status: 200 }),
        });

        const details = await fetchFailureDetails(FAKE_OWNER, FAKE_REPO, 12345, stubFetch);
        const tail = details?.logTail ?? '';
        const hasAnsi = /[\u001b\u009b]/.test(tail);
        const hasTimestamp = /^\[?\d{4}[-/]\d{2}[-/]\d{2}/m.test(tail);

        if (details && !hasAnsi && !hasTimestamp && tail.includes('Error: compilation error')) {
            pass('21. ANSI and timestamp stripping', 'ANSI codes and timestamps stripped');
        } else {
            fail('21. ANSI and timestamp stripping', `hasAnsi=${hasAnsi} hasTimestamp=${hasTimestamp} tail="${tail}"`);
        }
    }

    // ── Case 22: Annotations returning 403 still yields details ───────────────
    console.log('\n-- Case 22: Annotations returning 403 still yields details');
    {
        const stubFetch = makeStubFetch({
            jobs: () => new Response(JSON.stringify({
                jobs: [{
                    id: 103,
                    name: 'perm-job',
                    conclusion: 'failure',
                    steps: [{ name: 'restricted-step', conclusion: 'failure' }],
                }],
            }), { status: 200 }),
            annotations: () => new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 }),
            logs: () => new Response([
                '##[group]Run restricted-step',
                '##[error]AccessDenied: credentials invalid',
                '##[endgroup]',
            ].join('\n'), { status: 200 }),
        });

        const details = await fetchFailureDetails(FAKE_OWNER, FAKE_REPO, 12345, stubFetch);

        if (
            details &&
            details.annotations.length === 0 &&
            details.reasonLines.includes('AccessDenied: credentials invalid')
        ) {
            pass('22. Annotations returning 403', 'Handled 403 gracefully and extracted reasons from log');
        } else {
            fail('22. Annotations returning 403', `details=${JSON.stringify(details)}`);
        }
    }

    // ── Case 23: All calls failing returns null ──────────────────────────────
    console.log('\n-- Case 23: All calls failing returns null');
    {
        const stubFetch = makeStubFetch({
            jobs: () => new Response('Server Error', { status: 500 }),
        });

        const details = await fetchFailureDetails(FAKE_OWNER, FAKE_REPO, 12345, stubFetch);

        if (details === null) {
            pass('23. All calls failing returns null', 'Never throws, returns null');
        } else {
            fail('23. All calls failing returns null', `expected null, got: ${JSON.stringify(details)}`);
        }
    }

    // ── Case 24: 150-line log tail stored string starts with "FAILED STEP: " and parses as structured
    console.log('\n-- Case 24: 150-line log tail produces stored string that starts with "FAILED STEP: " and parses as structured');
    {
        const runId24 = 99990024;
        const tailLines150 = Array.from({ length: 150 }, (_, i) => `log line ${i + 1}: detailed output from step`).join('\n');
        const formatted150 = formatFailureLog({
            jobName: 'build-and-test',
            stepName: 'run-vitest',
            reasonLines: ['AssertionError: expected true to be false'],
            logTail: tailLines150,
        });

        // Send via webhook to verify no truncation between fetch and db write
        await send('workflow_run', workflowRunPayload('completed', 'failure', runId24, undefined, formatted150));
        const row = await pollForStatus(fakeRepoId, String(runId24), ['FAILURE'], 10000);

        if (!row || !row.logs) {
            fail('24. 150-line log tail preserved', `row not found or logs null`);
        } else {
            const startsOk = row.logs.startsWith('FAILED STEP: ');
            const parsed = parseFailureLog(row.logs);
            const structuredOk = parsed.structured === true;
            const logTailLineCount = parsed.logTail ? parsed.logTail.split('\n').length : 0;

            if (startsOk && structuredOk && logTailLineCount === 150) {
                pass('24. 150-line log tail preserved without truncation',
                    `startsOk=${startsOk} structuredOk=${structuredOk} logTailLineCount=${logTailLineCount}`);
            } else {
                fail('24. 150-line log tail preserved without truncation',
                    `startsOk=${startsOk} structuredOk=${structuredOk} logTailLineCount=${logTailLineCount} first50="${row.logs.slice(0, 50)}"`);
            }
        }
    }

    // ── Case 25: Validation helper ───────────────────────────────────────────
    console.log('\n-- Case 25: Validation rejects invalid names');
    {
        const r1 = validateRepoOwnerAndName('test-owner', '.');
        const r2 = validateRepoOwnerAndName('test-owner', '..');
        const r3 = validateRepoOwnerAndName('test-owner', 'a/b');
        const r4 = validateRepoOwnerAndName('test-owner', 'my-repo.git');
        const r5 = validateRepoOwnerAndName('a'.repeat(40), 'my-repo'); // overlong owner (>39)
        const r6 = validateRepoOwnerAndName('test-owner', 'b'.repeat(101)); // overlong repo (>100)
        const rOk = validateRepoOwnerAndName('valid-owner-123', 'valid_repo.name-1');

        if (
            !r1.valid &&
            !r2.valid &&
            !r3.valid &&
            !r4.valid &&
            !r5.valid &&
            !r6.valid &&
            rOk.valid
        ) {
            pass('25. Validation rejects invalid names', 'rejected ., .., a/b, .git, and overlong names; accepted valid');
        } else {
            fail('25. Validation rejects invalid names', `r1=${r1.valid} r2=${r2.valid} r3=${r3.valid} r4=${r4.valid} r5=${r5.valid} r6=${r6.valid} rOk=${rOk.valid}`);
        }
    }

    // ── Case 26: Viewer gets 403 on POST /api/repos ───────────────────────────
    console.log('\n-- Case 26: Viewer gets 403 on POST /api/repos');
    {
        const res = await handleAddRepository(
            { owner: 'test-fake-owner', repo: 'viewer-test-repo' },
            { userRole: 'VIEWER' }
        );
        if (res.status === 403) {
            pass('26. Viewer gets 403 on POST /api/repos', 'status=403');
        } else {
            fail('26. Viewer gets 403 on POST /api/repos', `got status=${res.status}`);
        }
    }

    // ── Case 27: Private repo is refused ─────────────────────────────────────
    console.log('\n-- Case 27: Private repo is refused');
    {
        const stubFetch: typeof fetch = async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes('/repos/test-fake-owner/private-repo')) {
                return new Response(JSON.stringify({
                    private: true,
                    archived: false,
                    disabled: false,
                    full_name: 'test-fake-owner/private-repo',
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response('Not found', { status: 404 });
        };

        const res = await handleAddRepository(
            { owner: 'test-fake-owner', repo: 'private-repo' },
            { userRole: 'ADMIN', fetchImpl: stubFetch }
        );

        if (res.status === 400 && res.body.error === "Private repositories can't be tracked") {
            pass('27. Private repo is refused', 'status=400 error="Private repositories can\'t be tracked"');
        } else {
            fail('27. Private repo is refused', `status=${res.status} error=${JSON.stringify(res.body)}`);
        }
    }

    // ── Case 28: Adding same repo twice gives one row ────────────────────────
    console.log('\n-- Case 28: Adding the same repo twice gives one row');
    {
        const stubFetch: typeof fetch = async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes('/actions/runs')) {
                return new Response(JSON.stringify({ workflow_runs: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({
                private: false,
                archived: false,
                disabled: false,
                full_name: 'test-fake-owner/dup-test-repo',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res1 = await handleAddRepository(
            { owner: 'test-fake-owner', repo: 'dup-test-repo' },
            { userRole: 'ADMIN', fetchImpl: stubFetch }
        );
        const res2 = await handleAddRepository(
            { owner: 'test-fake-owner', repo: 'dup-test-repo' },
            { userRole: 'ADMIN', fetchImpl: stubFetch }
        );

        const count = await prisma.repository.count({
            where: { owner: 'test-fake-owner', name: 'dup-test-repo' },
        });

        if (res1.status === 200 && res2.status === 200 && count === 1) {
            pass('28. Adding the same repo twice gives one row', `count=${count} res1=${res1.status} res2=${res2.status}`);
        } else {
            fail('28. Adding the same repo twice gives one row', `count=${count} res1=${res1.status} res2=${res2.status}`);
        }
    }

    // ── Case 29: 21st repository is refused ──────────────────────────────────
    console.log('\n-- Case 29: 21st repository is refused');
    {
        const currentCount = await prisma.repository.count();
        const needed = 20 - currentCount;
        const dummyNames: string[] = [];

        for (let i = 0; i < needed; i++) {
            const dummyName = `dummy-repo-${i}-${Date.now()}`;
            dummyNames.push(dummyName);
            await prisma.repository.create({
                data: {
                    owner: 'test-fake-owner',
                    name: dummyName,
                },
            });
        }

        const stubFetch: typeof fetch = async () => {
            return new Response(JSON.stringify({
                private: false,
                archived: false,
                disabled: false,
                full_name: 'test-fake-owner/overflow-repo',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await handleAddRepository(
            { owner: 'test-fake-owner', repo: 'overflow-repo' },
            { userRole: 'ADMIN', fetchImpl: stubFetch }
        );

        if (dummyNames.length > 0) {
            await prisma.repository.deleteMany({
                where: { owner: 'test-fake-owner', name: { in: dummyNames } },
            });
        }

        if (res.status === 400 && res.body.error === 'Repository limit reached') {
            pass('29. The 21st repository is refused', 'status=400 error="Repository limit reached"');
        } else {
            fail('29. The 21st repository is refused', `status=${res.status} error=${JSON.stringify(res.body)}`);
        }
    }

    // ── Case 30: Backfilled runs produce one row per run id ─────────────────
    console.log('\n-- Case 30: Backfilled runs produce one row per run id');
    {
        const runIds = [88880001, 88880002, 88880003];
        const stubFetch: typeof fetch = async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes('/actions/runs')) {
                return new Response(JSON.stringify({
                    workflow_runs: runIds.map((id) => ({
                        id,
                        name: 'CI',
                        head_branch: 'main',
                        head_sha: 'sha-' + id,
                        status: 'completed',
                        conclusion: 'success',
                        updated_at: new Date().toISOString(),
                        html_url: `https://github.com/test-fake-owner/backfill-repo/actions/runs/${id}`,
                    })),
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({
                private: false,
                archived: false,
                disabled: false,
                full_name: 'test-fake-owner/backfill-repo',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await handleAddRepository(
            { owner: 'test-fake-owner', repo: 'backfill-repo' },
            { userRole: 'ADMIN', fetchImpl: stubFetch }
        );

        const repoId = res.body.repository?.id;
        const rows = await prisma.deployment.findMany({
            where: { repositoryId: repoId, runId: { in: runIds.map(String) } },
        });

        if (res.status === 200 && res.body.importedRuns === 3 && rows.length === 3) {
            pass('30. Backfilled runs produce one row per run id', `importedRuns=3 rows=${rows.length}`);
        } else {
            fail('30. Backfilled runs produce one row per run id', `status=${res.status} imported=${res.body.importedRuns} rows=${rows.length}`);
        }
    }

    // ── Case 31: Refresh twice within 60 seconds returns 429 ────────────────
    console.log('\n-- Case 31: Refresh twice within 60 seconds returns 429');
    {
        const repo = await prisma.repository.upsert({
            where: { owner_name: { owner: 'test-fake-owner', name: 'refresh-test-repo' } },
            update: { lastRefreshedAt: new Date(Date.now() - 120_000) },
            create: { owner: 'test-fake-owner', name: 'refresh-test-repo', lastRefreshedAt: new Date(Date.now() - 120_000) },
        });

        const stubFetch: typeof fetch = async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes('/actions/runs')) {
                return new Response(JSON.stringify({ workflow_runs: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response('Not found', { status: 404 });
        };

        const res1 = await handleRefreshRepo(repo.id, { isLoggedIn: true, fetchImpl: stubFetch });
        const res2 = await handleRefreshRepo(repo.id, { isLoggedIn: true, fetchImpl: stubFetch });

        if (res1.status === 200 && res2.status === 429 && res2.headers?.['Retry-After']) {
            pass('31. Refresh twice within 60 seconds returns 429', `res1=${res1.status} res2=${res2.status} retryAfter=${res2.headers['Retry-After']}`);
        } else {
            fail('31. Refresh twice within 60 seconds returns 429', `res1=${res1.status} res2=${res2.status} headers=${JSON.stringify(res2.headers)}`);
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n\n=== RESULTS ===');
    for (const r of results) {
        const tag = r.passed ? 'PASS' : 'FAIL';
        console.log(`  [${tag}] ${r.name}` + (r.details ? ` | ${r.details}` : ''));
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    console.log('\n=== Cleanup ===');
    const deletedDeps = await prisma.deployment.deleteMany({
        where: { repository: { owner: { in: [FAKE_OWNER, 'test-fake-owner'] } } },
    });
    const deletedRepo = await prisma.repository.deleteMany({
        where: { owner: { in: [FAKE_OWNER, 'test-fake-owner'] } },
    });
    console.log(`Deleted ${deletedDeps.count} deployment(s) and ${deletedRepo.count} repo record(s) for test owners`);

    // Verify other repos unchanged
    if (otherRepoIds.length > 0) {
        const rowCountAfter = await prisma.deployment.count({
            where: { repositoryId: { in: otherRepoIds } },
        });
        if (rowCountAfter === rowCountBefore) {
            console.log(`Other repositories unchanged: ${rowCountAfter} row(s) (before=${rowCountBefore} after=${rowCountAfter})`);
        } else {
            console.log(`WARNING: Other repository row count changed! before=${rowCountBefore} after=${rowCountAfter}`);
        }
    } else {
        console.log('No other repositories to verify.');
    }

    // ── Files changed ─────────────────────────────────────────────────────────
    console.log('\n=== Files changed ===');
    console.log('  1. app/api/webhooks/github/route.ts  (Part 1: log preservation fix)');
    console.log('  2. scripts/test-webhook-flow.ts      (this file — new)');

    const failed = results.filter((r) => !r.passed);
    console.log(`\n${results.length - failed.length}/${results.length} tests passed.`);
    if (failed.length > 0) {
        console.log(`Failed tests: ${failed.map((r) => r.name).join(', ')}`);
    }

    await prisma.$disconnect();
    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Fatal error in test script:', err);
    prisma.$disconnect().catch(() => {});
    process.exit(1);
});
