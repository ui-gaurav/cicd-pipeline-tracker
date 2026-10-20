import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyGitHubSignature } from '@/lib/github-verify';

// ─── Status mapping ────────────────────────────────────────────────────────────
// Maps GitHub workflow_run / check_suite conclusions/statuses to our status enum.
function mapStatus(githubStatus: string | null | undefined): string {
    const s = (githubStatus ?? '').toLowerCase();
    if (s === 'queued' || s === 'in_progress' || s === 'waiting' || s === 'requested' || s === 'pending') {
        return 'PENDING';
    }
    if (s === 'success' || s === 'completed') {
        // "completed" alone is not a conclusion – we check conclusion separately.
        // If the conclusion itself is "success" this is correct.
        return 'SUCCESS';
    }
    if (s === 'failure' || s === 'timed_out' || s === 'cancelled' || s === 'action_required' || s === 'stale') {
        return 'FAILURE';
    }
    return 'PENDING'; // safe default for unknown in-progress states
}

// More precise mapper that takes both status and conclusion fields.
function deriveStatus(status: string | null | undefined, conclusion: string | null | undefined): string {
    if (conclusion) return mapStatus(conclusion);
    return mapStatus(status);
}

// ─── Log helpers ────────────────────────────────────────────────────────────────
function truncateLogs(logs: string | null | undefined, maxLines = 150): string | null {
    if (!logs) return null;
    const lines = logs.split(/\r?\n/);
    if (lines.length <= maxLines) return logs;
    return lines.slice(-maxLines).join('\n');
}

function buildSummary(fields: Record<string, string | null | undefined>): string {
    return Object.entries(fields)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
}

// ─── Repository upsert helper ───────────────────────────────────────────────────
async function upsertRepo(owner: string, name: string) {
    return prisma.repository.upsert({
        where: { owner_name: { owner, name } },
        update: {},
        create: { owner, name },
    });
}

// ─── Main handler ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    // 1. Read raw body before anything else.
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const deliveryId = req.headers.get('x-github-delivery');
    const event = req.headers.get('x-github-event') ?? '';
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!secret) {
        // Config error – 500 is appropriate here; we can't do anything without the secret.
        console.error('[webhook] GITHUB_WEBHOOK_SECRET is not set');
        return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    // 2. Verify HMAC before touching the payload (already checks length + timingSafeEqual).
    if (!verifyGitHubSignature(rawBody, signature, secret)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 3. Parse JSON only after signature is valid.
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
        // Malformed JSON – not a 5xx, return 400 without leaking details.
        return NextResponse.json({ error: 'Bad request: invalid JSON' }, { status: 400 });
    }

    const repoPayload = payload.repository as Record<string, unknown> | undefined;
    const repoName = repoPayload?.name as string | undefined;
    const repoOwner = (repoPayload?.owner as Record<string, unknown> | undefined)?.login as string
        ?? (repoPayload?.owner as Record<string, unknown> | undefined)?.name as string
        ?? undefined;

    // ── Event switch ─────────────────────────────────────────────────────────────
    try {
        switch (event) {
            // ── Ping ──────────────────────────────────────────────────────────────
            case 'ping':
                return NextResponse.json({ ok: true, message: 'pong' }, { status: 200 });

            // ── Workflow run ──────────────────────────────────────────────────────
            case 'workflow_run': {
                const wr = payload.workflow_run as Record<string, unknown> | undefined;
                if (!repoName || !repoOwner || !wr) {
                    return NextResponse.json({ ok: true, message: 'ignored: missing fields' }, { status: 200 });
                }

                const branch = (wr.head_branch as string) || '';
                const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';
                const status = deriveStatus(wr.status as string, wr.conclusion as string);
                const runId = String(wr.id ?? '');

                const headCommit = wr.head_commit as Record<string, unknown> | undefined;
                const commitSha = (wr.head_sha as string) || 'unknown';
                const commitAuthor =
                    (headCommit?.author as Record<string, unknown> | undefined)?.name as string
                    ?? (wr.actor as Record<string, unknown> | undefined)?.login as string
                    ?? 'Unknown';

                const logSummary = truncateLogs(
                    buildSummary({
                        Workflow: wr.name as string,
                        Branch: branch,
                        Conclusion: wr.conclusion as string,
                        Status: wr.status as string,
                        URL: wr.html_url as string,
                        Commit: commitSha,
                    })
                );

                const repository = await upsertRepo(repoOwner, repoName);

                // 4. Idempotency: if we already processed this delivery, skip.
                if (deliveryId) {
                    const existing = await prisma.deployment.findUnique({
                        where: { deliveryId },
                        select: { id: true },
                    });
                    if (existing) {
                        return NextResponse.json({ ok: true, message: 'duplicate delivery ignored' }, { status: 200 });
                    }
                }

                // 5. Out-of-order: upsert by runId (same run, later event updates the row).
                if (runId) {
                    const byRunId = await prisma.deployment.findFirst({
                        where: { runId },
                        select: { id: true },
                    });
                    if (byRunId) {
                        await prisma.deployment.update({
                            where: { id: byRunId.id },
                            data: {
                                deliveryId,
                                status,
                                logs: logSummary,
                                // branch/env/sha/author don't change between run events
                            },
                        });
                        return NextResponse.json({ ok: true, event: 'workflow_run_updated' }, { status: 200 });
                    }
                }

                await prisma.deployment.create({
                    data: {
                        deliveryId,
                        runId,
                        commitSha,
                        commitAuthor,
                        branch,
                        environment,
                        status,
                        logs: logSummary,
                        repositoryId: repository.id,
                    },
                });

                return NextResponse.json({ ok: true, event: 'workflow_run_recorded' }, { status: 201 });
            }

            // ── Check suite ───────────────────────────────────────────────────────
            case 'check_suite': {
                const cs = payload.check_suite as Record<string, unknown> | undefined;
                if (!repoName || !repoOwner || !cs) {
                    return NextResponse.json({ ok: true, message: 'ignored: missing fields' }, { status: 200 });
                }

                const branch = (cs.head_branch as string) || '';
                const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';
                const status = deriveStatus(cs.status as string, cs.conclusion as string);
                const runId = `cs-${String(cs.id ?? '')}`;
                const commitSha = (cs.head_sha as string) || 'unknown';
                const headCommit = cs.head_commit as Record<string, unknown> | undefined;
                const commitAuthor =
                    (headCommit?.author as Record<string, unknown> | undefined)?.name as string
                    ?? (payload.sender as Record<string, unknown> | undefined)?.login as string
                    ?? 'Unknown';

                const logSummary = truncateLogs(
                    buildSummary({
                        'Check Suite ID': String(cs.id ?? ''),
                        Branch: branch,
                        Conclusion: cs.conclusion as string,
                        Status: cs.status as string,
                        Commit: commitSha,
                    })
                );

                const repository = await upsertRepo(repoOwner, repoName);

                // Idempotency check
                if (deliveryId) {
                    const existing = await prisma.deployment.findUnique({
                        where: { deliveryId },
                        select: { id: true },
                    });
                    if (existing) {
                        return NextResponse.json({ ok: true, message: 'duplicate delivery ignored' }, { status: 200 });
                    }
                }

                // Out-of-order: upsert by runId
                const byRunId = await prisma.deployment.findFirst({
                    where: { runId },
                    select: { id: true },
                });
                if (byRunId) {
                    await prisma.deployment.update({
                        where: { id: byRunId.id },
                        data: { deliveryId, status, logs: logSummary },
                    });
                    return NextResponse.json({ ok: true, event: 'check_suite_updated' }, { status: 200 });
                }

                await prisma.deployment.create({
                    data: {
                        deliveryId,
                        runId,
                        commitSha,
                        commitAuthor,
                        branch,
                        environment,
                        status,
                        logs: logSummary,
                        repositoryId: repository.id,
                    },
                });

                return NextResponse.json({ ok: true, event: 'check_suite_recorded' }, { status: 201 });
            }

            // ── Push (optional, keep existing behaviour) ──────────────────────────
            case 'push': {
                const ref = (payload.ref as string) || '';
                const branch = ref.replace('refs/heads/', '');
                const headCommit = payload.head_commit as Record<string, unknown> | undefined;

                if (!repoName || !repoOwner || !headCommit) {
                    return NextResponse.json({ ok: true, message: 'push: missing fields' }, { status: 200 });
                }

                const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';
                const commitSha = headCommit.id as string;
                const commitAuthor = (headCommit.author as Record<string, unknown> | undefined)?.name as string ?? 'Unknown';
                const rawLogs = buildSummary({
                    'Commit message': headCommit.message as string,
                    Timestamp: headCommit.timestamp as string,
                });

                // Idempotency: skip if this delivery was already processed.
                if (deliveryId) {
                    const existing = await prisma.deployment.findUnique({
                        where: { deliveryId },
                        select: { id: true },
                    });
                    if (existing) {
                        return NextResponse.json({ ok: true, message: 'duplicate delivery ignored' }, { status: 200 });
                    }
                }

                const repository = await upsertRepo(repoOwner, repoName);
                await prisma.deployment.create({
                    data: {
                        deliveryId,
                        commitSha,
                        commitAuthor,
                        branch,
                        environment,
                        status: 'SUCCESS',
                        logs: truncateLogs(rawLogs),
                        repositoryId: repository.id,
                    },
                });

                return NextResponse.json({ ok: true, event: 'push_recorded' }, { status: 201 });
            }

            // ── Anything else: acknowledge and ignore ──────────────────────────────
            default:
                return NextResponse.json({ ok: true, message: `ignored event: ${event}` }, { status: 200 });
        }
    } catch (err: unknown) {
        // Log without secrets; return 200 so GitHub doesn't retry (payload problem we can't fix).
        console.error('[webhook] processing error:', err instanceof Error ? err.message : String(err));
        return NextResponse.json({ ok: false, message: 'processing error' }, { status: 200 });
    }
}