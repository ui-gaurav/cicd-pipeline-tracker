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
import { PrismaClient } from '@prisma/client';

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
    maxMs = 5000
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
    maxMs = 5000
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
    console.log('\n=== Webhook Behavior Tests ===\n');

    // Count rows for other repos before we start
    const reposBefore = await prisma.repository.findMany({
        where: { NOT: { owner: FAKE_OWNER } },
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
        await send('workflow_run', workflowRunPayload('in_progress', null,      runId5, t1));
        await send('workflow_run', workflowRunPayload('completed',   'failure', runId5, t2));

        // fetchFailedJobLog for fake repo returns null, so there is a 3s retry + write time
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

        await send('workflow_run', workflowRunPayload('completed', 'failure', runId9, tFirst));
        await pollForStatus(fakeRepoId, String(runId9), ['FAILURE'], 10000);

        await send('workflow_run', workflowRunPayload('completed', 'success', runId9, tLater));
        await new Promise((r) => setTimeout(r, 2000));

        const row = await prisma.deployment.findUnique({
            where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId9) } },
            select: { status: true },
        });
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
        await new Promise((r) => setTimeout(r, 1500));

        const pushRow = await prisma.deployment.findUnique({
            where: { deliveryId: pushDeliveryId },
            select: { runId: true, status: true },
        });
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
            // 3s retry built in + settle time; poll up to 9s
            const row = await pollForStatus(fakeRepoId, String(runId11), ['FAILURE'], 9000);

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
        const FETCHED_MARKER_12 = 'FETCHED-LOG-MARKER-12\nsome real failure output from job\nstack trace line';

        // 1. Send failure with fetched log content
        const tFailure = new Date(Date.now() - 8000).toISOString();
        await send('workflow_run', workflowRunPayload('completed', 'failure', runId12, tFailure, FETCHED_MARKER_12));
        const failureRow = await pollForStatus(fakeRepoId, String(runId12), ['FAILURE'], 10000);

        if (!failureRow || failureRow.logs !== FETCHED_MARKER_12) {
            fail('12. Case (a): after FAILURE with fetched log, later SUCCESS leaves logs as summary text',
                `setup failed: row not created with fetched log: ${failureRow?.logs?.slice(0, 40)}`);
        } else {
            // 2. Now send a later completed(success) — incoming status is SUCCESS
            // Rule: when incoming status is SUCCESS, write summary text to logs even if existing logs are fetched
            const tSuccess = new Date().toISOString();
            await send('workflow_run', workflowRunPayload('completed', 'success', runId12, tSuccess));
            await new Promise((r) => setTimeout(r, 1500));

            const row = await prisma.deployment.findUnique({
                where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId12) } },
                select: { status: true, logs: true },
            });

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
        const FETCHED_LOG_OLD = 'FETCHED-LOG-MARKER-13-OLD\nfirst failed job log line 1\nline 2';
        const FETCHED_LOG_NEW = 'FETCHED-LOG-MARKER-13-NEW\nsecond failed job log line 1\nline 2';

        // 1. First failure with older fetched log
        const tFirst = new Date(Date.now() - 8000).toISOString();
        await send('workflow_run', workflowRunPayload('completed', 'failure', runId13, tFirst, FETCHED_LOG_OLD));
        const firstRow = await pollForStatus(fakeRepoId, String(runId13), ['FAILURE'], 10000);

        if (!firstRow || firstRow.logs !== FETCHED_LOG_OLD) {
            fail('13. Case (b): a second failure replaces the older fetched log',
                `setup failed: first failure row not created with FETCHED_LOG_OLD: ${firstRow?.logs?.slice(0, 40)}`);
        } else {
            // 2. Second failure with new fetched log and newer timestamp
            // Rule: When incoming status is a failure and incoming log content is itself fetched,
            // write it, replacing an older fetched log.
            const tSecond = new Date().toISOString();
            await send('workflow_run', workflowRunPayload('completed', 'failure', runId13, tSecond, FETCHED_LOG_NEW));
            await new Promise((r) => setTimeout(r, 1500));

            const secondRow = await prisma.deployment.findUnique({
                where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId13) } },
                select: { status: true, logs: true },
            });

            const statusOk = secondRow?.status === 'FAILURE';
            const logReplaced = secondRow?.logs === FETCHED_LOG_NEW;

            // 3. Stale event (non-terminal / older timestamp) must not overwrite the new fetched log
            const tStale = new Date(Date.now() - 20000).toISOString();
            await send('workflow_run', workflowRunPayload('in_progress', null, runId13, tStale));
            await new Promise((r) => setTimeout(r, 1000));

            const staleCheckRow = await prisma.deployment.findUnique({
                where: { repositoryId_runId: { repositoryId: fakeRepoId, runId: String(runId13) } },
                select: { status: true, logs: true },
            });
            const preservedAfterStale = staleCheckRow?.logs === FETCHED_LOG_NEW;

            if (statusOk && logReplaced && preservedAfterStale) {
                pass('13. Case (b): a second failure replaces the older fetched log',
                    `status=${secondRow!.status} replacedOk=${logReplaced} preservedAfterStale=${preservedAfterStale}`);
            } else {
                fail('13. Case (b): a second failure replaces the older fetched log',
                    `status=${secondRow?.status} logReplaced=${logReplaced} preservedAfterStale=${preservedAfterStale} logs="${secondRow?.logs?.slice(0, 60)}"`);
            }
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
        where: { repository: { owner: FAKE_OWNER, name: FAKE_REPO } },
    });
    const deletedRepo = await prisma.repository.deleteMany({
        where: { owner: FAKE_OWNER, name: FAKE_REPO },
    });
    console.log(`Deleted ${deletedDeps.count} deployment(s) and ${deletedRepo.count} repo record(s) for ${FAKE_OWNER}/${FAKE_REPO}`);

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
