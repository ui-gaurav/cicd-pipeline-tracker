import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Do NOT protect /api/webhooks/github, /login, or /api/auth
  if (
    pathname.startsWith('/api/webhooks/github') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/login'
  ) {
    return NextResponse.next();
  }

  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;

  // Unauthenticated users go to /login for everything under /dashboard
  if (pathname.startsWith('/dashboard')) {
    if (!isLoggedIn) {
      const loginUrl = new URL('/login', req.nextUrl.origin);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // VIEWER gets a 403 JSON response on /api/admin/* (ADMIN is allowed)
  if (pathname.startsWith('/api/admin')) {
    if (!isLoggedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (role === 'VIEWER' || role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // VIEWER gets a 403 JSON response on any non-GET request under /api/repos/* (ADMIN is allowed)
  if (pathname.startsWith('/api/repos')) {
    if (req.method !== 'GET') {
      if (!isLoggedIn) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (role === 'VIEWER' || role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/admin/:path*',
    '/api/repos/:path*',
  ],
};
