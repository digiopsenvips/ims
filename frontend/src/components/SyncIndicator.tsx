import React, { useEffect, useState } from 'react';
import { syncManager, SyncState } from '../lib/sync';
import { SyncIssuesDrawer } from './SyncIssuesDrawer';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export const SyncIndicator: React.FC = () => {
  const [syncState, setSyncState] = useState<SyncState>(syncManager.getStatus());
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = syncManager.subscribe(state => {
      setSyncState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {/* Network Connectivity Badge */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
            syncState.isOnline
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-amber-50 border-amber-200 text-amber-800 animate-pulse'
          }`}
          title={syncState.isOnline ? 'Online - connected to server' : 'Offline - local queuing active'}
        >
          {syncState.isOnline ? (
            <Wifi className="w-3.5 h-3.5" />
          ) : (
            <WifiOff className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">{syncState.isOnline ? 'Online' : 'Offline'}</span>
        </div>

        {/* Failed / Review Required Badge */}
        {syncState.failedCount > 0 && (
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 transition-all cursor-pointer shadow-2xs"
            title="Some local transactions need review. Click to inspect & resolve"
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>
              {syncState.failedCount} {syncState.failedCount === 1 ? 'needs review' : 'need review'}
            </span>
          </button>
        )}

        {/* Pending Sync Counter Badge */}
        {syncState.pendingCount > 0 ? (
          <button
            onClick={() => setIsDrawerOpen(true)}
            disabled={syncState.isSyncing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100 transition-all cursor-pointer shadow-2xs"
            title="Click to view pending sync queue & inspect transactions"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncState.isSyncing ? 'animate-spin text-blue-600' : 'text-blue-700'}`} />
            <span>
              {syncState.isSyncing
                ? 'Syncing...'
                : `${syncState.pendingCount} pending`}
            </span>
          </button>
        ) : syncState.failedCount === 0 ? (
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-slate-500 hover:text-slate-700 text-[11px] rounded transition-colors cursor-pointer"
            title="Inspect local database operations and acknowledgements."
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span className="hidden sm:inline">Synced</span>
          </button>
        ) : null}
      </div>

      {/* Sync & Transaction Issues Slide-Over Drawer */}
      <SyncIssuesDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </>
  );
};
