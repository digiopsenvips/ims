export type Role = 'DEVELOPER' | 'ADMIN' | 'HEAD' | 'MEMBER';

export type EventStatus = 'UPCOMING' | 'ACTIVE' | 'ENDED';

export type PaymentMethod = 'CASH' | 'UPI';

export interface User {
  id: string;
  name: string;
  username: string;
  email?: string | null;
  role: Role;
  department?: string | null;
  permissions?: Record<string, boolean>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  products?: Product[];
}

export interface Product {
  id: string; // e.g. TAH-001
  name: string;
  projectId: string;
  basePrice?: number | null;
  isDeleted?: boolean;
  project?: Project;
  inventory?: Inventory | null;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  projectId: string;
  projectName: string;
  basePrice?: number | null;
  quantityOnHand: number;
  activeAllocatedQty: number;
  totalAvailable: number;
  notes?: string | null;
  lastUpdated: string;
}

export interface Inventory {
  id: string;
  productId: string;
  quantityOnHand: number;
  notes?: string | null;
  lastUpdated: string;
}

export interface EventAllocation {
  id: string;
  productId: string;
  productName: string;
  projectName: string;
  allocatedQty: number;
  soldQty: number;
  remainingQty: number;
  priceAtEvent: number;
}

export interface AppEvent {
  id: string;
  name: string;
  location: string;
  startDatetime: string;
  endDatetime: string;
  status: EventStatus;
  totalAllocated: number;
  totalSold: number;
  totalRemaining: number;
  totalRevenue: number;
  allocations: EventAllocation[];
  createdAt: string;
}

export interface Sale {
  id: number; // Serial No.
  clientTxId?: string | null;
  eventId: string;
  eventName: string;
  productId: string;
  productName: string;
  projectId: string;
  projectName: string;
  memberId: string;
  memberName: string;
  memberUsername: string;
  quantity: number;
  unitPrice?: number | null;
  totalAmount?: number | null;
  paymentMethod: PaymentMethod;
  customerName?: string | null;
  customerPhone?: string | null;
  saleTime: string;
  createdAt: string;
}

export interface QueuedSale {
  clientTxId: string;
  eventId: string;
  eventName?: string;
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice?: number;
  totalAmount?: number;
  paymentMethod: PaymentMethod;
  customerName?: string;
  customerPhone?: string;
  saleTime: string;
  queuedAt: number;
  syncStatus: 'pending' | 'syncing' | 'failed';
}

export interface AnalyticsData {
  canViewRevenue: boolean;
  canViewEventBreakdown: boolean;
  overview: {
    totalSalesRecords: number;
    totalUnitsSold: number;
    totalRevenue: number | null;
  };
  productShare: {
    name: string;
    project: string;
    units: number;
    revenue?: number;
  }[];
  projectShare: {
    name: string;
    units: number;
    revenue?: number;
  }[];
  stallPerformance: {
    eventId: string;
    eventName: string;
    totalUnits: number;
    totalRevenue?: number;
    bestSellingProduct: string;
    bestSellingUnits: number;
  }[];
  timeTrend: {
    date: string;
    units: number;
    revenue?: number;
  }[];
}

export interface CartItem {
  productId: string;
  productName: string;
  projectName: string;
  priceAtEvent: number;
  quantity: number;
  remainingStock: number;
}
