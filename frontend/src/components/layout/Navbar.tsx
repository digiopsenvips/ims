import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SyncIndicator } from '../SyncIndicator';
import { Menu, ShoppingCart, ChevronRight, Store } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { AppEvent } from '../../types';
import { useSocket } from '../../context/SocketContext';

interface NavbarProps {
  onToggleSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const { user, isMember } = useAuth();
  const location = useLocation();
  const { socket } = useSocket();
  const [activeEvent, setActiveEvent] = useState<AppEvent | null>(null);

  const fetchActiveEvent = async () => {
    try {
      const events = await api.get<AppEvent[]>('/events');
      if (Array.isArray(events)) {
        const active = events.find(e => e.status === 'ACTIVE');
        setActiveEvent(active || null);
      }
    } catch {
      // Ignore background fetch error
    }
  };

  useEffect(() => {
    fetchActiveEvent();
    const interval = setInterval(fetchActiveEvent, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => fetchActiveEvent();
    socket.on('event:created', handleUpdate);
    socket.on('event:updated', handleUpdate);
    socket.on('event:status_changed', handleUpdate);
    return () => {
      socket.off('event:created', handleUpdate);
      socket.off('event:updated', handleUpdate);
      socket.off('event:status_changed', handleUpdate);
    };
  }, [socket]);

  // Get readable page name from route
  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return 'Dashboard';
    if (path === '/sales-entry') return 'New Sale (POS)';
    if (path === '/projects-products' || path === '/products') return 'Products';
    if (path === '/inventory') return 'Inventory';
    if (path === '/events') return 'Events';
    if (path.startsWith('/events/')) return 'Event Stall Details';
    if (path === '/games') return 'Games Management';
    if (path === '/games/play' || path === '/play-game') return 'Play Game (Stall)';
    if (path === '/game-sessions') return 'Game Sessions';
    if (path === '/sales') return 'Sales History';
    if (path === '/analytics') return 'Analytics';
    if (path === '/users') return 'Users';
    return 'Operations Portal';
  };

  return (
    <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between shadow-xs">
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

      {/* Middle/Right: Active Stall Badge & Sync & Quick Actions */}
      <div className="flex items-center gap-3">
        {activeEvent && (
          <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-xs text-emerald-900 shadow-2xs">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-black text-[11px] uppercase tracking-wide text-emerald-800 hidden sm:inline">
              Active Stall:
            </span>
            <span className="font-bold text-slate-800 text-xs max-w-[110px] sm:max-w-[160px] truncate">
              {activeEvent.name}
            </span>
            <Link
              to={`/events/${activeEvent.id}`}
              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase rounded tracking-wider transition-colors shrink-0"
            >
              Open Stall
            </Link>
          </div>
        )}

        <SyncIndicator />

        {!isMember && location.pathname !== '/sales-entry' && (
          <Link
            to="/sales-entry"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>New Sale</span>
          </Link>
        )}
      </div>
    </header>
  );
};
