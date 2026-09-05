import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { LogIn, KeyRound, User as UserIcon, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please enter both username and password');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const data = await api.post('/auth/login', { username, password });
      login(data.token, data.user);

      if (data.user.role === 'MEMBER') {
        navigate('/member-confirm', { replace: true });
      } else {
        navigate(from === '/login' ? '/dashboard' : from, { replace: true });
      }
    } catch (err: any) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-xl tracking-wider shadow-sm">
            E
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          Enactus VIPS-TC IMS
        </h2>
        <p className="mt-1 text-center text-xs text-slate-500">
          Inventory & Sales Management System (Tahsin & Upcycle)
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-sm border border-slate-200 rounded-lg">
          {error && (
            <div className="mb-5 p-3 rounded-md bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Username or Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="e.g. developer, admin, aarav_sharma"
                  required
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 disabled:opacity-50 cursor-pointer transition-colors"
            >
              <LogIn className="w-4 h-4" />
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Quick Demo Credentials */}
          <div className="mt-6 pt-6 border-t border-slate-200">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 text-center">
              Quick Role Switcher (Seeded Demo Accounts)
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => handleQuickFill('developer', 'Admin@123')}
                className="p-1.5 text-left border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-purple-900">Developer</div>
                <div className="text-[10px] text-slate-500">developer / Admin@123</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('admin', 'Admin@123')}
                className="p-1.5 text-left border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-blue-900">Admin</div>
                <div className="text-[10px] text-slate-500">admin / Admin@123</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('head_finance', 'Head@123')}
                className="p-1.5 text-left border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-emerald-900">Finance Head</div>
                <div className="text-[10px] text-slate-500">head_finance / Head@123</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('head_marketing', 'Head@123')}
                className="p-1.5 text-left border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-emerald-900">Marketing Head</div>
                <div className="text-[10px] text-slate-500">head_marketing / Head@123</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('head_production', 'Head@123')}
                className="p-1.5 text-left border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-emerald-900">Production Head</div>
                <div className="text-[10px] text-slate-500">head_production / Head@123</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('aarav_sharma', 'Member@123')}
                className="p-1.5 text-left border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-slate-900">Sales Member</div>
                <div className="text-[10px] text-slate-500">aarav_sharma / Member@123</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
