'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

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
        setError('Invalid email or password. Please try again.');
        setLoading(false);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-6 space-y-5 bg-[var(--card)] border border-[var(--border)] rounded-[2px]">
      <div className="space-y-1">
        <h1 className="text-lg font-medium text-[var(--foreground)]">
          Sign In
        </h1>
        <p className="text-xs text-[var(--muted-foreground)]">
          Enter your credentials to access the CI/CD Deployment Board
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 text-xs font-mono text-[var(--destructive)] border border-[var(--destructive)] bg-[var(--card)] rounded-[2px]"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-mono uppercase tracking-[0.08em] text-[var(--muted-foreground)] mb-1"
          >
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@cicd.internal"
            className="w-full px-3 py-1.5 text-xs font-mono border border-[var(--input)] bg-[var(--background)] text-[var(--foreground)] rounded-[2px] focus:outline-none focus:outline-2 focus:outline-[var(--ring)]"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-xs font-mono uppercase tracking-[0.08em] text-[var(--muted-foreground)] mb-1"
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
            className="w-full px-3 py-1.5 text-xs font-mono border border-[var(--input)] bg-[var(--background)] text-[var(--foreground)] rounded-[2px] focus:outline-none focus:outline-2 focus:outline-[var(--ring)]"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 text-xs font-mono uppercase tracking-[0.08em] rounded-[2px] text-[var(--primary-foreground)] bg-[var(--primary)] border border-[var(--primary)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity cursor-pointer"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <Suspense fallback={<div className="text-xs font-mono text-[var(--muted-foreground)]">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
