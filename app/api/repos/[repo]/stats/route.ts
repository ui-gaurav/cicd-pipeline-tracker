import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepoDetailStats } from '@/lib/repo-stats';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repo: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { repo: repoId } = await params;
  const data = await getRepoDetailStats(repoId);

  if (!data) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
