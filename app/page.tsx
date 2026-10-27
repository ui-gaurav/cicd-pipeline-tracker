import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import LoginForm, { type DemoAccount } from './LoginForm';

export default async function Home() {
  const session = await auth();

  // Already logged in — send to dashboard
  if (session?.user) {
    redirect('/dashboard');
  }

  // Build demo accounts from server-side env vars only
  // Credentials are never sent to the client as visible source; they are passed
  // as props from the server component and embedded in the rendered HTML only
  // when the env vars are set.
  const demoAccounts: DemoAccount[] = [];

  const viewerEmail = process.env.DEMO_VIEWER_EMAIL;
  const viewerPass = process.env.DEMO_VIEWER_PASSWORD;
  if (viewerEmail && viewerPass) {
    demoAccounts.push({
      label: 'Viewer',
      sublabel: 'Read Only',
      email: viewerEmail,
      password: viewerPass,
    });
  }

  // Admin demo only in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    const adminEmail = process.env.DEMO_ADMIN_EMAIL;
    const adminPass = process.env.DEMO_ADMIN_PASSWORD;
    if (adminEmail && adminPass) {
      demoAccounts.push({
        label: 'Admin',
        sublabel: 'Full Access',
        email: adminEmail,
        password: adminPass,
      });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <LoginForm demoAccounts={demoAccounts.length > 0 ? demoAccounts : undefined} />
    </div>
  );
}