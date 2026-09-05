import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserCheck, ShieldCheck, ArrowRight, LogOut } from 'lucide-react';

export const MemberNameConfirmPage: React.FC = () => {
  const { user, confirmMember, logout } = useAuth();
  const navigate = useNavigate();

  const handleConfirm = () => {
    confirmMember();
    navigate('/sales-entry', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-sm border border-slate-200 rounded-lg text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-4">
            <UserCheck className="w-7 h-7" />
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            Confirm Your Volunteer Identity
          </h2>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            Every sale you record today will be automatically attributed to you in the live sales ledger and audit logs.
          </p>

          <div className="mt-6 p-4 rounded-md bg-slate-50 border border-slate-200 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Active Member Profile
            </div>
            <div className="text-base font-bold text-slate-900 mt-1">
              {user?.name}
            </div>
            <div className="text-xs text-slate-600 font-mono mt-0.5">
              @{user?.username} &bull; {user?.email || 'No email registered'}
            </div>
            <div className="mt-2.5 flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verified Enactus VIPS-TC Sales Volunteer</span>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <button
              onClick={handleConfirm}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-md shadow-sm text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-600 transition-colors cursor-pointer"
            >
              <span>Yes, this is me — Enter Sales Portal</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Not you? Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
