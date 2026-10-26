import { NextRequest, NextResponse, after } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyGitHubSignature } from '@/lib/github-verify';
import { fetchFailedJobLog } from '@/lib/github-api';

// ─── Status mapping & rank helpers ─────────────────────────────────────────────
// Maps GitHub workflow_run conclusions/statuses to our status enum.
function mapStatus(githubStatus: string | null | undefined): string {
    const s = (githubStatus ?? '').toLowerCase();
    if (s === 'queued' || s === 'in_progress' || s === 'waiting' || s === 'requested' || s === 'pending') {
        return 'PENDING';
    }
    if (s === 'success' || s === 'completed') {
        return 'SUCCESS';
    }
    if (s === 'failure' || s === 'timed_out' || s === 'cancelled' || s === 'action_required' || s === 'stale') {
        return 'FAILURE';
    }
    return 'PENDING';
}

function deriveStatus(status: string | null | undefined, conclusion: string | null | undefined): string {
    if (conclusion) return mapStatus(conclusion);
    return mapStatus(status);
}

function statusRank(status: string): number {
    const s = status.toUpperCase();
    if (s === 'PENDING' || s === 'QUEUED' || s === 'WAITING' || s === 'REQUESTED') return 1;
    if (s === 'RUNNING' || s === 'IN_PROGRESS') return 2;
    if (s === 'SUCCESS' || s === 'FAILURE' || s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT') return 3;
    return 0;
}

function isTerminalStatus(status: string): boolean {
    const s = status.toUpperCase();
    return s === 'SUCCESS' || s === 'FAILURE' || s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT';
}

function shouldUpdateStatus(
    existingStatus: string | null | undefined,
    incomingStatus: string,
    existingTimestamp?: Date | null,
    incomingUpdatedAt?: string | null
): boolean {
    if (!existingStatus) return true;

    const existingTerminal = isTerminalStatus(existingStatus);
    const incomingRank = statusRank(incomingStatus);
    const existingRank = statusRank(existingStatus);

    // Rule 1: Never overwrite a terminal status with PENDING or RUNNING
    if (existingTerminal && (incomingStatus === 'PENDING' || incomingStatus === 'RUNNING')) {
        return false;
    }

    // Rule 2: If timestamp comparison is available and incoming is older, don't overwrite
    if (existingTimestamp && incomingUpdatedAt) {
        const incomingTime = new Date(incomingUpdatedAt).getTime();
        const existingTime = existingTimestamp.getTime();
        if (!isNaN(incomingTime) && !isNaN(existingTime) && incomingTime < existingTime) {
            return false;
        }
    }

    // Rule 3: Never move backwards by rank (PENDING < RUNNING < SUCCESS/FAILED)
    if (incomingRank < existingRank) {
        return false;
    }

    return true;
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
            const runId = String(wr.id);

            const branch = (wr.head_branch as string) || '';
            const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';
            const status = deriveStatus(wr.status as string, wr.conclusion as string);

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

            // Idempotency: if this exact delivery was already processed, skip.
            if (deliveryId) {
                const existingDelivery = await prisma.deployment.findUnique({
                    where: { deliveryId },
                    select: { id: true },
                });
                if (existingDelivery) {
                    return;
                }
            }

            const action = (payload.action as string) || '';
            const conclusion = ((wr.conclusion as string) || '').toLowerCase();

            let logContent = logSummary;

            if (action === 'completed' && (conclusion === 'failure' || conclusion === 'timed_out')) {
                let realLog = await fetchFailedJobLog(repoOwner, repoName, runId);
                if (!realLog) {
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                    realLog = await fetchFailedJobLog(repoOwner, repoName, runId);
                }
                if (realLog) {
                    logContent = realLog;
                }
            }

            const updatedAt = (wr.updated_at as string) || undefined;
            const incomingDate = updatedAt ? new Date(updatedAt) : new Date();

            const doUpsert = async () => {
                const existing = await prisma.deployment.findUnique({
                    where: {
                        repositoryId_runId: {
                            repositoryId: repository.id,
                            runId,
                        },
                    },
                    select: {
                        status: true,
                        timestamp: true,
                        logs: true,
                    },
                });

                const updateStatus = shouldUpdateStatus(
                    existing?.status,
                    status,
                    existing?.timestamp,
                    updatedAt
                );

                // Treat existing logs as "fetched" (real failure logs) when they do not
                // start with the summary prefix "Workflow:". Never overwrite fetched logs
                // with summary text. Only update logs in the update branch when
                // shouldUpdateStatus is true.
                const existingLogsAreFetched =
                    typeof existing?.logs === 'string' &&
                    !existing.logs.startsWith('Workflow:');
                const logsUpdate = updateStatus
                    ? (existingLogsAreFetched ? existing!.logs : logContent)
                    : undefined;

                await prisma.deployment.upsert({
                    where: {
                        repositoryId_runId: {
                            repositoryId: repository.id,
                            runId,
                        },
                    },
                    create: {
                        deliveryId,
                        runId,
                        commitSha,
                        commitAuthor,
                        branch,
                        environment,
                        status,
                        logs: logContent,
                        timestamp: incomingDate,
                        repositoryId: repository.id,
                    },
                    update: {
                        deliveryId,
                        ...(logsUpdate !== undefined ? { logs: logsUpdate } : {}),
                        ...(updateStatus ? { status, timestamp: incomingDate } : {}),
                    },
                });
            };

            try {
                await doUpsert();
            } catch (err: unknown) {
                if (
                    err instanceof Prisma.PrismaClientKnownRequestError &&
                    err.code === 'P2002'
                ) {
                    // Retry once on P2002 unique constraint race condition
                    await doUpsert();
                } else {
                    throw err;
                }
            }
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