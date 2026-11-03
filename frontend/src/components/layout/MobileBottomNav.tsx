import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ShoppingCart,
  ReceiptText,
  Calendar,
  Gamepad2,
  Gift,
  Menu,
} from 'lucide-react';

interface MobileBottomNavProps {
  onToggleSidebar: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onToggleSidebar }) => {
  const { user, isMember, isDeveloper, isAdmin, isHead, hasPermission } = useAuth();
  const location = useLocation();

  if (!user) return null;

  const storageKey = user.id ? `enactus_ims_pos_event_${user.id}` : 'enactus_ims_pos_event_guest';
  let savedEventId: string | null = null;
  try {
    savedEventId = localStorage.getItem(storageKey);
  } catch {}

  const canViewSales = !isMember;
  const canViewEvents = !isMember && (isDeveloper || isAdmin || hasPermission('view_event_breakdown') || hasPermission('edit_events') || isHead);

  // Define mobile navigation items based on role
  const navItems = [
    {
      label: 'New Sale',
      to: savedEventId ? `/sales-entry?eventId=${savedEventId}` : '/sales-entry',
      icon: ShoppingCart,
      isActive: location.pathname.startsWith('/sales-entry'),
    },
    ...(canViewSales
      ? [
          {
            label: 'Sales',
            to: '/sales',
            icon: ReceiptText,
            isActive: location.pathname === '/sales',
          },
        ]
      : [
          {
            label: 'Combos',
            to: '/combos',
            icon: Gift,
            isActive: location.pathname === '/combos',
          },
        ]),
    ...(canViewEvents
      ? [
          {
            label: 'Stall',
            to: '/events',
            icon: Calendar,
            isActive: location.pathname.startsWith('/events'),
          },
        ]
      : []),
    {
      label: 'Play Game',
      to: '/games/play',
      icon: Gamepad2,
      isActive: location.pathname.startsWith('/games/play') || location.pathname === '/play-game',
    },
  ];

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      aria-label="Mobile Bottom Navigation"
    >
      <div className="flex items-center justify-around px-2 pt-1.5 pb-1">
        {navItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            className={`flex flex-col items-center justify-center min-w-[56px] py-1 px-1.5 rounded-lg transition-colors cursor-pointer select-none ${
              item.isActive
                ? 'text-emerald-700 font-bold'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <div
              className={`p-1 rounded-md transition-all ${
                item.isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500'
              }`}
            >
              <item.icon className="w-5 h-5" />
            </div>
            <span className="text-[10px] tracking-tight leading-tight mt-0.5 whitespace-nowrap">
              {item.label}
            </span>
          </NavLink>
        ))}

        {/* Menu button to open sidebar drawer */}
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex flex-col items-center justify-center min-w-[56px] py-1 px-1.5 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer select-none"
          aria-label="Open full menu"
        >
          <div className="p-1 rounded-md text-slate-500">
            <Menu className="w-5 h-5" />
          </div>
          <span className="text-[10px] tracking-tight leading-tight mt-0.5 whitespace-nowrap font-medium">
            Menu
          </span>
        </button>
      </div>
    </nav>
  );
};
