import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDeploymentsData } from '@/lib/deployments';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const repo = searchParams.get('repo');
  const envParam = searchParams.get('environment');
  const statusParam = searchParams.get('status');

  let environment: 'STAGING' | 'PRODUCTION' | null = null;
  if (envParam) {
    const upperEnv = envParam.toUpperCase();
    if (upperEnv === 'STAGING' || upperEnv === 'PRODUCTION') {
      environment = upperEnv;
    }
  }

  const data = await getDeploymentsData({
    repo,
    environment,
    status: statusParam,
  });

  return NextResponse.json(data);
}
