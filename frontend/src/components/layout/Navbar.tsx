import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SyncIndicator } from '../SyncIndicator';
import { WhatsAppIndicator } from '../WhatsAppIndicator';
import { Menu, ShoppingCart, ChevronRight, Store } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { AppEvent } from '../../types';
import { useSocket } from '../../context/SocketContext';
import { LiveStallModal } from '../LiveStallModal';
import { selectedEventId as resolveEventId } from '../../lib/event-context';

interface NavbarProps {
  onToggleSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const { user, isMember } = useAuth();
  const location = useLocation();
  const { socket } = useSocket();
  const [activeEvents, setActiveEvents] = useState<AppEvent[]>([]);
  const requestRef = useRef(0);
  const [showStallModal, setShowStallModal] = useState<boolean>(false);
  const [modalTargetEventId, setModalTargetEventId] = useState<string | undefined>(undefined);

  const fetchActiveEvent = async () => {
    const requestId = ++requestRef.current;
    try {
      const res = await api.get<any>('/events');
      if (requestId !== requestRef.current) return;
      const eventList: AppEvent[] = Array.isArray(res) ? res : (res?.events || []);
      const now = Date.now();
      const liveEvents = eventList.filter(
        e => e.status === 'ACTIVE' && now < new Date(e.endDatetime).getTime()
      );
      const activeFallback = liveEvents.length > 0 ? liveEvents : eventList.filter(e => e.status === 'ACTIVE');
      setActiveEvents(activeFallback);

    } catch {
      // Ignore background fetch error
    }
  };

  useEffect(() => {
    fetchActiveEvent();
    const interval = setInterval(fetchActiveEvent, 20000);
    return () => clearInterval(interval);
  }, [location.search, user?.id]);

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

  const storageKey = user?.id ? `enactus_ims_pos_event_${user.id}` : 'enactus_ims_pos_event_guest';
  let savedId: string | null = null;
  try { savedId = localStorage.getItem(storageKey); } catch {}
  const explicitId = new URLSearchParams(location.search).get('eventId') || location.pathname.match(/^\/events\/([^/]+)/)?.[1];
  const preferredId = resolveEventId(activeEvents, explicitId, null, savedId);
  const activeEvent = activeEvents.find(event => event.id === preferredId) || null;

  // Get readable page name from route
  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return 'Dashboard';
    if (path === '/sales-entry') return 'New Sale (POS)';
    if (path === '/projects-products' || path === '/products') return 'Products';
    if (path === '/inventory') return 'Inventory';
    if (path === '/events') return 'Events';
    if (path.startsWith('/events/')) return 'Event Stall Details';
    if (path === '/combos') return 'Combos & Offers';
    if (path === '/games') return 'Games Management';
    if (path === '/games/play' || path === '/play-game') return 'Play Game (Stall)';
    if (path === '/game-sessions') return 'Game Sessions';
    if (path === '/sales') return 'Sales History';
    if (path === '/analytics') return 'Analytics';
    if (path === '/users') return 'Users';
    return 'Operations Portal';
  };

  return (
    <header className="sticky top-0 z-20 min-h-16 h-auto py-2 sm:py-0 sm:h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between shadow-xs">
      {/* Left side: Mobile menu toggle + Breadcrumbs */}
      <div className="flex items-center gap-3 shrink-0 sm:shrink sm:min-w-0">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
          aria-label="Toggle navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Breadcrumb path */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs min-w-0">
          <span className="text-slate-400 font-medium hidden sm:inline">Enactus VIPS-TC</span>
          <ChevronRight className="w-3 h-3 text-slate-300 hidden sm:inline" />
          <span className="font-bold text-slate-900 tracking-tight text-sm truncate">
            {getPageTitle()}
          </span>
        </div>
      </div>

      {/* Middle/Right: Active Stall Badge & Sync & Quick Actions */}
      <div className="flex flex-1 min-w-0 flex-wrap sm:flex-nowrap justify-end items-center gap-1 sm:gap-3">
        {activeEvent ? (
          <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-xs text-emerald-900 shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setModalTargetEventId(activeEvent.id);
                setShowStallModal(true);
              }}
              className="flex items-center gap-1.5 hover:opacity-85 transition-opacity cursor-pointer text-left focus:outline-none"
              title="Open Live Stall Management"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-black text-[11px] uppercase tracking-wide text-emerald-800 hidden sm:inline">
                Live Stall:
              </span>
              <span className="font-bold text-slate-800 text-xs max-w-[90px] sm:max-w-[160px] truncate" title={activeEvent.name}>
                {activeEvent.name}
              </span>
              {activeEvents.length > 1 && (
                <span className="hidden sm:inline-block px-1.5 py-0.5 bg-emerald-200/80 text-emerald-900 text-[9px] font-black rounded uppercase tracking-wider shrink-0" title={`${activeEvents.length} stalls running simultaneously`}>
                  {activeEvents.length} Live
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setModalTargetEventId(activeEvent.id);
                setShowStallModal(true);
              }}
              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase rounded tracking-wider transition-colors shrink-0 cursor-pointer shadow-2xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              title="Manage live stall operations, stock, and games"
              aria-label="Manage live stall"
              aria-haspopup="dialog"
            >
              Manage
            </button>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full text-xs text-slate-500">
            <Store className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-medium text-slate-600">No Live Stall</span>
            <button
              type="button"
              onClick={() => {
                setModalTargetEventId(undefined);
                setShowStallModal(true);
              }}
              className="text-emerald-700 font-bold hover:underline text-[11px] ml-0.5 cursor-pointer focus:outline-none"
            >
              Open Stall
            </button>
          </div>
        )}

        <WhatsAppIndicator showTextAlways={false} />
        <SyncIndicator />

        {!isMember && location.pathname !== '/sales-entry' && (
          <Link
            to={activeEvent ? `/sales-entry?eventId=${activeEvent.id}` : '/sales-entry'}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>New Sale</span>
          </Link>
        )}
      </div>

      <LiveStallModal
        isOpen={showStallModal}
        onClose={() => setShowStallModal(false)}
        activeEvent={activeEvent}
        initialEventId={modalTargetEventId}
        onEventUpdated={fetchActiveEvent}
      />
    </header>
  );
};
