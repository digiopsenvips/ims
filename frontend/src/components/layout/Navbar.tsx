import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { SyncIndicator } from '../SyncIndicator';
import { Menu, ShoppingCart, ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface NavbarProps {
  onToggleSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const { user, isMember } = useAuth();
  const location = useLocation();

  // Get readable page name from route
  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return 'Executive Dashboard';
    if (path === '/sales-entry') return 'Member Sales Portal';
    if (path === '/projects-products') return 'Projects & Products';
    if (path === '/inventory') return 'Inventory & Live Stock';
    if (path === '/events') return 'Events & Allocations';
    if (path === '/sales') return 'Sales Ledger & Tracking';
    if (path === '/analytics') return 'Performance Analytics';
    if (path === '/users') return 'User Accounts & RBAC';
    return 'Operations Portal';
  };

  return (
    <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between shadow-sm">
      {/* Left side: Mobile menu toggle + Breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
          aria-label="Toggle navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Breadcrumb path */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-medium hidden sm:inline">Enactus VIPS-TC</span>
          <ChevronRight className="w-3 h-3 text-slate-300 hidden sm:inline" />
          <span className="font-bold text-slate-900 tracking-tight text-sm">
            {getPageTitle()}
          </span>
        </div>
      </div>

      {/* Right side: Sync Indicator & Quick action */}
      <div className="flex items-center gap-3">
        <SyncIndicator />

        {!isMember && location.pathname !== '/sales-entry' && (
          <Link
            to="/sales-entry"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md shadow-sm transition-colors"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>Open Sale Form</span>
          </Link>
        )}
      </div>
    </header>
  );
};
