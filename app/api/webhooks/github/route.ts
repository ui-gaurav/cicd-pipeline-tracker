import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyGitHubSignature } from '@/lib/github-verify';

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

        if (event === 'push') {
            const repoName = payload.repository?.name;
            const repoOwner = payload.repository?.owner?.name || payload.repository?.owner?.login;
            const ref = payload.ref || '';
            const branch = ref.replace('refs/heads/', '');
            const headCommit = payload.head_commit;

            if (!repoName || !repoOwner || !headCommit) {
                return NextResponse.json({ message: 'Push event missing commit details' }, { status: 200 });
            }

            // Branch-to-environment inference rule
            const environment = (branch === 'main' || branch === 'master') ? 'PRODUCTION' : 'STAGING';

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

            // Insert deployment log
            await prisma.deployment.create({
                data: {
                    commitSha: headCommit.id,
                    commitAuthor: headCommit.author?.name || 'Unknown',
                    branch,
                    environment,
                    status: 'SUCCESS',
                    logs: `Commit message: ${headCommit.message}\nTimestamp: ${headCommit.timestamp}`,
                    repositoryId: repository.id,
                },
            });

            return NextResponse.json({ success: true, event: 'push_recorded' }, { status: 201 });
        }

        return NextResponse.json({ message: `Ignored event: ${event}` }, { status: 200 });
    } catch (error: any) {
        return NextResponse.json(
            { error: 'Webhook processing failed', details: error.message },
            { status: 500 }
        );
    }
}