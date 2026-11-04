import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { AppEvent } from '../types';
import {
  Clock,
  MapPin,
  Package,
  X,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Info,
  ShieldCheck,
  Check,
} from 'lucide-react';

interface ReopenPreviewProduct {
  productId: string;
  productName: string;
  sku: string;
  projectId: string;
  projectName: string;
  basePrice: number;
  priceAtEvent: number;
  currentWarehouse: number;
  previousAllocated: number;
  previouslySold: number;
  previousUnsold: number;
  minAllowed: number;
  maxAllocatable: number;
  suggestedAllocation: number;
  isPreviouslyAllocated: boolean;
  discrepancy: {
    hasDiscrepancy: boolean;
    returnedAtClosure: number;
    currentWarehouse: number;
    shortfall: number;
    note: string;
  } | null;
}

interface ReopenPreviewData {
  event: {
    id: string;
    name: string;
    location: string;
    status: string;
    startDatetime: string;
    endDatetime: string;
    reconciledAt: string | null;
  };
  products: ReopenPreviewProduct[];
}

interface ReopenStallModalProps {
  event: AppEvent;
  onClose: () => void;
  onSuccess: (updatedEvent: any, message: string) => void;
}

function toISTDateString(iso: string): string {
  try {
    const d = new Date(iso);
    const istTime = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    return istTime.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

function toISTTimeString(iso: string): string {
  try {
    const d = new Date(iso);
    const istTime = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const timePart = istTime.toISOString().split('T')[1];
    return timePart.substring(0, 5);
  } catch {
    return '20:00';
  }
}

function formatISTDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export const ReopenStallModal: React.FC<ReopenStallModalProps> = ({
  event,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [previewData, setPreviewData] = useState<ReopenPreviewData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Step 1 Form State
  const [newEndDate, setNewEndDate] = useState('');
  const [newEndTime, setNewEndTime] = useState('22:00');
  const [reason, setReason] = useState('');
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Step 2 Allocations State: map of productId -> allocatedQty
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('ALL');
  const [onlyAllocated, setOnlyAllocated] = useState(false);
  const [showDiscrepancyHelp, setShowDiscrepancyHelp] = useState(false);

  // Step 3 Confirmation State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedAccuracy, setConfirmedAccuracy] = useState(false);

  // Initialize dates
  useEffect(() => {
    const now = new Date();
    const defaultEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h in future
    setNewEndDate(toISTDateString(defaultEnd.toISOString()));
    setNewEndTime(toISTTimeString(defaultEnd.toISOString()) || '22:00');
  }, []);

  // Fetch preview on mount
  useEffect(() => {
    let isMounted = true;
    async function loadPreview() {
      setIsLoadingPreview(true);
      setFetchError(null);
      try {
        const res = await api.get<ReopenPreviewData>(`/events/${event.id}/reopen-preview`);
        if (!isMounted) return;
        setPreviewData(res);

        // Pre-fill allocations with suggested values
        const initialAlloc: Record<string, number> = {};
        for (const p of res.products) {
          if (p.isPreviouslyAllocated) {
            initialAlloc[p.productId] = p.suggestedAllocation;
          } else {
            initialAlloc[p.productId] = 0;
          }
        }
        setAllocations(initialAlloc);
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Failed to load reopen preview:', err);
        setFetchError(err.message || 'Failed to load stall inventory details');
      } finally {
        if (isMounted) setIsLoadingPreview(false);
      }
    }

    loadPreview();
    return () => {
      isMounted = false;
    };
  }, [event.id]);

  // Unique project list for filter
  const projects = useMemo(() => {
    if (!previewData) return [];
    const set = new Set<string>();
    previewData.products.forEach(p => {
      if (p.projectName) set.add(p.projectName);
    });
    return Array.from(set).sort();
  }, [previewData]);

  // Filtered products list for Step 2 table
  const filteredProducts = useMemo(() => {
    if (!previewData) return [];
    return previewData.products.filter(p => {
      if (onlyAllocated && !p.isPreviouslyAllocated && (allocations[p.productId] || 0) <= 0) {
        return false;
      }
      if (selectedProject !== 'ALL' && p.projectName !== selectedProject) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = p.productName.toLowerCase().includes(q);
        const matchId = p.productId.toLowerCase().includes(q);
        const matchProj = p.projectName.toLowerCase().includes(q);
        return matchName || matchId || matchProj;
      }
      return true;
    });
  }, [previewData, onlyAllocated, allocations, selectedProject, searchQuery]);

  // Discrepant products list
  const discrepantProducts = useMemo(() => {
    if (!previewData) return [];
    return previewData.products.filter(p => p.discrepancy?.hasDiscrepancy);
  }, [previewData]);

  // Validation checks for Step 2
  const allocationValidation = useMemo(() => {
    if (!previewData) return { isValid: true, errors: [] as string[] };
    const errors: string[] = [];

    for (const p of previewData.products) {
      const requested = allocations[p.productId];
      if (requested === undefined) continue;

      if (requested < p.minAllowed) {
        errors.push(
          `${p.productName}: Total allocation (${requested}) cannot be lower than historical sales (${p.previouslySold} units).`
        );
      }

      const activeNeeded = requested - p.previouslySold;
      if (activeNeeded > p.currentWarehouse) {
        errors.push(
          `${p.productName}: Requires ${activeNeeded} active units from warehouse (${requested} total minus ${p.previouslySold} sold), but only ${p.currentWarehouse} units are available in warehouse.`
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }, [previewData, allocations]);

  // Step 3 totals calculation
  const summaryTotals = useMemo(() => {
    if (!previewData) {
      return {
        activeProductsCount: 0,
        totalActiveUnits: 0,
        totalHistoricalSales: 0,
        totalAllocatedUnits: 0,
      };
    }

    let activeProductsCount = 0;
    let totalActiveUnits = 0;
    let totalHistoricalSales = 0;
    let totalAllocatedUnits = 0;

    for (const p of previewData.products) {
      const alloc = allocations[p.productId] ?? (p.isPreviouslyAllocated ? p.previouslySold : 0);
      const active = Math.max(0, alloc - p.previouslySold);

      totalHistoricalSales += p.previouslySold;
      totalAllocatedUnits += alloc;

      if (active > 0) {
        activeProductsCount++;
        totalActiveUnits += active;
      }
    }

    return {
      activeProductsCount,
      totalActiveUnits,
      totalHistoricalSales,
      totalAllocatedUnits,
    };
  }, [previewData, allocations]);

  // Handler: Step 1 Submit
  const handleProceedToStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setStep1Error(null);

    if (!newEndDate || !newEndTime) {
      setStep1Error('Please choose a valid date and time for the new deadline.');
      return;
    }

    const newEndMs = new Date(`${newEndDate}T${newEndTime}:00+05:30`).getTime();
    if (isNaN(newEndMs)) {
      setStep1Error('Invalid date or time format.');
      return;
    }

    if (newEndMs <= Date.now()) {
      setStep1Error('New deadline must be in the future.');
      return;
    }

    if (newEndMs <= new Date(event.startDatetime).getTime()) {
      setStep1Error('New deadline must be after event start date.');
      return;
    }

    setStep(2);
  };

  // Handler: Change single allocation
  const handleAllocationChange = (productId: string, val: string) => {
    const num = val === '' ? 0 : parseInt(val, 10);
    if (isNaN(num)) return;
    setAllocations(prev => ({
      ...prev,
      [productId]: Math.max(0, num),
    }));
  };

  // Handler: Bulk reset to sold (0 active)
  const handleResetToZeroActive = () => {
    if (!previewData) return;
    const updated: Record<string, number> = {};
    for (const p of previewData.products) {
      updated[p.productId] = p.previouslySold;
    }
    setAllocations(updated);
  };

  // Handler: Bulk keep previous up to available
  const handleKeepPreviousAvailable = () => {
    if (!previewData) return;
    const updated: Record<string, number> = {};
    for (const p of previewData.products) {
      if (p.isPreviouslyAllocated) {
        updated[p.productId] = Math.min(p.previousAllocated, p.maxAllocatable);
      } else {
        updated[p.productId] = 0;
      }
    }
    setAllocations(updated);
  };

  // Handler: Final Reopen Submission
  const handleConfirmReopen = async () => {
    if (!previewData || !allocationValidation.isValid) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const newEndDatetime = new Date(`${newEndDate}T${newEndTime}:00+05:30`).toISOString();

    // Prepare allocations payload
    const allocationPayload = previewData.products.map(p => {
      const requested = allocations[p.productId] ?? p.previouslySold;
      return {
        productId: p.productId,
        allocatedQty: requested,
        priceAtEvent: p.priceAtEvent,
      };
    });

    try {
      const res: any = await api.post(`/events/${event.id}/reopen`, {
        newEndDatetime,
        reason: reason.trim() || undefined,
        reactivate: true,
        allocations: allocationPayload,
      });

      onSuccess(res.event, res.message || `Stall '${event.name}' successfully reopened for live operations!`);
      onClose();
    } catch (err: any) {
      console.error('Reopening submission error:', err);
      setSubmitError(err.message || 'Failed to reopen stall. Please review the allocation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]">
        {/* Header & Step Tracker */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                  {event.status}
                </span>
                <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                  Reopen Stall
                </h3>
              </div>
              <p className="text-xs text-slate-500 truncate max-w-md">
                {event.name} &bull; {event.location}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-5 py-3 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 1
                    ? 'bg-amber-600 text-white'
                    : step > 1
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step > 1 ? <Check className="w-3.5 h-3.5" /> : '1'}
              </span>
              <span className={`text-xs font-semibold ${step === 1 ? 'text-amber-900' : 'text-slate-500'}`}>
                Deadline
              </span>
            </div>
            <div className={`h-0.5 w-12 sm:w-20 ${step > 1 ? 'bg-emerald-500' : 'bg-slate-200'}`} />
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 2
                    ? 'bg-amber-600 text-white'
                    : step > 2
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step > 2 ? <Check className="w-3.5 h-3.5" /> : '2'}
              </span>
              <span className={`text-xs font-semibold ${step === 2 ? 'text-amber-900' : 'text-slate-500'}`}>
                Allocation
              </span>
            </div>
            <div className={`h-0.5 w-12 sm:w-20 ${step === 3 ? 'bg-amber-600' : 'bg-slate-200'}`} />
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 3 ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                3
              </span>
              <span className={`text-xs font-semibold ${step === 3 ? 'text-amber-900' : 'text-slate-500'}`}>
                Confirm
              </span>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-4 flex-1">
          {isLoadingPreview ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-amber-600" />
              <p className="text-xs font-semibold text-slate-600">
                Auditing stall inventory and warehouse balances...
              </p>
            </div>
          ) : fetchError ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{fetchError}</span>
            </div>
          ) : (
            <>
              {/* ================= STEP 1: EVENT DETAILS & DEADLINE ================= */}
              {step === 1 && (
                <form onSubmit={handleProceedToStep2} className="space-y-4">
                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Stall Name:</span>
                      <span className="font-bold text-slate-900">{event.name}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Location:</span>
                      <span className="font-semibold text-slate-700">{event.location}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Previous Closure:</span>
                      <span className="font-semibold text-slate-700">{formatISTDateTime(event.endDatetime)}</span>
                    </div>
                  </div>

                  {step1Error && (
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{step1Error}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      New End Date & Time (IST) *
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        required
                        value={newEndDate}
                        onChange={e => setNewEndDate(e.target.value)}
                        className="w-2/3 text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-medium"
                      />
                      <input
                        type="time"
                        required
                        value={newEndTime}
                        onChange={e => setNewEndTime(e.target.value)}
                        className="w-1/3 text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Reason for Reopening (Optional)
                    </label>
                    <input
                      type="text"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Festival crowd extended by organizers / additional sales window"
                      className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                  </div>

                  <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
                    <div className="font-bold flex items-center gap-1.5 text-amber-950">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span>Updated Inventory Allocation Workflow</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      In the next step, you will review and update the allocation for each product. When an event closes, unsold stock is returned to the warehouse. Reopening allows you to allocate genuine warehouse stock currently available, preventing phantom or double-counted inventory.
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>All historical sales ({summaryTotals.totalHistoricalSales} units) and receipts are strictly preserved.</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <span>Continue to Inventory Allocation</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}

              {/* ================= STEP 2: REVIEW & UPDATE ALLOCATION ================= */}
              {step === 2 && (
                <div className="space-y-4">
                  {/* Discrepancy Alert Banner */}
                  {discrepantProducts.length > 0 && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-amber-950">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>
                            {discrepantProducts.length} product(s) have verified stock adjustments since closure
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowDiscrepancyHelp(!showDiscrepancyHelp)}
                          className="text-[11px] font-bold text-amber-800 underline hover:text-amber-950 cursor-pointer"
                        >
                          {showDiscrepancyHelp ? 'Hide Details' : 'View Ledger Details'}
                        </button>
                      </div>
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        Unsold units returned when this stall closed were partially consumed by subsequent stalls or live sales (e.g. DCAC Stall). Their new allocations have been safely defaulted to the maximum currently available in the warehouse.
                      </p>
                      {showDiscrepancyHelp && (
                        <div className="mt-2 space-y-1.5 pt-2 border-t border-amber-200/80">
                          {discrepantProducts.map(p => (
                            <div key={p.productId} className="text-[11px] bg-amber-100/70 p-2 rounded-lg text-amber-950">
                              <span className="font-bold">{p.productName} ({p.productId}):</span>{' '}
                              {p.discrepancy?.note}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
                    <div className="flex-1 relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search products by name or ID..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full text-xs pl-8 pr-3 py-2 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedProject}
                        onChange={e => setSelectedProject(e.target.value)}
                        className="text-xs p-2 border border-slate-300 rounded-xl focus:ring-1 focus:ring-slate-900 bg-white font-medium text-slate-700"
                      >
                        <option value="ALL">All Projects</option>
                        {projects.map(proj => (
                          <option key={proj} value={proj}>
                            {proj}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setOnlyAllocated(!onlyAllocated)}
                        className={`text-xs px-3 py-2 border rounded-xl font-bold cursor-pointer transition-colors whitespace-nowrap ${
                          onlyAllocated
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {onlyAllocated ? 'Allocated Only' : 'Show All'}
                      </button>
                    </div>
                  </div>

                  {/* Bulk Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs">
                    <span className="text-slate-500 font-medium">Quick Bulk Actions:</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleKeepPreviousAvailable}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                        title="Allocates remaining stock up to previous unsold or available warehouse stock"
                      >
                        Keep Previous (Up to Available)
                      </button>
                      <button
                        type="button"
                        onClick={handleResetToZeroActive}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                        title="Sets new allocation equal to historical sales (0 active units pulled from warehouse)"
                      >
                        Set All to 0 Active Stock
                      </button>
                    </div>
                  </div>

                  {/* Validation Errors Callout */}
                  {!allocationValidation.isValid && (
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-rose-900">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Allocation Validation Error</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                        {allocationValidation.errors.slice(0, 3).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                        {allocationValidation.errors.length > 3 && (
                          <li>...and {allocationValidation.errors.length - 3} more issue(s).</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Searchable Products Table */}
                  <div className="border border-slate-200/80 rounded-xl overflow-x-auto shadow-2xs">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                        <tr>
                          <th scope="col" className="px-3.5 py-2.5">Product</th>
                          <th scope="col" className="px-3 py-2.5 text-right whitespace-nowrap">Warehouse Avail</th>
                          <th scope="col" className="px-3 py-2.5 text-right whitespace-nowrap">Sold at Stall</th>
                          <th scope="col" className="px-3 py-2.5 text-right whitespace-nowrap">Prev Alloc</th>
                          <th scope="col" className="px-3 py-2.5 text-right whitespace-nowrap">New Total Alloc</th>
                          <th scope="col" className="px-3 py-2.5 text-right whitespace-nowrap">Active Units</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredProducts.map(p => {
                          const currentVal = allocations[p.productId] ?? (p.isPreviouslyAllocated ? p.previouslySold : 0);
                          const activeUnits = Math.max(0, currentVal - p.previouslySold);
                          const isShortfall = activeUnits > p.currentWarehouse;
                          const isBelowSold = currentVal < p.minAllowed;

                          return (
                            <tr key={p.productId} className={`hover:bg-slate-50/70 ${isShortfall ? 'bg-rose-50/40' : ''}`}>
                              <td className="px-3.5 py-2 min-w-[180px]">
                                <div className="font-bold text-slate-900">{p.productName}</div>
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5 font-mono">
                                  <span>{p.productId}</span>
                                  <span>&bull;</span>
                                  <span className="text-slate-500 font-sans">{p.projectName}</span>
                                </div>
                                {p.discrepancy?.hasDiscrepancy && (
                                  <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-800">
                                    Warehouse: {p.currentWarehouse} (was {p.discrepancy.returnedAtClosure} upon closure)
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <span
                                  className={`font-black px-2 py-0.5 rounded text-[11px] ${
                                    p.currentWarehouse > 0
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {p.currentWarehouse}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap text-slate-600 font-semibold">
                                {p.previouslySold}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap text-slate-500">
                                {p.previousAllocated}
                              </td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1.5">
                                  <input
                                    type="number"
                                    min={p.minAllowed}
                                    max={p.maxAllocatable}
                                    step="1"
                                    value={currentVal}
                                    onChange={e => handleAllocationChange(p.productId, e.target.value)}
                                    className={`w-20 text-right p-1.5 border rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-1 ${
                                      isShortfall || isBelowSold
                                        ? 'border-rose-400 ring-1 ring-rose-400 bg-rose-50/50'
                                        : 'border-slate-300 focus:ring-slate-900'
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAllocationChange(p.productId, String(p.maxAllocatable))}
                                    className="px-1.5 py-1 text-[10px] font-bold uppercase rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer"
                                    title={`Max possible: ${p.maxAllocatable}`}
                                  >
                                    MAX
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAllocationChange(p.productId, String(p.minAllowed))}
                                    className="px-1.5 py-1 text-[10px] font-bold uppercase rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer"
                                    title="Allocate 0 active units (equal to historical sales)"
                                  >
                                    0
                                  </button>
                                </div>
                                <div className="text-[10px] text-slate-400 text-right mt-0.5">
                                  Min: {p.minAllowed} &bull; Max: {p.maxAllocatable}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <span
                                  className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                                    activeUnits > 0
                                      ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  +{activeUnits}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Step 2 Bottom Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Back to Deadline</span>
                    </button>
                    <button
                      type="button"
                      disabled={!allocationValidation.isValid}
                      onClick={() => setStep(3)}
                      className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span>Review & Confirm</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* ================= STEP 3: REVIEW & CONFIRM REOPENING ================= */}
              {step === 3 && (
                <div className="space-y-4">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Reopened Status
                      </div>
                      <div className="text-sm font-black text-emerald-700 mt-1 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>ACTIVE</span>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Active Products
                      </div>
                      <div className="text-base font-black text-slate-900 mt-1">
                        {summaryTotals.activeProductsCount}
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Active Units Pulled
                      </div>
                      <div className="text-base font-black text-blue-700 mt-1">
                        {summaryTotals.totalActiveUnits}
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Sales Preserved
                      </div>
                      <div className="text-base font-black text-emerald-700 mt-1">
                        {summaryTotals.totalHistoricalSales} units
                      </div>
                    </div>
                  </div>

                  {/* Schedule Confirmation */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">New Stall Deadline (IST):</span>
                      <span className="font-bold text-slate-900">
                        {formatISTDateTime(`${newEndDate}T${newEndTime}:00+05:30`)}
                      </span>
                    </div>
                    {reason && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Reason:</span>
                        <span className="text-slate-700 italic">{reason}</span>
                      </div>
                    )}
                  </div>

                  {/* Active Inventory Transfer Breakdown Table */}
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Stock Transfer Breakdown ({summaryTotals.activeProductsCount} products receiving active stock)
                    </h4>
                    <div className="border border-slate-200/80 rounded-xl overflow-x-auto max-h-56 overflow-y-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] sticky top-0 border-b border-slate-200">
                          <tr>
                            <th scope="col" className="px-3 py-2">Product</th>
                            <th scope="col" className="px-3 py-2 text-right">Sold</th>
                            <th scope="col" className="px-3 py-2 text-right">New Alloc</th>
                            <th scope="col" className="px-3 py-2 text-right">Warehouse Pull</th>
                            <th scope="col" className="px-3 py-2 text-right">Remaining in WH</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewData &&
                            previewData.products
                              .filter(p => {
                                const alloc = allocations[p.productId] ?? p.previouslySold;
                                return alloc - p.previouslySold > 0;
                              })
                              .map(p => {
                                const alloc = allocations[p.productId] ?? p.previouslySold;
                                const activeUnits = alloc - p.previouslySold;
                                const remainingWh = p.currentWarehouse - activeUnits;

                                return (
                                  <tr key={p.productId} className="hover:bg-slate-50/70">
                                    <td className="px-3 py-2">
                                      <span className="font-bold text-slate-900">{p.productName}</span>{' '}
                                      <span className="font-mono text-[10px] text-slate-400">({p.productId})</span>
                                    </td>
                                    <td className="px-3 py-2 text-right text-slate-500">{p.previouslySold}</td>
                                    <td className="px-3 py-2 text-right font-bold text-slate-900">{alloc}</td>
                                    <td className="px-3 py-2 text-right font-bold text-blue-700">+{activeUnits}</td>
                                    <td className="px-3 py-2 text-right text-slate-700 font-semibold">{remainingWh}</td>
                                  </tr>
                                );
                              })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {submitError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  {/* Confirmation Checkbox */}
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-xl text-xs text-emerald-900 flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="confirmReopenCheckbox"
                      checked={confirmedAccuracy}
                      onChange={e => setConfirmedAccuracy(e.target.checked)}
                      className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <label htmlFor="confirmReopenCheckbox" className="text-[11px] leading-relaxed cursor-pointer font-medium">
                      I confirm the inventory allocations above. The system will atomically deduct{' '}
                      <strong>{summaryTotals.totalActiveUnits} active units</strong> from the warehouse and reopen{' '}
                      <strong>{event.name}</strong> for live sales. All historical sales and receipts remain intact.
                    </label>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      disabled={isSubmitting}
                      className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Back to Allocations</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting || !confirmedAccuracy}
                      onClick={handleConfirmReopen}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Reopening Stall...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Confirm & Reopen Stall</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
