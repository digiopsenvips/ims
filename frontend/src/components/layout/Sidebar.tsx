import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  ShoppingCart,
  FolderTree,
  Boxes,
  Calendar,
  ReceiptText,
  BarChart3,
  Users,
  LogOut,
  X,
  Sparkles,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user, logout, isDeveloper, isAdmin, isHead, isMember, hasPermission } = useAuth();

  const getRoleBadge = () => {
    if (isDeveloper) return <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 rounded">DEVELOPER</span>;
    if (isAdmin) return <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 rounded">ADMIN</span>;
    if (isHead) return <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 rounded">HEAD</span>;
    return <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 rounded">MEMBER</span>;
  };

  const navSections = [
    {
      title: 'Operations',
      items: [
        {
          label: 'Dashboard',
          to: '/dashboard',
          icon: LayoutDashboard,
          show: !isMember,
        },
        {
          label: 'Member Sale Form',
          to: '/sales-entry',
          icon: ShoppingCart,
          badge: 'PWA',
          show: true,
        },
        {
          label: 'Sales Records',
          to: '/sales',
          icon: ReceiptText,
          show: !isMember,
        },
      ],
    },
    {
      title: 'Inventory & Events',
      items: [
        {
          label: 'Inventory',
          to: '/inventory',
          icon: Boxes,
          show: isDeveloper || isAdmin || hasPermission('view_inventory'),
        },
        {
          label: 'Events & Pricing',
          to: '/events',
          icon: Calendar,
          show: isDeveloper || isAdmin || hasPermission('view_event_breakdown') || hasPermission('edit_events'),
        },
        {
          label: 'Projects & Products',
          to: '/projects-products',
          icon: FolderTree,
          show: isDeveloper || isAdmin,
        },
      ],
    },
    {
      title: 'Management',
      items: [
        {
          label: 'Analytics',
          to: '/analytics',
          icon: BarChart3,
          show: isDeveloper || isAdmin || hasPermission('view_analytics'),
        },
        {
          label: 'User Management',
          to: '/users',
          icon: Users,
          show: isDeveloper || isAdmin,
        },
      ],
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-sm tracking-wider shadow-sm">
              E
            </div>
            <div>
              <div className="text-sm font-black tracking-tight text-slate-900 leading-none">
                ENACTUS <span className="text-emerald-600">VIPS-TC</span>
              </div>
              <div className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase mt-1 leading-none">
                Inventory & Sales System
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {navSections.map(section => {
            const visibleItems = section.items.filter(item => item.show);
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.title}>
                <div className="px-3 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {section.title}
                </div>
                <div className="space-y-0.5">
                  {visibleItems.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all ${
                          isActive
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        }`
                      }
                    >
                      <div className="flex items-center gap-2.5">
                        <item.icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </div>

                      {item.badge && (
                        <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* User Session Profile Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50/80 shrink-0">
          <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-white border border-slate-200/80 shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 truncate leading-tight">
                  {user?.name}
                </div>
                <div className="mt-0.5">{getRoleBadge()}</div>
              </div>
            </div>

            <button
              onClick={logout}
              className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors shrink-0 cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
