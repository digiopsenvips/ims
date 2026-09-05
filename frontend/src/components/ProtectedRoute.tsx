import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types';
import { ShieldAlert } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
  requiredPermission?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  requiredPermission,
}) => {
  const { user, isLoading, isMember, isMemberConfirmed, hasPermission } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-500 font-medium">Loading session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Member flow enforcement: Members directly use /sales-entry
  if (isMember && location.pathname !== '/sales-entry') {
    return <Navigate to="/sales-entry" replace />;
  }

  // Role check
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="bg-white p-6 rounded-lg border border-slate-200 max-w-md w-full text-center shadow-sm">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h2 className="text-base font-bold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-600 mt-1">
            Your current role (<span className="font-semibold">{user.role}</span>) does not have authorization to view this module.
          </p>
        </div>
      </div>
    );
  }

  // Head Granular Permission check
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="bg-white p-6 rounded-lg border border-slate-200 max-w-md w-full text-center shadow-sm">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h2 className="text-base font-bold text-slate-900">Permission Required</h2>
          <p className="text-sm text-slate-600 mt-1">
            Your account does not have the <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">{requiredPermission}</span> permission assigned. Please contact the Developer to request access.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
