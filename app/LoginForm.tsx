'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

export interface DemoAccount {
  label: string;
  sublabel: string;
  email: string;
  password: string;
}

interface LoginFormProps {
  demoAccounts?: DemoAccount[];
}

function LoginFormInner({ demoAccounts }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Honour callbackUrl only if it starts with a single "/" (never "//" or full URL)
  const rawCallback = searchParams.get('callbackUrl') ?? '';
  const callbackUrl =
    rawCallback.startsWith('/') && !rawCallback.startsWith('//')
      ? rawCallback
      : '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (!res || res.error) {
        setError('Invalid email or password.');
        setLoading(false);
        return;
      }

      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError('Invalid email or password.');
      setLoading(false);
    }
  };

  const quickFill = (e: string, p: string) => {
    setEmail(e);
    setPassword(p);
  };

  return (
    <div
      style={{ border: '1px solid var(--border)', borderRadius: '2px' }}
      className="w-full max-w-sm bg-[var(--card)] p-6 space-y-5"
    >
      {/* Header */}
      <div className="space-y-1">
        <span className="section-label block">Access Control</span>
        <h1 className="font-mono text-base font-semibold text-[var(--foreground)]">
          CI/CD Pipeline Board
        </h1>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-[2px] border border-[var(--status-fail)] bg-[var(--status-fail)]/10 p-2 font-mono text-xs text-[var(--status-fail)]"
        >
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted-foreground)]"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@cicd.internal"
            className="w-full rounded-[2px] border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-xs text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted-foreground)]"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-[2px] border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-xs text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[2px] border border-[var(--foreground)] bg-[var(--foreground)] py-2 font-mono text-xs font-medium uppercase tracking-[0.08em] text-[var(--background)] transition-colors hover:bg-transparent hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1"
        >
          {loading ? 'Authenticating...' : 'Sign In'}
        </button>
      </form>

      {/* Demo accounts — only rendered when props were passed */}
      {demoAccounts && demoAccounts.length > 0 && (
        <div className="border-t border-[var(--border)] pt-4">
          <span className="section-label mb-2 block">Quick Fill</span>
          <div className={`grid gap-2 ${demoAccounts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {demoAccounts.map((acct) => (
              <button
                key={acct.email}
                type="button"
                onClick={() => quickFill(acct.email, acct.password)}
                className="rounded-[2px] border border-[var(--border)] p-2 text-left font-mono text-xs transition-colors hover:border-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1"
              >
                <div className="font-semibold text-[var(--foreground)]">{acct.label}</div>
                <div className="text-[10px] text-[var(--muted-foreground)]">{acct.sublabel}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Suspense boundary so useSearchParams() works at build time
import { Suspense } from 'react';

export default function LoginForm(props: LoginFormProps) {
  return (
    <Suspense
      fallback={
        <div
          style={{ border: '1px solid var(--border)', borderRadius: '2px' }}
          className="w-full max-w-sm bg-[var(--card)] p-6"
        >
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted-foreground)]">
            Loading...
          </p>
        </div>
      }
    >
      <LoginFormInner {...props} />
    </Suspense>
  );
}
