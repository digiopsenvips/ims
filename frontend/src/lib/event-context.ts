import { AppEvent } from '../types';
export function selectedEventId(events: AppEvent[], explicit?: string | null, current?: string | null, saved?: string | null) {
  // An explicit/stored context is retained even if it becomes unavailable. The user
  // must select a replacement rather than being silently moved to another stall.
  return explicit || current || saved || events.find(event => event.status === 'ACTIVE' && Date.now() < new Date(event.endDatetime).getTime())?.id || '';
}
