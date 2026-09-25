export type Role = 'DEVELOPER' | 'ADMIN' | 'HEAD' | 'MEMBER';

export type EventStatus = 'UPCOMING' | 'ACTIVE' | 'ENDED';

export type PaymentMethod = 'CASH' | 'UPI' | 'CASH_UPI';

export type TransactionType = 'SALE' | 'GAME';

export type GameStatus = 'ACTIVE' | 'INACTIVE';

export type GameResult = 'WIN' | 'LOSE';

export type GameSessionStatus = 'COMPLETED' | 'CANCELLED';

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
  reconciledAt?: string | null;
  totalAllocated: number;
  totalSold: number;
  totalRemaining: number;
  totalRevenue: number;
  allocations: EventAllocation[];
  createdAt: string;
  gamesCount?: number;
  gamesPlayed?: number;
  gameRevenue?: number;
  productsSoldCount?: number;
  games?: any[];
  sales?: any[];
  summary?: {
    totalRevenue: number;
    productRevenue: number;
    gameRevenue: number;
    totalAllocatedUnits: number;
    totalSoldUnits: number;
    totalRemainingUnits: number;
    totalTransactions: number;
    totalSalesCount: number;
    totalGamesPlayed: number;
  };
}

export interface SaleItem {
  id: number;
  productId: string;
  productName: string;
  projectId?: string;
  projectName?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Sale {
  id: number; // Internal database ID
  receiptNumber?: number; // Canonical sequential receipt number (#1, #2, #3...)
  serialNumber?: number; // Global chronological S.No. (1 = oldest transaction)
  transactionType?: TransactionType; // 'SALE' | 'GAME'
  gameId?: string | null;
  gameName?: string | null;
  game?: {
    id: string;
    name: string;
    entryFee?: number;
  } | null;
  description?: string;
  rewardDescription?: string;
  gameSession?: {
    sessionCode: string;
    result: GameResult;
    rewardProductName: string;
    rewardQuantity: number;
    rewardDescription?: string;
    rewardProduct?: {
      id: string;
      name: string;
    };
  } | null;
  clientTxId?: string | null;
  eventId: string;
  eventName: string;
  productId?: string;
  productName: string;
  projectId?: string;
  projectName: string;
  projectNames?: string[];
  memberId: string;
  memberName: string;
  memberUsername: string;
  memberDepartment?: string | null;
  sellerUserIdAtSale?: string;
  sellerUsernameAtSale?: string;
  sellerNameAtSale?: string;
  items?: SaleItem[];
  totalUnits?: number;
  quantity: number;
  unitPrice?: number | null;
  totalAmount?: number | null;
  paymentMethod: PaymentMethod;
  cashAmount?: number | null;
  upiAmount?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  saleTime: string;
  createdAt: string;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface SalesResponse {
  sales: Sale[];
  data?: Sale[];
  pagination: PaginationInfo;
  summary: {
    totalUnits: number;
    totalRevenue: number | null;
  };
}

export interface QueuedSaleItem {
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
}

export interface QueuedTransaction {
  clientTxId: string;
  receiptNumber?: number;
  eventId: string;
  eventName?: string;
  productId?: string;
  productName?: string;
  quantity?: number;
  unitPrice?: number;
  totalAmount?: number;
  items?: QueuedSaleItem[];
  totalUnits?: number;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  upiAmount?: number;
  customerName?: string;
  customerPhone?: string;
  saleTime: string;
  queuedAt: number;
  syncStatus: 'pending' | 'syncing' | 'failed';
}

export type QueuedSale = QueuedTransaction;

export interface GameRewardInfo {
  productId: string;
  productName: string;
  quantity: number;
  availableStock: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
}

export interface Game {
  id: string;
  name: string;
  description?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  eventId?: string | null;
  eventName?: string | null;
  eventStatus?: EventStatus | null;
  entryFee: number;
  status: GameStatus;
  winReward: GameRewardInfo;
  loseReward?: GameRewardInfo | null;
  stats?: {
    totalPlays: number;
    wins: number;
    losses: number;
    winRate: number;
    totalRevenue: number;
    totalRewardsIssued: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface GameSession {
  id: string;
  sessionCode: string; // "GS-000001"
  receiptNumber: number;
  gameId: string;
  gameName: string;
  projectId?: string | null;
  projectName?: string | null;
  eventId: string;
  eventName: string;
  sellerId?: string | null;
  sellerName: string;
  sellerUsername?: string;
  entryFee: number;
  paymentMethod: PaymentMethod;
  cashAmount?: number | null;
  upiAmount?: number | null;
  result: GameResult;
  rewardProductId: string;
  rewardProductName: string;
  rewardQuantity: number;
  rewardDescription: string;
  customerName?: string | null;
  customerPhone?: string | null;
  status: GameSessionStatus;
  createdAt: string;
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
  gameAnalytics?: {
    totalGamesPlayed: number;
    totalGameRevenue: number | null;
    totalWins: number;
    totalLosses: number;
    winRate: number;
    totalRewardsIssued: number;
    estimatedRewardValue: number | null;
    gameBreakdown: {
      gameId: string;
      gameName: string;
      projectName: string;
      plays: number;
      revenue?: number;
      wins: number;
      losses: number;
      winRate: number;
      rewardsIssued: number;
    }[];
    eventBreakdown: {
      eventId: string;
      eventName: string;
      plays: number;
      revenue?: number;
      wins: number;
      losses: number;
      winRate: number;
      rewardsIssued: number;
    }[];
  };
}

export interface CartItem {
  productId: string;
  productName: string;
  projectName: string;
  priceAtEvent: number;
  quantity: number;
  remainingStock: number;
}
