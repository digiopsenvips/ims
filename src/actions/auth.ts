'use server';

import { redirect } from 'next/navigation';

import { auth, signIn, signOut } from '@/auth';
import { recordAuditEvent } from '@/lib/audit';

export async function loginAction(formData: FormData) {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  try {
    await signIn('credentials', {
      username,
      password,
      redirect: false,
    });
  } catch {
    redirect('/login?error=invalid');
  }

  const session = await auth();
  const role = session?.user?.role;

  if (session?.user?.id) {
    const userName = (session.user as { username?: string }).username ?? username;
    await recordAuditEvent({
      action: 'LOGIN',
      entityType: 'USER',
      entityId: session.user.id,
      metadata: { username: userName, role: role ?? 'UNKNOWN' },
    });
  }

  if (role === 'DEVELOPER' || role === 'ADMIN') {
    redirect('/admin');
  }

  redirect('/dashboard');
}

export async function logoutAction() {
  const session = await auth();

  if (session?.user?.id) {
    const userMeta = session.user as { username?: string; email?: string | null };
    await recordAuditEvent({
      action: 'LOGOUT',
      entityType: 'USER',
      entityId: session.user.id,
      metadata: { username: userMeta.username ?? userMeta.email ?? 'unknown' },
    });
  }

  await signOut({ redirectTo: '/login' });
}
