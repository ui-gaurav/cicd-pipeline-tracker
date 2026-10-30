import { NextRequest, NextResponse, after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyGitHubSignature } from '@/lib/github-verify';
import { fetchFailureDetails, sanitizeLogLines } from '@/lib/github-api';
import { formatFailureLog, parseFailureLog } from '@/lib/failure-log';
import { upsertRun, truncateLogs, buildSummary, WorkflowRunLike } from '@/lib/deployments-sync';

export const maxDuration = 60;

// ─── Repository upsert helper ───────────────────────────────────────────────────
async function upsertRepo(owner: string, name: string) {
    return prisma.repository.upsert({
        where: { owner_name: { owner, name } },
        update: {},
        create: { owner, name },
    });
}

// ─── Event processing (runs inside after()) ─────────────────────────────────────
async function processWebhookEvent(
    event: string,
    deliveryId: string | null,
    payload: Record<string, unknown>
) {
    const repoPayload = payload.repository as Record<string, unknown> | undefined;
    const repoName = repoPayload?.name as string | undefined;
    const repoOwner = (repoPayload?.owner as Record<string, unknown> | undefined)?.login as string
        ?? (repoPayload?.owner as Record<string, unknown> | undefined)?.name as string
        ?? undefined;

    switch (event) {
        // ── Workflow run ──────────────────────────────────────────────────────
        case 'workflow_run': {
            const wr = payload.workflow_run as Record<string, unknown> | undefined;
            if (!repoName || !repoOwner || !wr) {
                return;
            }

            // (1) If workflow_run.id is missing, skip the event and log it instead of using an empty-string runId.
            if (wr.id == null || wr.id === '') {
                console.warn(`[webhook] Missing workflow_run.id (delivery: ${deliveryId ?? 'unknown'}), skipping event`);
                return;
            }

            const repository = await upsertRepo(repoOwner, repoName);

            const action = (payload.action as string) || '';
            const conclusion = ((wr.conclusion as string) || '').toLowerCase();
            const runId = String(wr.id);

            let logContent: string | undefined;

            if (action === 'completed' && (conclusion === 'failure' || conclusion === 'timed_out')) {
                if (process.env.NODE_ENV !== 'production' && typeof (wr as Record<string, unknown>)._test_logs === 'string') {
                    const rawTestLogs = (wr as Record<string, unknown>)._test_logs as string;
                    const parsed = parseFailureLog(rawTestLogs);
                    if (parsed.structured) {
                        const sanitizedTail = sanitizeLogLines(parsed.logTail).slice(-150).join('\n');
                        const labelParts = (parsed.stepLabel || '').split(' > ');
                        logContent = formatFailureLog({
                            jobName: labelParts[0] || (wr.name as string) || 'build',
                            stepName: labelParts[1] || 'test',
                            reasonLines: parsed.reason ? [parsed.reason] : [],
                            logTail: sanitizedTail,
                        });
                    } else {
                        const cleanedLines = sanitizeLogLines(rawTestLogs);
                        const logTail = cleanedLines.slice(-150).join('\n');
                        const errorRegex = /error|failed|exit code|cannot find|not assignable/i;
                        const reasons: string[] = [];
                        const seen = new Set<string>();
                        for (const line of cleanedLines) {
                            if (line.startsWith('##[error]')) {
                                const text = line.slice('##[error]'.length).trim();
                                if (text && !seen.has(text)) {
                                    seen.add(text);
                                    reasons.push(text);
                                    if (reasons.length >= 8) break;
                                }
                            }
                        }
                        if (reasons.length < 8) {
                            for (const line of cleanedLines) {
                                const text = line.startsWith('##[error]')
                                    ? line.slice('##[error]'.length).trim()
                                    : line.trim();
                                if (text && errorRegex.test(text) && !seen.has(text)) {
                                    seen.add(text);
                                    reasons.push(text);
                                    if (reasons.length >= 8) break;
                                }
                            }
                        }
                        logContent = formatFailureLog({
                            jobName: (wr.name as string) || 'build',
                            stepName: 'test',
                            reasonLines: reasons,
                            logTail,
                        });
                    }
                } else {
                    let details = await fetchFailureDetails(repoOwner, repoName, runId);
                    if (!details) {
                        await new Promise((resolve) => setTimeout(resolve, 3000));
                        details = await fetchFailureDetails(repoOwner, repoName, runId);
                    }
                    if (details) {
                        logContent = formatFailureLog(details);
                    }
                }
            }

            await upsertRun(repository.id, wr as unknown as WorkflowRunLike, {
                deliveryId,
                logs: logContent,
            });
            break;
        }

        // ── Push ──────────────────────────────────────────────────────────────
        case 'push': {
            const ref = (payload.ref as string) || '';
            const branch = ref.replace('refs/heads/', '');
            const headCommit = payload.head_commit as Record<string, unknown> | undefined;

            if (!repoName || !repoOwner || !headCommit) {
                return;
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
                    return;
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
            break;
        }

        default:
            break;
    }
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
        console.error('[webhook] GITHUB_WEBHOOK_SECRET is not set');
        return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    // 1. Verify HMAC before touching the payload; return 401 if invalid.
    if (!verifyGitHubSignature(rawBody, signature, secret)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse JSON only after signature is valid.
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'Bad request: invalid JSON' }, { status: 400 });
    }

    // Return 200 without doing anything for ping, check_suite, and any unhandled event types.
    if (event === 'ping' || event === 'check_suite' || !['workflow_run', 'push'].includes(event)) {
        return NextResponse.json({ ok: true });
    }

    // Move all event handling into after() from next/server.
    // Wrap in try/catch that logs event type and x-github-delivery id on failure.
    after(async () => {
        try {
            await processWebhookEvent(event, deliveryId, payload);
        } catch (err: unknown) {
            console.error(
                `[webhook] Failed to process event "${event}" with delivery ID "${deliveryId ?? 'unknown'}":`,
                err instanceof Error ? err.message : String(err)
            );
        }
    });

    // Return immediately; no await on Prisma or GitHub API before response.
    return NextResponse.json({ ok: true });
}