import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// ─── Status mapping & rank helpers ─────────────────────────────────────────────
// Maps GitHub workflow_run conclusions/statuses to our status enum.
export function mapStatus(githubStatus: string | null | undefined): string {
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

export function deriveStatus(status: string | null | undefined, conclusion: string | null | undefined): string {
    if (conclusion) return mapStatus(conclusion);
    return mapStatus(status);
}

export function statusRank(status: string): number {
    const s = status.toUpperCase();
    if (s === 'PENDING' || s === 'QUEUED' || s === 'WAITING' || s === 'REQUESTED') return 1;
    if (s === 'RUNNING' || s === 'IN_PROGRESS') return 2;
    if (s === 'SUCCESS' || s === 'FAILURE' || s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT') return 3;
    return 0;
}

export function isTerminalStatus(status: string): boolean {
    const s = status.toUpperCase();
    return s === 'SUCCESS' || s === 'FAILURE' || s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT';
}

export function shouldUpdateStatus(
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
export function truncateLogs(logs: string | null | undefined, maxLines = 150): string | null {
    if (!logs) return null;
    const lines = logs.split(/\r?\n/);
    if (lines.length <= maxLines) return logs;
    return lines.slice(-maxLines).join('\n');
}

export function buildSummary(fields: Record<string, string | null | undefined>): string {
    return Object.entries(fields)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
}

// ─── Workflow Run shape ────────────────────────────────────────────────────────
export interface WorkflowRunLike {
    id: string | number;
    name?: string | null;
    head_branch?: string | null;
    head_sha?: string | null;
    status?: string | null;
    conclusion?: string | null;
    updated_at?: string | null;
    html_url?: string | null;
    head_commit?: {
        message?: string | null;
        author?: {
            name?: string | null;
            email?: string | null;
        } | null;
    } | null;
    actor?: {
        login?: string | null;
    } | null;
    _test_logs?: string | null;
}

export interface UpsertRunOptions {
    deliveryId?: string | null;
    logs?: string | null;
}

/**
 * Upserts a workflow run deployment row obeying all status, timestamp,
 * log-preservation, and deliveryId idempotency rules.
 */
export async function upsertRun(
    repositoryId: string,
    run: WorkflowRunLike,
    options?: UpsertRunOptions
) {
    if (run.id == null || run.id === '') {
        return null;
    }

    const deliveryId = options?.deliveryId ?? null;

    // Idempotency: if this exact delivery was already processed, skip.
    if (deliveryId) {
        const existingDelivery = await prisma.deployment.findUnique({
            where: { deliveryId },
            select: { id: true },
        });
        if (existingDelivery) {
            return null;
        }
    }

    const runId = String(run.id);
    const branch = run.head_branch || '';
    const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';
    const status = deriveStatus(run.status, run.conclusion);

    const headCommit = run.head_commit;
    const commitSha = run.head_sha || 'unknown';
    const commitAuthor =
        headCommit?.author?.name
        ?? run.actor?.login
        ?? 'Unknown';

    const logSummary = truncateLogs(
        buildSummary({
            Workflow: run.name ?? undefined,
            Branch: branch,
            Conclusion: run.conclusion ?? undefined,
            Status: run.status ?? undefined,
            URL: run.html_url ?? undefined,
            Commit: commitSha,
        })
    );

    const logContent = options?.logs !== undefined ? options.logs : logSummary;
    const updatedAt = run.updated_at || undefined;
    const incomingDate = updatedAt ? new Date(updatedAt) : new Date();

    const doUpsert = async () => {
        const existing = await prisma.deployment.findUnique({
            where: {
                repositoryId_runId: {
                    repositoryId,
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

        // Log-overwrite rules:
        //   • Never overwrite logs on stale or non-terminal events.
        //   • SUCCESS always writes summary text even if existing logs were fetched failure logs.
        //   • Failure with fetched incoming log content (does not start with "Workflow:")
        //     writes it, replacing an older fetched log.
        //   • Otherwise keep existing fetched failure logs (never clobber with summary).
        const isTerminal = isTerminalStatus(status);
        const isFailure = status === 'FAILURE' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT';
        const existingLogsAreFetched =
            typeof existing?.logs === 'string' &&
            !existing.logs.startsWith('Workflow:');
        const incomingLogIsFetched =
            typeof logContent === 'string' &&
            !logContent.startsWith('Workflow:');

        let logsUpdate: string | null | undefined;
        if (!updateStatus || !isTerminal) {
            logsUpdate = undefined; // stale or non-terminal — never touch logs
        } else if (status === 'SUCCESS') {
            logsUpdate = logSummary; // SUCCESS always writes summary text
        } else if (isFailure && incomingLogIsFetched) {
            logsUpdate = logContent; // failure with fetched log replaces older fetched log
        } else if (existingLogsAreFetched) {
            logsUpdate = undefined; // keep existing fetched log, never overwrite with summary
        } else {
            logsUpdate = logContent; // write incoming summary
        }

        return await prisma.deployment.upsert({
            where: {
                repositoryId_runId: {
                    repositoryId,
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
                repositoryId,
            },
            update: {
                deliveryId,
                ...(logsUpdate !== undefined ? { logs: logsUpdate } : {}),
                ...(updateStatus ? { status, timestamp: incomingDate } : {}),
            },
        });
    };

    try {
        return await doUpsert();
    } catch (err: unknown) {
        if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
        ) {
            // Retry once on P2002 unique constraint race condition
            return await doUpsert();
        }
        throw err;
    }
}
