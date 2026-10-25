import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import { getRepoDetailStats } from '@/lib/repo-stats';
import RepoDetailClient from '@/components/RepoDetailClient';

export const dynamic = 'force-dynamic';

export default async function RepoDashboardPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login?callbackUrl=/dashboard');
  }

  // Next.js 16: params is a Promise, await it
  const { repo: repoId } = await params;
  const initialData = await getRepoDetailStats(repoId);

  if (!initialData) {
    notFound();
  }

  return (
    <RepoDetailClient
      initialData={initialData}
      userRole={session.user.role}
    />
  );
}
