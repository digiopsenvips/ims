import React, { useEffect, useState } from 'react';
import { syncManager } from '../lib/sync';
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';

export const SyncIndicator: React.FC = () => {
  const [syncState, setSyncState] = useState(syncManager.getStatus());

  useEffect(() => {
    const unsubscribe = syncManager.subscribe(state => {
      setSyncState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleManualSync = () => {
    if (syncState.isOnline && !syncState.isSyncing) {
      syncManager.triggerSync();
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs font-medium">
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
        <span>{syncState.isOnline ? 'Online' : 'Offline Mode'}</span>
      </div>

      {/* Pending Sync Counter Badge */}
      {syncState.pendingCount > 0 ? (
        <button
          onClick={handleManualSync}
          disabled={!syncState.isOnline || syncState.isSyncing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200 transition-all cursor-pointer shadow-sm"
          title="Click to sync now"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncState.isSyncing ? 'animate-spin' : ''}`} />
          <span>
            {syncState.isSyncing
              ? 'Syncing...'
              : `${syncState.pendingCount} ${syncState.pendingCount === 1 ? 'entry' : 'entries'} pending sync`}
          </span>
        </button>
      ) : (
        <div
          className="hidden sm:flex items-center gap-1 px-2 py-0.5 text-slate-500 text-[11px]"
          title="All local data synchronized"
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          <span>Synced</span>
        </div>
      )}
    </div>
  );
};
