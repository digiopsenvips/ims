'use client';

import { useEffect } from 'react';

import { createMemberSale } from '@/actions/sales';
import { syncQueuedSales } from '@/lib/offline-sales';

export function PwaProvider() {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const sync = () => {
      void syncQueuedSales(async (payload) => {
        await createMemberSale(payload);
      });
    };

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    sync();
    window.addEventListener('online', sync);

    return () => {
      window.removeEventListener('online', sync);
    };
  }, []);

  return null;
}
