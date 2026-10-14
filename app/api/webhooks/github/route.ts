import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyGitHubSignature } from '@/lib/github-verify';

function truncateLogs(logs: string | null | undefined, maxLines = 150): string | null {
    if (!logs) return null;
    const lines = logs.split(/\r?\n/);
    if (lines.length <= maxLines) return logs;
    return lines.slice(-maxLines).join('\n');
}

export async function POST(req: NextRequest) {
    try {
        // 1. Raw body as string for HMAC verification
        const rawBody = await req.text();
        const signature = req.headers.get('x-hub-signature-256');
        const secret = process.env.GITHUB_WEBHOOK_SECRET;

        if (!secret) {
            return NextResponse.json(
                { error: 'Server configuration error: missing GITHUB_WEBHOOK_SECRET' },
                { status: 500 }
            );
        }

        // 2. Reject invalid or missing signatures with 401 Unauthorized
        const isValid = verifyGitHubSignature(rawBody, signature, secret);
        if (!isValid) {
            return NextResponse.json(
                { error: 'Unauthorized: Invalid or missing HMAC signature' },
                { status: 401 }
            );
        }

        // 3. Parse JSON after signature verification
        const payload = JSON.parse(rawBody);
        const event = req.headers.get('x-github-event');

        const repoName = payload.repository?.name;
        const repoOwner = payload.repository?.owner?.name || payload.repository?.owner?.login;

        if (event === 'push') {
            const ref = payload.ref || '';
            const branch = ref.replace('refs/heads/', '');
            const headCommit = payload.head_commit;

            if (!repoName || !repoOwner || !headCommit) {
                return NextResponse.json({ message: 'Push event missing commit details' }, { status: 200 });
            }

            // Environment inference: branch main -> PRODUCTION, any other branch -> STAGING
            const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';

            // Ensure repository exists
            const repository = await prisma.repository.upsert({
                where: {
                    owner_name: {
                        owner: repoOwner,
                        name: repoName,
                    },
                },
                update: {},
                create: {
                    name: repoName,
                    owner: repoOwner,
                },
            });

            const rawLogs = typeof payload.logs === 'string'
                ? payload.logs
                : `Commit message: ${headCommit.message}\nTimestamp: ${headCommit.timestamp}`;

            // Insert deployment log truncated to the last 150 lines
            await prisma.deployment.create({
                data: {
                    commitSha: headCommit.id,
                    commitAuthor: headCommit.author?.name || 'Unknown',
                    branch,
                    environment,
                    status: 'SUCCESS',
                    logs: truncateLogs(rawLogs),
                    repositoryId: repository.id,
                },
            });

            return NextResponse.json({ success: true, event: 'push_recorded' }, { status: 201 });
        }

        if (event === 'workflow_run') {
            const workflowRun = payload.workflow_run;

            if (!repoName || !repoOwner || !workflowRun) {
                return NextResponse.json({ message: 'workflow_run event missing details' }, { status: 200 });
            }

            const branch = workflowRun.head_branch || '';
            const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';

            const repository = await prisma.repository.upsert({
                where: {
                    owner_name: {
                        owner: repoOwner,
                        name: repoName,
                    },
                },
                update: {},
                create: {
                    name: repoName,
                    owner: repoOwner,
                },
            });

            const status = (workflowRun.conclusion || workflowRun.status || 'UNKNOWN').toUpperCase();
            const rawLogs = typeof payload.logs === 'string'
                ? payload.logs
                : `Workflow: ${workflowRun.name}\nConclusion: ${workflowRun.conclusion}\nStatus: ${workflowRun.status}\nCommit: ${workflowRun.head_commit?.message || ''}`;

            await prisma.deployment.create({
                data: {
                    commitSha: workflowRun.head_sha || 'unknown',
                    commitAuthor: workflowRun.head_commit?.author?.name || workflowRun.actor?.login || 'Unknown',
                    branch,
                    environment,
                    status,
                    logs: truncateLogs(rawLogs),
                    repositoryId: repository.id,
                },
            });

            return NextResponse.json({ success: true, event: 'workflow_run_recorded' }, { status: 201 });
        }

        if (event === 'check_run') {
            const checkRun = payload.check_run;

            if (!repoName || !repoOwner || !checkRun) {
                return NextResponse.json({ message: 'check_run event missing details' }, { status: 200 });
            }

            const branch = checkRun.check_suite?.head_branch || '';
            const environment = branch === 'main' ? 'PRODUCTION' : 'STAGING';

            const repository = await prisma.repository.upsert({
                where: {
                    owner_name: {
                        owner: repoOwner,
                        name: repoName,
                    },
                },
                update: {},
                create: {
                    name: repoName,
                    owner: repoOwner,
                },
            });

            const status = (checkRun.conclusion || checkRun.status || 'UNKNOWN').toUpperCase();
            const checkOutput = [checkRun.output?.title, checkRun.output?.summary, checkRun.output?.text]
                .filter(Boolean)
                .join('\n');
            const rawLogs = typeof payload.logs === 'string'
                ? payload.logs
                : checkOutput || `Check Run: ${checkRun.name}\nStatus: ${checkRun.status}\nConclusion: ${checkRun.conclusion}`;

            await prisma.deployment.create({
                data: {
                    commitSha: checkRun.head_sha || 'unknown',
                    commitAuthor: payload.sender?.login || 'Unknown',
                    branch,
                    environment,
                    status,
                    logs: truncateLogs(rawLogs),
                    repositoryId: repository.id,
                },
            });

            return NextResponse.json({ success: true, event: 'check_run_recorded' }, { status: 201 });
        }

        return NextResponse.json({ message: `Ignored event: ${event}` }, { status: 200 });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: 'Webhook processing failed', details: errorMessage },
            { status: 500 }
        );
    }
}