import { auth } from '@/auth';
import { getDeploymentsData } from '@/lib/deployments';
import DashboardClient from '@/components/DashboardClient';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login?callbackUrl=/dashboard');
  }

  // Server component for first render: read Prisma directly with no loading flash
  const initialData = await getDeploymentsData();
  // eslint-disable-next-line react-hooks/purity
  const serverNow = Date.now();

  return (
    <DashboardClient
      initialData={initialData}
      userRole={session.user.role}
      serverNow={serverNow}
    />
  );
}
