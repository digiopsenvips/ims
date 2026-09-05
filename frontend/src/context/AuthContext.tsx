import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Role } from '../types';
import { api } from '../lib/api';

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
    return saved ? JSON.parse(saved) : null;
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
        console.warn('Session verification failed, clearing auth:', e);
        logout();
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

  const hasPermission = (key: string): boolean => {
    if (!user) return false;
    if (isDeveloper || isAdmin) return true;
    if (isHead) {
      return !!user.permissions?.[key];
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
