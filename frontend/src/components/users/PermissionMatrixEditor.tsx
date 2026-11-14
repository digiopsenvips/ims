import React, { useState, useMemo } from 'react';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_TEMPLATES,
  PermissionDefinition,
  PermissionCategory,
  PermissionGroupType,
  ALL_PERMISSION_KEYS,
} from '../../constants/permissions';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Sliders,
  DollarSign,
  Activity,
  Layers,
} from 'lucide-react';

interface PermissionMatrixEditorProps {
  permissions: Record<string, boolean>;
  onChange: (updated: Record<string, boolean>) => void;
  disabled?: boolean;
}

export const PermissionMatrixEditor: React.FC<PermissionMatrixEditorProps> = ({
  permissions,
  onChange,
  disabled = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<'ALL' | PermissionGroupType | 'SENSITIVE'>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    DASHBOARD: true,
    EVENTS: true,
    PRODUCTS: true,
    INVENTORY: true,
    COMBOS: true,
    SALES: true,
    SPECIAL_SALES: true,
    GAMES: true,
    ANALYTICS: true,
    USERS: true,
    WHATSAPP: true,
  });

  // Calculate stats
  const activeCount = useMemo(() => {
    return Object.values(permissions).filter(Boolean).length;
  }, [permissions]);

  const activeOperationalCount = useMemo(() => {
    return PERMISSION_DEFINITIONS.filter(p => p.group === 'OPERATIONAL' && permissions[p.key]).length;
  }, [permissions]);

  const activeFinancialCount = useMemo(() => {
    return PERMISSION_DEFINITIONS.filter(p => p.group === 'FINANCIAL' && permissions[p.key]).length;
  }, [permissions]);

  const activeAdminCount = useMemo(() => {
    return PERMISSION_DEFINITIONS.filter(p => p.group === 'SECURITY_ADMIN' && permissions[p.key]).length;
  }, [permissions]);

  // Apply template
  const handleApplyTemplate = (templateId: string) => {
    if (!templateId) return;
    const template = PERMISSION_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;

    // Reset all to false, then set template keys
    const next: Record<string, boolean> = {};
    for (const key of ALL_PERMISSION_KEYS) {
      next[key] = !!template.permissions[key];
    }
    onChange(next);
  };

  // Toggle single permission
  const handleToggle = (key: string) => {
    if (disabled) return;
    onChange({
      ...permissions,
      [key]: !permissions[key],
    });
  };

  // Category select all / deselect all
  const handleCategoryToggleAll = (catDefs: PermissionDefinition[], enable: boolean) => {
    if (disabled) return;
    const next = { ...permissions };
    for (const p of catDefs) {
      next[p.key] = enable;
    }
    onChange(next);
  };

  // Global Select All / Clear All
  const handleSelectAll = (enable: boolean) => {
    if (disabled) return;
    const next: Record<string, boolean> = {};
    for (const key of ALL_PERMISSION_KEYS) {
      next[key] = enable;
    }
    onChange(next);
  };

  // Filter definitions
  const filteredDefinitions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return PERMISSION_DEFINITIONS.filter(p => {
      // Group filter
      if (groupFilter === 'OPERATIONAL' && p.group !== 'OPERATIONAL') return false;
      if (groupFilter === 'FINANCIAL' && p.group !== 'FINANCIAL') return false;
      if (groupFilter === 'SECURITY_ADMIN' && p.group !== 'SECURITY_ADMIN') return false;
      if (groupFilter === 'SENSITIVE' && !p.isSensitive) return false;

      // Category filter
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;

      // Search query
      if (q) {
        const matchesKey = p.key.toLowerCase().includes(q);
        const matchesLabel = p.label.toLowerCase().includes(q);
        const matchesDesc = p.description.toLowerCase().includes(q);
        const matchesCat = p.categoryLabel.toLowerCase().includes(q);
        if (!matchesKey && !matchesLabel && !matchesDesc && !matchesCat) return false;
      }

      return true;
    });
  }, [searchQuery, groupFilter, selectedCategory]);

  // Group filtered definitions by category
  const groupedByCategory = useMemo(() => {
    const map = new Map<string, { label: string; items: PermissionDefinition[] }>();
    for (const def of filteredDefinitions) {
      if (!map.has(def.category)) {
        map.set(def.category, { label: def.categoryLabel, items: [] });
      }
      map.get(def.category)!.items.push(def);
    }
    return Array.from(map.entries());
  }, [filteredDefinitions]);

  const toggleCategoryExpand = (cat: string) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="space-y-3.5">
      {/* 1. TEMPLATE SELECTOR BAR */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Apply Role / Responsibility Template</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Permission Template Selector"
              disabled={disabled}
              onChange={e => handleApplyTemplate(e.target.value)}
              defaultValue=""
              className="text-xs bg-white font-medium border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 cursor-pointer text-slate-700 shadow-2xs"
            >
              <option value="" disabled>Choose a template...</option>
              {PERMISSION_TEMPLATES.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Counter Ribbon */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
          <span className="font-bold text-slate-600">Selected:</span>
          <span className="px-2 py-0.5 rounded-md font-bold bg-blue-100/70 text-blue-800 border border-blue-200/70">
            {activeOperationalCount} Operational
          </span>
          <span className={`px-2 py-0.5 rounded-md font-bold border ${
            activeFinancialCount > 0
              ? 'bg-amber-100/70 text-amber-800 border-amber-200/80'
              : 'bg-emerald-100/60 text-emerald-800 border-emerald-200/60'
          }`}>
            {activeFinancialCount} Financial
          </span>
          {activeAdminCount > 0 && (
            <span className="px-2 py-0.5 rounded-md font-bold bg-purple-100/70 text-purple-800 border border-purple-200/70">
              {activeAdminCount} Admin
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => handleSelectAll(true)}
              className="text-[10px] font-bold text-slate-600 hover:text-slate-900 underline cursor-pointer disabled:opacity-40"
            >
              Select All
            </button>
            <span className="text-slate-300">•</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => handleSelectAll(false)}
              className="text-[10px] font-bold text-rose-600 hover:text-rose-800 underline cursor-pointer disabled:opacity-40"
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Security Boundary Notice */}
        {activeFinancialCount === 0 ? (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-800 bg-emerald-50/80 px-2 py-1 rounded-md border border-emerald-200/60">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span><strong>Strict Operational Separation:</strong> This user has zero financial visibility. Total revenue, profit margins, and sales amounts are hidden and masked on all views and API responses.</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-900 bg-amber-50/80 px-2 py-1 rounded-md border border-amber-200/80">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span><strong>Financial Visibility Granted:</strong> User has access to {activeFinancialCount} sensitive financial metrics (revenue, transaction amounts, payment summaries).</span>
          </div>
        )}
      </div>

      {/* 2. SEARCH & FILTER CONTROLS */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search permissions by name, key, or action..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 text-slate-800 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              ×
            </button>
          )}
        </div>

        {/* Group Filter Pills */}
        <div className="flex items-center gap-1 shrink-0 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setGroupFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
              groupFilter === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({PERMISSION_DEFINITIONS.length})
          </button>
          <button
            type="button"
            onClick={() => setGroupFilter('OPERATIONAL')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
              groupFilter === 'OPERATIONAL'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60'
            }`}
          >
            Operational
          </button>
          <button
            type="button"
            onClick={() => setGroupFilter('FINANCIAL')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
              groupFilter === 'FINANCIAL'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/60'
            }`}
          >
            Financial
          </button>
          <button
            type="button"
            onClick={() => setGroupFilter('SENSITIVE')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
              groupFilter === 'SENSITIVE'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200/60'
            }`}
          >
            Sensitive
          </button>
        </div>
      </div>

      {/* 3. PERMISSION CATEGORIES ACCORDION / LIST */}
      <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
        {groupedByCategory.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl text-slate-500 text-xs">
            No permissions found matching "{searchQuery}".
          </div>
        ) : (
          groupedByCategory.map(([catKey, { label, items }]) => {
            const isExpanded = expandedCategories[catKey] ?? true;
            const categoryActiveCount = items.filter(i => permissions[i.key]).length;
            const allChecked = categoryActiveCount === items.length && items.length > 0;

            return (
              <div
                key={catKey}
                className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs"
              >
                {/* Category Header */}
                <div className="bg-slate-50/80 px-3 py-2 flex items-center justify-between border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => toggleCategoryExpand(catKey)}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-900 hover:text-slate-700 cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>{label}</span>
                    <span className="text-[10px] font-semibold text-slate-500 ml-1">
                      ({categoryActiveCount}/{items.length})
                    </span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => handleCategoryToggleAll(items, !allChecked)}
                      className="text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 cursor-pointer disabled:opacity-40"
                    >
                      {allChecked ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                </div>

                {/* Items in Category */}
                {isExpanded && (
                  <div className="divide-y divide-slate-100">
                    {items.map(p => {
                      const isChecked = !!permissions[p.key];
                      const isFinancial = p.group === 'FINANCIAL';
                      const isOperational = p.group === 'OPERATIONAL';
                      const isSecurityAdmin = p.group === 'SECURITY_ADMIN';

                      return (
                        <div
                          key={p.key}
                          onClick={() => handleToggle(p.key)}
                          className={`p-2.5 sm:px-3 sm:py-2.5 flex items-start sm:items-center justify-between gap-3 transition-colors cursor-pointer ${
                            isChecked
                              ? isFinancial
                                ? 'bg-amber-50/40 hover:bg-amber-50/60'
                                : 'bg-blue-50/30 hover:bg-blue-50/50'
                              : 'hover:bg-slate-50/80'
                          }`}
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900">{p.label}</span>

                              {/* Group badge */}
                              {isOperational && (
                                <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-blue-100/70 text-blue-800 border border-blue-200/60">
                                  OPERATIONAL
                                </span>
                              )}
                              {isFinancial && (
                                <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-amber-100/80 text-amber-900 border border-amber-300/80 flex items-center gap-0.5">
                                  <DollarSign className="w-2.5 h-2.5" />
                                  <span>FINANCIAL</span>
                                </span>
                              )}
                              {isSecurityAdmin && (
                                <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-purple-100/80 text-purple-900 border border-purple-200/80">
                                  ADMIN
                                </span>
                              )}

                              {p.isSensitive && (
                                <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  <span>SENSITIVE</span>
                                </span>
                              )}
                            </div>

                            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                              {p.description}
                            </p>
                            <span className="text-[9px] font-mono text-slate-400 block mt-0.5">
                              {p.key}
                            </span>
                          </div>

                          {/* Toggle Switch */}
                          <div className="shrink-0 pt-0.5 sm:pt-0">
                            <div
                              className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 cursor-pointer ${
                                isChecked
                                  ? isFinancial
                                    ? 'bg-amber-600 justify-end'
                                    : 'bg-emerald-600 justify-end'
                                  : 'bg-slate-300 justify-start'
                              }`}
                            >
                              <div className="w-4 h-4 rounded-full bg-white shadow-xs" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
