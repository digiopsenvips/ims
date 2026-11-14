import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Role } from '../types';
import { api, ApiError } from '../lib/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isMemberConfirmed: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  confirmMember: (updatedName?: string, updatedDepartment?: string | null, newToken?: string) => void;
  isDeveloper: boolean;
  isAdmin: boolean;
  isHead: boolean;
  isMember: boolean;
  hasPermission: (key: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('enactus_ims_user');
    try { return saved ? JSON.parse(saved) : null; } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('enactus_ims_token');
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isMemberConfirmed, setIsMemberConfirmed] = useState<boolean>(() => {
    return sessionStorage.getItem('enactus_member_confirmed') === 'true';
  });

  useEffect(() => {
    const verifyAuth = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const data = await api.get('/auth/me');
        if (data?.user) {
          setUser(data.user);
          localStorage.setItem('enactus_ims_user', JSON.stringify(data.user));
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) logout();
        else console.warn('Session could not be checked. Offline operations remain preserved.');
      } finally {
        setIsLoading(false);
      }
    };

    verifyAuth();

    const handleUnauthorized = () => logout();
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [token]);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('enactus_ims_token', newToken);
    localStorage.setItem('enactus_ims_user', JSON.stringify(newUser));
    // Reset member confirmation on new login so check-in screen is presented
    setIsMemberConfirmed(false);
    sessionStorage.removeItem('enactus_member_confirmed');
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setIsMemberConfirmed(false);
    localStorage.removeItem('enactus_ims_token');
    localStorage.removeItem('enactus_ims_user');
    sessionStorage.removeItem('enactus_member_confirmed');
  };

  const confirmMember = (updatedName?: string, updatedDepartment?: string | null, newToken?: string) => {
    setIsMemberConfirmed(true);
    sessionStorage.setItem('enactus_member_confirmed', 'true');
    if (newToken) {
      setToken(newToken);
      localStorage.setItem('enactus_ims_token', newToken);
    }
    if (user && updatedName) {
      const updatedUser: User = {
        ...user,
        name: updatedName,
        department: updatedDepartment !== undefined ? updatedDepartment : user.department,
      };
      setUser(updatedUser);
      localStorage.setItem('enactus_ims_user', JSON.stringify(updatedUser));
    }
  };

  const isDeveloper = user?.role === 'DEVELOPER';
  const isAdmin = user?.role === 'ADMIN';
  const isHead = user?.role === 'HEAD';
  const isMember = user?.role === 'MEMBER';

  const hasPermission = (permissionKey: string): boolean => {
    if (!user) return false;
    if (isDeveloper) return true;

    // Direct grant in user's permissions
    if (user.permissions?.[permissionKey] === true) return true;
    if (user.permissions?.[permissionKey] === false) return false;

    // Backward compatibility with legacy keys (8 keys)
    if (permissionKey.startsWith('inventory.view_') && user.permissions?.['view_inventory'] === true) return true;
    if ((permissionKey === 'inventory.bulk_intake' || permissionKey === 'inventory.adjust' || permissionKey === 'inventory.allocate') && user.permissions?.['edit_inventory'] === true) return true;
    if (permissionKey.startsWith('events.') && !permissionKey.includes('revenue') && user.permissions?.['edit_events'] === true) return true;
    if ((permissionKey === 'events.view' || permissionKey === 'events.view_stock') && (user.permissions?.['view_inventory'] === true || user.permissions?.['edit_events'] === true)) return true;
    if (permissionKey.includes('revenue') && user.permissions?.['view_revenue'] === true) return true;
    if (permissionKey.includes('customer_pii') && user.permissions?.['view_customer_pii'] === true) return true;
    if (permissionKey === 'analytics.access' && user.permissions?.['view_analytics'] === true) return true;
    if (permissionKey === 'analytics.view_operational' && user.permissions?.['view_analytics'] === true) return true;
    if (permissionKey === 'analytics.view_financial' && user.permissions?.['view_revenue'] === true && user.permissions?.['view_analytics'] === true) return true;
    if (permissionKey === 'events.view_revenue' && user.permissions?.['view_revenue'] === true) return true;
    if (permissionKey === 'sales.view_revenue' && user.permissions?.['view_revenue'] === true) return true;
    if (permissionKey === 'sales.view_amounts' && user.permissions?.['view_revenue'] === true) return true;
    if (permissionKey.includes('export') && user.permissions?.['export_data'] === true) return true;

    // Role-based defaults when permissions aren't explicitly assigned
    if (isAdmin) {
      // Admin gets operational access by default; financial permissions must be explicitly checked
      if (permissionKey.startsWith('dashboard.') && !permissionKey.includes('revenue') && !permissionKey.includes('financial')) return true;
      if (permissionKey.startsWith('events.')) return true;
      if (permissionKey.startsWith('products.')) return true;
      if (permissionKey.startsWith('inventory.')) return true;
      if (permissionKey.startsWith('combos.')) return true;
      if (permissionKey.startsWith('sales.') && !permissionKey.includes('revenue') && !permissionKey.includes('amounts')) return true;
      if (permissionKey.startsWith('special_sales.')) return true;
      if (permissionKey.startsWith('games.')) return true;
      if (permissionKey.startsWith('users.')) return true;
      if (permissionKey.startsWith('whatsapp.')) return true;
      if (permissionKey === 'analytics.access' || permissionKey === 'analytics.view_operational') return true;
      // Admin gets financial permissions unless explicitly revoked
      return true;
    }

    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isMemberConfirmed,
        login,
        logout,
        confirmMember,
        isDeveloper,
        isAdmin,
        isHead,
        isMember,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
