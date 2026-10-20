/**
 * scripts/send-test-webhook.ts
 *
 * Sends a test workflow_run webhook to the local dev server.
 *
 * Usage:
 *   npx tsx scripts/send-test-webhook.ts           # valid payload
 *   npx tsx scripts/send-test-webhook.ts --bad-sig # bad signature -> expect 401
 *   npx tsx scripts/send-test-webhook.ts --ping    # ping event -> expect 200 pong
 *
 * The script reads GITHUB_WEBHOOK_SECRET from .env (via --env-file) or the
 * current environment.  Run it as:
 *   node --env-file=.env node_modules/.bin/tsx scripts/send-test-webhook.ts
 * OR simply:
 *   npx tsx scripts/send-test-webhook.ts    (if .env is already in the shell)
 */

import crypto from 'crypto';

// ─── Config ─────────────────────────────────────────────────────────────────────
const TARGET = process.env.WEBHOOK_URL ?? 'http://localhost:3000/api/webhooks/github';
const SECRET = process.env.GITHUB_WEBHOOK_SECRET;

if (!SECRET) {
    console.error(
        'ERROR: GITHUB_WEBHOOK_SECRET is not set.\n' +
        'Run with: node --env-file=.env node_modules/.bin/tsx scripts/send-test-webhook.ts'
    );
    process.exit(1);
}

// ─── CLI flags ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const BAD_SIG = args.includes('--bad-sig');
const PING    = args.includes('--ping');

// ─── Helpers ─────────────────────────────────────────────────────────────────────
function sign(body: string, secret: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Build a realistic workflow_run payload (action can be "requested"|"completed"). */
function workflowRunPayload(action: 'requested' | 'completed', conclusion: string | null): object {
    const runId = Math.floor(Math.random() * 1_000_000_000);
    const deliveryId = crypto.randomUUID();
    return {
        _meta: { deliveryId }, // informational only
        action,
        workflow_run: {
            id: runId,
            name: 'CI / Tests',
            head_branch: 'main',
            head_sha: 'abc123def456' + runId.toString(16),
            status: action === 'completed' ? 'completed' : 'in_progress',
            conclusion,
            html_url: `https://github.com/example/myrepo/actions/runs/${runId}`,
            head_commit: {
                message: 'feat: add delivery-id idempotency',
                author: { name: 'Test User', email: 'test@example.com' },
            },
            actor: { login: 'test-user' },
        },
        repository: {
            name: 'myrepo',
            owner: { login: 'example' },
        },
        sender: { login: 'test-user' },
    };
}

function pingPayload(): object {
    return {
        zen: 'Keep it logically awesome.',
        hook_id: 12345,
        hook: { type: 'Repository', active: true },
    };
}

// ─── Send ─────────────────────────────────────────────────────────────────────────
async function send(event: string, body: object, useBadSig: boolean): Promise<void> {
    const bodyStr = JSON.stringify(body, null, 2);
    const deliveryId = crypto.randomUUID();
    const goodSig = sign(bodyStr, SECRET!);
    const signature = useBadSig ? 'sha256=deadbeefdeadbeef' : goodSig;

    console.log(`\n─── Sending ${event} ${useBadSig ? '(BAD signature)' : '(valid)'} ───`);
    console.log(`  → ${TARGET}`);
    console.log(`  X-GitHub-Delivery: ${deliveryId}`);
    console.log(`  Signature (first 20): ${signature.slice(0, 20)}…`);

    const res = await fetch(TARGET, {
        method: 'POST',
        headers: {
            'Content-Type':       'application/json',
            'X-GitHub-Event':     event,
            'X-GitHub-Delivery':  deliveryId,
            'X-Hub-Signature-256': signature,
        },
        body: bodyStr,
    });

    const text = await res.text();
    console.log(`  ← ${res.status} ${res.statusText}`);
    try {
        console.log('  Body:', JSON.parse(text));
    } catch {
        console.log('  Body (raw):', text.slice(0, 200));
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    if (PING) {
        await send('ping', pingPayload(), BAD_SIG);
        return;
    }

    if (BAD_SIG) {
        // Single bad-signature test
        await send('workflow_run', workflowRunPayload('completed', 'success'), true);
        return;
    }

    // 1. First delivery: queued → should return 201
    const firstPayload = workflowRunPayload('requested', null);
    const firstRunId = (firstPayload as { workflow_run: { id: number } }).workflow_run.id;
    console.log(`\n━━━ Test run ID: ${firstRunId} ━━━`);
    await send('workflow_run', firstPayload, false);

    // 2. Same delivery ID sent again → should return 200 "duplicate ignored"
    console.log('\n[Sending the SAME delivery again to test idempotency]');
    // Re-use the exact same object so the body is identical:
    await send('workflow_run', firstPayload, false);

    // 3. Completed event for the same run (different delivery, same run id) → update
    console.log('\n[Sending a completed event for the same run id → out-of-order update]');
    const completedPayload = { ...workflowRunPayload('completed', 'success') } as Record<string, unknown>;
    // Force same run id so the upsert matches:
    (completedPayload.workflow_run as Record<string, unknown>).id = firstRunId;
    await send('workflow_run', completedPayload, false);

    // 4. Failure scenario
    console.log('\n[Sending a failure workflow_run for a NEW run]');
    await send('workflow_run', workflowRunPayload('completed', 'failure'), false);

    // 5. Bad signature → should return 401
    console.log('\n[Sending bad signature → expect 401]');
    await send('workflow_run', workflowRunPayload('completed', 'success'), true);
}

main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
