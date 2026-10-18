import { auth } from '@/auth';

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          CI/CD Dashboard
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Welcome back, {session?.user?.email}. Your role is{' '}
          <span className="font-semibold">{session?.user?.role}</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="p-6 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Authentication Status
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Logged in via NextAuth with JWT session. Role stored securely in token and session.
          </p>
          <div className="mt-4 text-xs font-mono bg-zinc-100 dark:bg-zinc-800 p-3 rounded">
            Role: {session?.user?.role}
          </div>
        </div>

        <div className="p-6 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Admin API Access
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {session?.user?.role === 'ADMIN'
              ? 'You have full access to /api/admin/* routes.'
              : 'Access to /api/admin/* will result in a 403 Forbidden response.'}
          </p>
        </div>

        <div className="p-6 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Repository API Access
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            GET requests to /api/repos/* are allowed for both roles. Non-GET requests require ADMIN role.
          </p>
        </div>
      </div>
    </div>
  );
}
