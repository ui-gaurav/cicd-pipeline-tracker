import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Never protect the GitHub webhook or auth endpoints.
  if (
    pathname.startsWith('/api/webhooks/github') ||
    pathname.startsWith('/api/auth')
  ) {
    return NextResponse.next();
  }

  // /login is an alias — redirect to / which hosts the login form
  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  }

  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;

  // Dashboard pages: unauthenticated users go to /
  if (pathname.startsWith('/dashboard')) {
    if (!isLoggedIn) {
      const loginUrl = new URL('/', req.nextUrl.origin);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Admin-only API: 401 if logged out, 403 for anyone who is not ADMIN
  if (pathname.startsWith('/api/admin')) {
    if (!isLoggedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Repos API: any logged-in user can read (GET) and call refresh (POST /api/repos/:id/refresh), only ADMIN can write
  if (pathname.startsWith('/api/repos')) {
    if (!isLoggedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isRefresh = req.method === 'POST' && /\/api\/repos\/[^/]+\/refresh\/?$/.test(pathname);
    if (req.method !== 'GET' && !isRefresh && role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Deployments API: requires auth (401 if logged out)
  if (pathname.startsWith('/api/deployments')) {
    if (!isLoggedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/login',
    '/dashboard/:path*',
    '/api/admin/:path*',
    '/api/repos/:path*',
    '/api/deployments/:path*',
  ],
};