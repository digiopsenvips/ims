import { loginAction } from '@/actions/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const isError = resolvedSearchParams.error === 'invalid';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50/80 px-4 py-10">
      <div className="panel-card w-full max-w-md overflow-hidden p-0">
        <div className="bg-slate-900 px-6 py-5 text-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300">
            Enactus VIPS-TC
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-300">Inventory, event, and sales management</p>
        </div>

        <div className="p-7">
          <form action={loginAction} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium text-slate-700">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="developer"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="Password123!"
              />
            </div>

            {isError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Invalid username or password.
              </div>
            ) : null}

            <button type="submit" className="primary-button w-full">
              Sign in
            </button>
          </form>

          <p className="mt-6 text-xs leading-5 text-slate-500">
            Development accounts: developer / admin / finance-head / marketing-head /
            production-head / member-one, two, three
          </p>
        </div>
      </div>
    </main>
  );
}
