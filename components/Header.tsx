import { auth, signOut } from '@/auth';
import Link from 'next/link';

export async function Header() {
  const session = await auth();

  return (
    <header className="border-b border-[var(--border)] bg-[var(--card)] px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="text-base font-medium text-[var(--foreground)] tracking-tight"
          >
            CI/CD Board
          </Link>
          <nav className="hidden sm:flex items-center gap-4 text-xs font-mono uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
            <Link href="/dashboard" className="hover:text-[var(--foreground)] transition-colors">
              Dashboard
            </Link>
          </nav>
        </div>

        {session?.user ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted-foreground)] font-mono">
              {session.user.email}
            </span>
            <span
              className="px-2 py-0.5 rounded-[2px] text-[11px] font-mono uppercase border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
            >
              {session.user.role}
            </span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button
                type="submit"
                className="text-[11px] font-mono uppercase tracking-[0.08em] border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] px-2.5 py-1 rounded-[2px] transition-colors cursor-pointer"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-xs font-mono uppercase border border-[var(--border)] px-2.5 py-1 rounded-[2px] text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

export default Header;
