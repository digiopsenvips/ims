import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const routeRoles: Record<string, string[]> = {
  '/admin': ['DEVELOPER', 'ADMIN'],
  '/dashboard': ['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER'],
  '/member': ['DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER'],
};

export default auth((req) => {
  const pathname = req.nextUrl.pathname;

  if (pathname === '/login') {
    return NextResponse.next();
  }

  const protectedMatch = Object.entries(routeRoles).find(([route]) => pathname === route || pathname.startsWith(`${route}/`));

  if (!protectedMatch) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  const [route, allowedRoles] = protectedMatch;
  const userRole = req.auth.user?.role as string | undefined;

  if (!userRole || !allowedRoles.includes(userRole)) {
    const redirectPath = route === '/admin' ? '/dashboard' : '/login';
    return NextResponse.redirect(new URL(redirectPath, req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/login', '/dashboard/:path*', '/admin/:path*', '/member/:path*'],
};
