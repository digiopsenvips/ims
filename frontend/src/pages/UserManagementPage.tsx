import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { User, Role } from '../types';
import {
  Users,
  Plus,
  KeyRound,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  Sliders,
  Search,
  RotateCcw,
  Shield,
  UserCheck,
  UserMinus,
  UserX,
  ShieldAlert,
  Check,
} from 'lucide-react';

interface PermissionGroup {
  title: string;
  items: {
    key: string;
    label: string;
    description: string;
  }[];
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Inventory & Stock',
    items: [
      {
        key: 'view_inventory',
        label: 'View Inventory Counts',
        description: 'Permits viewing live stock counts on the inventory dashboard.',
      },
      {
        key: 'edit_inventory',
        label: 'Edit Inventory Stock',
        description: 'Permits submitting bulk intake and making manual stock adjustments.',
      },
    ],
  },
  {
    title: 'Financials & Revenue',
    items: [
      {
        key: 'view_revenue',
        label: 'View Sales Amounts / Revenue',
        description: 'Permits viewing financial revenue and transaction total values.',
      },
      {
        key: 'view_customer_pii',
        label: 'View Customer PII (Names & Phones)',
        description: 'Permits viewing buyer personally identifiable info. Off by default.',
      },
    ],
  },
  {
    title: 'Analytics & Reporting',
    items: [
      {
        key: 'view_analytics',
        label: 'View Analytics Dashboard',
        description: 'Permits accessing the reporting and charts page.',
      },
      {
        key: 'view_event_breakdown',
        label: 'View Per-Event Breakdown',
        description: 'Permits filtering and comparing performance by individual stalls.',
      },
      {
        key: 'export_data',
        label: 'Export Data to CSV',
        description: 'Permits downloading offline CSV reports of transactions.',
      },
    ],
  },
  {
    title: 'Stall & Event Management',
    items: [
      {
        key: 'edit_events',
        label: 'Edit Events & Allocations',
        description: 'Permits scheduling events, adjusting allocations, and concluding stalls.',
      },
    ],
  },
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.items);

export const UserManagementPage: React.FC = () => {
  const { user: currentUser, isDeveloper, isAdmin } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ACTIVE' | 'RETIRED' | 'ALL'>('ACTIVE');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createRole, setCreateRole] = useState<Role>('HEAD');
  const [createName, setCreateName] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createPerms, setCreatePerms] = useState<Record<string, boolean>>({
    view_inventory: true,
    view_revenue: true,
    view_customer_pii: false,
    view_analytics: true,
    view_event_breakdown: true,
    edit_inventory: false,
    edit_events: false,
    export_data: false,
  });

  // Permissions Modal
  const [permTargetUser, setPermTargetUser] = useState<User | null>(null);
  const [activePerms, setActivePerms] = useState<Record<string, boolean>>({});

  // Password Reset Modal
  const [resetTargetUser, setResetTargetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Retire User Modal
  const [retireTargetUser, setRetireTargetUser] = useState<User | null>(null);
  const [retireReason, setRetireReason] = useState('');

  // Reactivate User Modal
  const [reactivateTargetUser, setReactivateTargetUser] = useState<User | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      const data = await api.get('/users');
      if (data?.users) setUsers(data.users);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to fetch users' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName || !createUsername || !createPassword) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await api.post('/users', {
        name: createName,
        username: createUsername,
        email: createEmail || undefined,
        password: createPassword,
        role: createRole,
        permissions: createRole === 'HEAD' ? createPerms : undefined,
      });

      setStatusMessage({
        type: 'success',
        text: `Account created successfully for ${res.user.name} (@${res.user.username})`,
      });

      setShowCreateModal(false);
      setCreateName('');
      setCreateUsername('');
      setCreateEmail('');
      setCreatePassword('');
      fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create user' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPermsModal = (target: User) => {
    setPermTargetUser(target);
    setActivePerms(target.permissions || {});
  };

  const handleSavePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permTargetUser) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      await api.put(`/users/${permTargetUser.id}/permissions`, {
        permissions: activePerms,
      });

      setStatusMessage({
        type: 'success',
        text: `Permissions checklist updated for ${permTargetUser.name}.`,
      });

      setPermTargetUser(null);
      fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to update permissions' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser || !newPassword) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await api.post(`/users/${resetTargetUser.id}/reset-password`, {
        newPassword,
      });

      setStatusMessage({
        type: 'success',
        text: res.message || 'Password reset successfully.',
      });

      setResetTargetUser(null);
      setNewPassword('');
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to reset password' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmRetireUser = async () => {
    if (!retireTargetUser) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await api.post(`/users/${retireTargetUser.id}/retire`, {
        reason: retireReason.trim() || undefined,
      });
      setStatusMessage({
        type: 'success',
        text: res.message || `Account @${retireTargetUser.username} retired successfully. Historical sales and audit records preserved.`,
      });
      setRetireTargetUser(null);
      setRetireReason('');
      fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to retire user' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReactivateUser = async () => {
    if (!reactivateTargetUser) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await api.post(`/users/${reactivateTargetUser.id}/reactivate`);
      setStatusMessage({
        type: 'success',
        text: res.message || `Account @${reactivateTargetUser.username} reactivated successfully. User can now log in.`,
      });
      setReactivateTargetUser(null);
      fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to reactivate user' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusCounts = useMemo(() => {
    let active = 0;
    let retired = 0;
    users.forEach(u => {
      if (u.status === 'RETIRED') retired++;
      else active++;
    });
    return {
      ACTIVE: active,
      RETIRED: retired,
      ALL: users.length,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      // Status filter
      if (selectedStatus === 'ACTIVE' && u.status === 'RETIRED') return false;
      if (selectedStatus === 'RETIRED' && u.status !== 'RETIRED') return false;

      // Role filter
      if (selectedRole !== 'ALL' && u.role !== selectedRole) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName = u.name.toLowerCase().includes(query);
        const matchesUsername = u.username.toLowerCase().includes(query);
        const matchesEmail = (u.email || '').toLowerCase().includes(query);
        const matchesReason = (u.retireReason || '').toLowerCase().includes(query);
        if (!matchesName && !matchesUsername && !matchesEmail && !matchesReason) return false;
      }
      return true;
    });
  }, [users, selectedStatus, selectedRole, searchQuery]);

  const roleCounts = useMemo(() => {
    const statusFiltered = users.filter(u => {
      if (selectedStatus === 'ACTIVE') return u.status !== 'RETIRED';
      if (selectedStatus === 'RETIRED') return u.status === 'RETIRED';
      return true;
    });
    const counts: Record<string, number> = { ALL: statusFiltered.length };
    statusFiltered.forEach(u => {
      counts[u.role] = (counts[u.role] || 0) + 1;
    });
    return counts;
  }, [users, selectedStatus]);

  const hasActiveFilters = searchQuery.trim() !== '' || selectedRole !== 'ALL' || selectedStatus !== 'ACTIVE';

  return (
    <div className="space-y-5 w-full max-w-[1600px] mx-auto pb-12">
      {/* Header */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/70 flex items-center justify-center font-black shadow-xs shrink-0">
            <Users className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Users
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isDeveloper
                ? 'Developer administration: manage accounts, credentials, and configure granular role-based permissions.'
                : isAdmin
                ? 'Admin administration: create and view user accounts across Admin, Head, and Member roles.'
                : 'User accounts and permission profiles across Member, Head, and Admin roles.'}
            </p>
          </div>
        </div>

        {(isDeveloper || isAdmin) && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Create Account</span>
          </button>
        )}
      </div>

      {/* Notifications */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search and Role Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        {/* Status Tabs: Active vs Retired (for Developers & Admins) */}
        {isDeveloper && (
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 text-xs">
              <button
                type="button"
                onClick={() => setSelectedStatus('ACTIVE')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                  selectedStatus === 'ACTIVE'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Active Accounts</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                  {statusCounts.ACTIVE}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStatus('RETIRED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                  selectedStatus === 'RETIRED'
                    ? 'bg-white text-amber-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserX className="w-3.5 h-3.5 text-amber-600" />
                <span>Retired Accounts</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                    statusCounts.RETIRED > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {statusCounts.RETIRED}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStatus('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                  selectedStatus === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>All Accounts</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 text-slate-700">
                  {statusCounts.ALL}
                </span>
              </button>
            </div>

            {selectedStatus === 'RETIRED' && (
              <span className="text-[11px] text-amber-700 font-medium bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/70">
                Retired accounts are inactive and cannot log in. Historical sales & audit logs are permanently preserved.
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, username, or email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Role Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs">
              {(['ALL', 'DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER'] as const).map(role => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    selectedRole === role
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {role === 'ALL' ? 'All Roles' : role} ({roleCounts[role] || 0})
                </button>
              ))}
            </div>

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedRole('ALL');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer"
                title="Reset search and filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing <strong className="text-slate-900">{filteredUsers.length}</strong> of{' '}
            <strong className="text-slate-900">{users.length}</strong> user accounts
          </div>
        </div>
      </div>

      {/* Users Table / Mobile Card Container */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        {/* Mobile User Cards (<md) */}
        <div className="md:hidden divide-y divide-slate-100">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400">
              <Users className="w-6 h-6 mx-auto mb-2 animate-bounce text-slate-400" />
              <p className="font-semibold text-slate-600 text-xs">Loading user accounts...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-2">
                <Search className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">No matching user accounts</h3>
              <p className="text-xs text-slate-500 mt-1">No accounts match your active search or role criteria.</p>
            </div>
          ) : (
            filteredUsers.map(u => {
              const isHead = u.role === 'HEAD';
              const activePermCount = u.permissions
                ? Object.values(u.permissions).filter(Boolean).length
                : 0;

              return (
                <div key={u.id} className="p-3 bg-white space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{u.name}</span>
                        {u.status === 'RETIRED' && (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                            <UserX className="w-3 h-3 text-amber-600" /> RETIRED
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="font-mono font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 text-[11px]">
                          @{u.username}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {u.email || 'No email'}
                        </span>
                      </div>
                      {u.status === 'RETIRED' && u.retiredAt && (
                        <div className="text-[10px] text-amber-700 mt-1">
                          Retired {new Date(u.retiredAt).toLocaleDateString()} {u.retiredByName ? `by ${u.retiredByName}` : ''}
                          {u.retireReason ? ` • "${u.retireReason}"` : ''}
                        </div>
                      )}
                    </div>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider shrink-0 ${
                        u.role === 'DEVELOPER'
                          ? 'bg-purple-50 text-purple-800 border border-purple-200'
                          : u.role === 'ADMIN'
                          ? 'bg-blue-50 text-blue-800 border border-blue-200'
                          : u.role === 'HEAD'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {u.role}
                    </span>
                  </div>

                  {isHead && u.status !== 'RETIRED' && (
                    <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-xs">
                      <span className="text-slate-700 font-medium">
                        Head Permissions: <span className="font-bold text-indigo-700">{activePermCount} active</span>
                      </span>
                      {isDeveloper && (
                        <button
                          onClick={() => handleOpenPermsModal(u)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                        >
                          <Sliders className="w-3 h-3" />
                          <span>Configure</span>
                        </button>
                      )}
                    </div>
                  )}

                  {isDeveloper && (
                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-50">
                      {u.status === 'RETIRED' ? (
                        <button
                          type="button"
                          onClick={() => setReactivateTargetUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer border border-emerald-200"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Reactivate Account
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setResetTargetUser(u);
                              setNewPassword('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-slate-500" /> Reset Password
                          </button>

                          {u.id !== currentUser?.id && u.role !== 'DEVELOPER' && (
                            <button
                              type="button"
                              onClick={() => {
                                setRetireTargetUser(u);
                                setRetireReason('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer border border-amber-200"
                            >
                              <UserMinus className="w-3.5 h-3.5 text-amber-600" /> Retire
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table View (>=md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[780px] border-collapse">
            <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th scope="col" className="px-5 py-3.5 min-w-[200px]">Name & Profile</th>
                <th scope="col" className="px-5 py-3.5 w-36 whitespace-nowrap">Username</th>
                <th scope="col" className="px-5 py-3.5 w-32 whitespace-nowrap">Role</th>
                <th scope="col" className="px-5 py-3.5 min-w-[180px]">Active Head Permissions</th>
                <th scope="col" className="px-5 py-3.5 text-right w-28 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    <Users className="w-6 h-6 mx-auto mb-2 animate-bounce text-slate-400" />
                    <p className="font-semibold text-slate-600">Loading user accounts...</p>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center">
                    <div className="max-w-sm mx-auto space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-1">
                        <Search className="w-5 h-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">No matching user accounts</h3>
                      <p className="text-xs text-slate-500">
                        No accounts match your active search or role criteria.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map(u => {
                  const isHead = u.role === 'HEAD';
                  const activePermCount = u.permissions
                    ? Object.values(u.permissions).filter(Boolean).length
                    : 0;

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{u.name}</span>
                          {u.status === 'RETIRED' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                              <UserX className="w-3 h-3 text-amber-600" /> RETIRED
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {u.email ? u.email : 'No email registered'}
                        </div>
                        {u.status === 'RETIRED' && u.retiredAt && (
                          <div className="text-[10px] text-amber-700 mt-1 flex items-center gap-1">
                            <span>Retired {new Date(u.retiredAt).toLocaleDateString()}</span>
                            {u.retiredByName && <span>by {u.retiredByName}</span>}
                            {u.retireReason && <span className="text-slate-500 italic">• "{u.retireReason}"</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="font-mono font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 text-xs whitespace-nowrap">
                          @{u.username}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap ${
                            u.role === 'DEVELOPER'
                              ? 'bg-purple-50 text-purple-800 border border-purple-200'
                              : u.role === 'ADMIN'
                              ? 'bg-blue-50 text-blue-800 border border-blue-200'
                              : u.role === 'HEAD'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap">
                        {u.status === 'RETIRED' ? (
                          <span className="text-amber-600 italic text-xs whitespace-nowrap">Account retired — login disabled</span>
                        ) : isHead ? (
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
                              {activePermCount} of {ALL_PERMISSIONS.length} enabled
                            </span>
                            {isDeveloper && (
                              <button
                                onClick={() => handleOpenPermsModal(u)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200/80 hover:bg-indigo-100 transition-colors cursor-pointer whitespace-nowrap"
                              >
                                <Sliders className="w-3 h-3" />
                                <span>Configure</span>
                              </button>
                            )}
                          </div>
                        ) : u.role === 'DEVELOPER' || u.role === 'ADMIN' ? (
                          <span className="text-slate-400 italic text-xs whitespace-nowrap">Full privileges</span>
                        ) : (
                          <span className="text-slate-400 italic text-xs whitespace-nowrap">Sales entry only</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        {isDeveloper && (
                          <div className="inline-flex items-center gap-1.5">
                            {u.status === 'RETIRED' ? (
                              <button
                                type="button"
                                onClick={() => setReactivateTargetUser(u)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer border border-emerald-200"
                                title={`Reactivate @${u.username}`}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Reactivate</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setResetTargetUser(u);
                                    setNewPassword('');
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                  title={`Reset password for @${u.username}`}
                                  aria-label={`Reset password for @${u.username}`}
                                >
                                  <KeyRound className="w-4 h-4" />
                                </button>

                                {u.id !== currentUser?.id && u.role !== 'DEVELOPER' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRetireTargetUser(u);
                                      setRetireReason('');
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                    title={`Retire account @${u.username}`}
                                    aria-label={`Retire account @${u.username}`}
                                  >
                                    <UserMinus className="w-4 h-4 text-amber-600" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create User */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Create New User Account</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="flex-1 overflow-y-auto py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Account Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['ADMIN', 'HEAD', 'MEMBER'] as const).map(role => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setCreateRole(role)}
                      className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                        createRole === role
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Diya Sharma"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. diya_sharma"
                    value={createUsername}
                    onChange={e => setCreateUsername(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    placeholder="diya@enactus-vips.org"
                    value={createEmail}
                    onChange={e => setCreateEmail(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Initial Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Minimum 6 characters"
                  value={createPassword}
                  onChange={e => setCreatePassword(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              {/* If Role is HEAD, show the permission checklist */}
              {createRole === 'HEAD' && (
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Initial Permission Checklist
                  </div>
                  <div className="space-y-3 max-h-56 overflow-y-auto p-3 bg-slate-50/80 rounded-xl border border-slate-200">
                    {PERMISSION_GROUPS.map(group => (
                      <div key={group.title} className="space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {group.title}
                        </div>
                        {group.items.map(p => {
                          const isChecked = !!createPerms[p.key];
                          return (
                            <label
                              key={p.key}
                              className="flex items-start gap-2.5 p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e =>
                                  setCreatePerms({ ...createPerms, [p.key]: e.target.checked })
                                }
                                className="mt-0.5 rounded text-emerald-600 focus:ring-0 cursor-pointer"
                              />
                              <div>
                                <div className="text-xs font-semibold text-slate-900">{p.label}</div>
                                <div className="text-[10px] text-slate-500">{p.description}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Granular Permission Checklist for Head */}
      {permTargetUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Configure Permissions: {permTargetUser.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Granular feature toggles for @{permTargetUser.username} (Head)
                </p>
              </div>
              <button
                onClick={() => setPermTargetUser(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePermissions} className="flex-1 overflow-y-auto py-4 space-y-4">
              <div className="space-y-4">
                {PERMISSION_GROUPS.map(group => (
                  <div key={group.title} className="space-y-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">
                      {group.title}
                    </div>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                      {group.items.map(p => {
                        const isChecked = !!activePerms[p.key];
                        return (
                          <div
                            key={p.key}
                            onClick={() =>
                              setActivePerms({ ...activePerms, [p.key]: !isChecked })
                            }
                            className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <div>
                              <div className="text-xs font-bold text-slate-900">{p.label}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5">{p.description}</div>
                            </div>

                            <div
                              className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${
                                isChecked ? 'bg-emerald-600 justify-end' : 'bg-slate-300 justify-start'
                              }`}
                            >
                              <div className="w-5 h-5 rounded-full bg-white shadow-xs" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPermTargetUser(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Password Reset */}
      {resetTargetUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Reset Password
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  @{resetTargetUser.username} ({resetTargetUser.name})
                </p>
              </div>
              <button
                onClick={() => setResetTargetUser(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter new password (minimum 6 chars)"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResetTargetUser(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shadow-xs"
                >
                  {isSubmitting ? 'Updating...' : 'Confirm Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Retire User Confirmation */}
      {retireTargetUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200/60">
                <UserMinus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Retire Account: @{retireTargetUser.username}?
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {retireTargetUser.name} • {retireTargetUser.role}
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-2 mb-4">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Permanent Attribution & Security Notice</span>
              </div>
              <p className="leading-relaxed text-amber-800">
                Retiring this account immediately revokes login access and hides the user from active lists.
              </p>
              <ul className="list-disc pl-4 space-y-1 text-amber-800 text-[11px]">
                <li>Historical sales, stall transactions, and audit logs are <strong>permanently preserved</strong> and retain @{retireTargetUser.username}'s attribution.</li>
                <li>Historical transactions are <strong>never reassigned</strong> to any other user.</li>
                <li>You can reactivate this account at any time from the Retired Accounts view.</li>
              </ul>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Retirement Reason (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Tenure completed, graduated, department change..."
                value={retireReason}
                onChange={e => setRetireReason(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setRetireTargetUser(null);
                  setRetireReason('');
                }}
                disabled={isSubmitting}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmRetireUser}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Retiring Account...</span>
                  </>
                ) : (
                  <>
                    <UserMinus className="w-3.5 h-3.5" />
                    <span>Retire Account</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reactivate User Confirmation */}
      {reactivateTargetUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Reactivate Account: @{reactivateTargetUser.username}?
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {reactivateTargetUser.name} • {reactivateTargetUser.role}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Reactivating this account will restore active status and allow @{reactivateTargetUser.username} to log into the IMS again. All historical sales and records remain permanently attributed.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReactivateTargetUser(null)}
                disabled={isSubmitting}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmReactivateUser}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Reactivating...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Reactivate Account</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
