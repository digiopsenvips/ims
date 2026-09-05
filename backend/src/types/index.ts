import { Role } from '@prisma/client';
import { Request } from 'express';

export type HeadPermissionKey =
  | 'view_inventory'
  | 'view_revenue'
  | 'view_customer_pii'
  | 'view_analytics'
  | 'view_event_breakdown'
  | 'edit_inventory'
  | 'edit_events'
  | 'export_data';

export interface AuthUserPayload {
  id: string;
  name: string;
  username: string;
  role: Role;
  permissions?: Record<string, boolean>;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload;
}
