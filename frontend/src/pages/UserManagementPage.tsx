import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { User, Role } from '../types';
import {
  Users,
  Plus,
  KeyRound,
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
  ShieldCheck,
  DollarSign,
  Activity,
  History,
} from 'lucide-react';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_TEMPLATES,
  ROLE_TEMPLATES,
  ALL_PERMISSION_KEYS,
} from '../constants/permissions';
import { PermissionMatrixEditor } from '../components/users/PermissionMatrixEditor';
import { AuditLogsViewer } from '../components/users/AuditLogsViewer';

export const UserManagementPage: React.FC = () => {
  const { user: currentUser, isDeveloper, isAdmin } = useAuth();

  // Navigation tabs for Developers
  const [activeTab, setActiveTab] = useState<'USERS' | 'AUDIT'>('USERS');

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
  const [createDepartment, setCreateDepartment] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createPerms, setCreatePerms] = useState<Record<string, boolean>>(() => {
    return { ...(ROLE_TEMPLATES.HEAD || {}) };
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

  // Update default permissions when creating a user if role changes
  const handleCreateRoleChange = (newRole: Role) => {
    setCreateRole(newRole);
    if (newRole === 'HEAD') {
      setCreatePerms({ ...(ROLE_TEMPLATES.HEAD || {}) });
    } else if (newRole === 'ADMIN') {
      setCreatePerms({ ...(ROLE_TEMPLATES.ADMIN || {}) });
    } else if (newRole === 'MEMBER') {
      setCreatePerms({ ...(ROLE_TEMPLATES.MEMBER || {}) });
    } else if (newRole === 'DEVELOPER') {
      setCreatePerms({ ...(ROLE_TEMPLATES.DEVELOPER || {}) });
    }
  };

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
        department: createDepartment || undefined,
        password: createPassword,
        role: createRole,
        permissions: createPerms,
      });

      setStatusMessage({
        type: 'success',
        text: `Account created successfully for ${res.user.name} (@${res.user.username})`,
      });

      setShowCreateModal(false);
      setCreateName('');
      setCreateUsername('');
      setCreateEmail('');
      setCreateDepartment('');
      setCreatePassword('');
      setCreatePerms({ ...(ROLE_TEMPLATES.HEAD || {}) });
      fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create user' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPermsModal = (target: User) => {
    setPermTargetUser(target);
    // If target has existing custom permissions, initialize with them; otherwise fallback to role template
    const initial = target.permissions && Object.keys(target.permissions).length > 0
      ? target.permissions
      : (ROLE_TEMPLATES[target.role] || {});
    setActivePerms({ ...initial });
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
        text: `Permissions updated successfully for ${permTargetUser.name} (@${permTargetUser.username}).`,
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
        text: res.message || `Account @${reactivateTargetUser.username} reactivated successfully.`,
      });

      setReactivateTargetUser(null);
      fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to reactivate user' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status Counts
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

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      // 1. Status Filter
      if (selectedStatus === 'ACTIVE' && u.status === 'RETIRED') return false;
      if (selectedStatus === 'RETIRED' && u.status !== 'RETIRED') return false;

      // 2. Role Filter
      if (selectedRole !== 'ALL' && u.role !== selectedRole) return false;

      // 3. Search Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = u.name.toLowerCase().includes(query);
        const matchesUsername = u.username.toLowerCase().includes(query);
        const matchesEmail = (u.email || '').toLowerCase().includes(query);
        const matchesDept = (u.department || '').toLowerCase().includes(query);
        const matchesReason = (u.retireReason || '').toLowerCase().includes(query);
        if (!matchesName && !matchesUsername && !matchesEmail && !matchesDept && !matchesReason) {
          return false;
        }
      }

      return true;
    });
  }, [users, selectedStatus, selectedRole, searchQuery]);

  // Role Counts (within current status filter)
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

  // Helper to summarize permissions on table row
  const getPermissionSummary = (u: User) => {
    if (u.role === 'DEVELOPER') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
          <ShieldCheck className="w-3 h-3 text-purple-600" />
          <span>All-Access (Developer)</span>
        </span>
      );
    }

    const perms = u.permissions || ROLE_TEMPLATES[u.role] || {};
    const operCount = PERMISSION_DEFINITIONS.filter(p => p.group === 'OPERATIONAL' && perms[p.key]).length;
    const finCount = PERMISSION_DEFINITIONS.filter(p => p.group === 'FINANCIAL' && perms[p.key]).length;

    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="px-2 py-0.5 rounded font-bold bg-blue-50 text-blue-800 border border-blue-200">
          {operCount} Oper.
        </span>
        <span className={`px-2 py-0.5 rounded font-bold border ${
          finCount > 0
            ? 'bg-amber-50 text-amber-800 border-amber-300'
            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
        }`}>
          {finCount > 0 ? `${finCount} Financial` : '0 Financial (Masked)'}
        </span>
      </div>
    );
  };

  // Helper to determine if current user can configure target's permissions
  const canConfigurePerms = (target: User) => {
    if (target.status === 'RETIRED') return false;
    if (isDeveloper) return target.role !== 'DEVELOPER'; // Developer can configure Admin, Head, Member
    if (isAdmin) return target.role === 'HEAD' || target.role === 'MEMBER'; // Admin can configure Head, Member
    return false;
  };

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
              User Accounts &amp; Permissions
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isDeveloper
                ? 'Developer administration: manage accounts, credentials, granular role-based permissions, and inspect security audit logs.'
                : isAdmin
                ? 'Admin administration: manage team member accounts and operational permissions.'
                : 'User directory and assigned permissions.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {(isDeveloper || isAdmin) && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Account</span>
            </button>
          )}
        </div>
      </div>

      {/* Developer Top Tabs: Users Directory vs Security Audit Trail */}
      {isDeveloper && (
        <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('USERS')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 ${
              activeTab === 'USERS'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>User Accounts Directory ({users.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('AUDIT')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 ${
              activeTab === 'AUDIT'
                ? 'bg-purple-900 text-white shadow-xs'
                : 'text-purple-700 hover:text-purple-900 hover:bg-purple-50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Security Audit Trail</span>
          </button>
        </div>
      )}

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

      {/* TAB CONTENT */}
      {activeTab === 'AUDIT' && isDeveloper ? (
        <AuditLogsViewer />
      ) : (
        <>
          {/* Search and Role Filter Toolbar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            {/* Status Tabs: Active vs Retired */}
            {(isDeveloper || isAdmin) && (
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
                    <span>Active Accounts ({statusCounts.ACTIVE})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedStatus('RETIRED')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                      selectedStatus === 'RETIRED'
                        ? 'bg-white text-amber-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserMinus className="w-3.5 h-3.5 text-amber-600" />
                    <span>Retired Accounts ({statusCounts.RETIRED})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedStatus('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      selectedStatus === 'ALL'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All ({statusCounts.ALL})
                  </button>
                </div>

                {selectedStatus === 'RETIRED' && (
                  <div className="text-xs text-amber-800 bg-amber-50 px-3 py-1 rounded-lg border border-amber-200">
                    Retired accounts cannot log in, but historical attribution and audit logs remain permanently preserved.
                  </div>
                )}
              </div>
            )}

            {/* Search Input and Role Filter Pills */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by name, username, or department..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              {/* Role filter buttons */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                {['ALL', 'DEVELOPER', 'ADMIN', 'HEAD', 'MEMBER'].map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSelectedRole(role)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      selectedRole === role
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {role === 'ALL' ? 'All Roles' : role} ({roleCounts[role] || 0})
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* User Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-5">Name &amp; Profile</th>
                    <th className="py-3 px-5">Username</th>
                    <th className="py-3 px-5">Role</th>
                    <th className="py-3 px-5">Permissions &amp; Access Profile</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400">
                        <Users className="w-6 h-6 animate-bounce mx-auto mb-2 text-slate-400" />
                        <span>Loading user accounts...</span>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400">
                        No user accounts match your search and filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map(u => {
                      const isRetired = u.status === 'RETIRED';
                      const configurable = canConfigurePerms(u);

                      return (
                        <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm">{u.name}</span>
                              {isRetired && (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                                  <UserX className="w-3 h-3 text-amber-600" /> RETIRED
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {u.email || 'No email registered'}
                              {u.department && ` • ${u.department}`}
                            </div>
                            {isRetired && u.retiredAt && (
                              <div className="text-[10px] text-amber-700 mt-1 flex items-center gap-1">
                                <span>Retired {new Date(u.retiredAt).toLocaleDateString()}</span>
                                {u.retiredByName && <span>by {u.retiredByName}</span>}
                                {u.retireReason && <span className="text-slate-500 italic">• "{u.retireReason}"</span>}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-5 whitespace-nowrap">
                            <span className="font-mono font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 text-xs">
                              @{u.username}
                            </span>
                          </td>

                          <td className="py-3.5 px-5 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
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

                          <td className="py-3.5 px-5 whitespace-nowrap">
                            {isRetired ? (
                              <span className="text-amber-600 italic text-xs">Login disabled</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                {getPermissionSummary(u)}
                                {configurable && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPermsModal(u)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
                                  >
                                    <Sliders className="w-3 h-3" />
                                    <span>Configure</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {/* Reset Password */}
                              {(isDeveloper || (isAdmin && u.role !== 'DEVELOPER')) && (
                                <button
                                  type="button"
                                  onClick={() => setResetTargetUser(u)}
                                  title="Reset password"
                                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                >
                                  <KeyRound className="w-4 h-4" />
                                </button>
                              )}

                              {/* Retire / Reactivate Account */}
                              {(isDeveloper || (isAdmin && u.role !== 'DEVELOPER' && u.role !== 'ADMIN')) && (
                                isRetired ? (
                                  <button
                                    type="button"
                                    onClick={() => setReactivateTargetUser(u)}
                                    title="Reactivate account"
                                    className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setRetireTargetUser(u)}
                                    title="Retire account (disables login, preserves all sales & audit history)"
                                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                  >
                                    <UserMinus className="w-4 h-4" />
                                  </button>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================= MODAL: CREATE ACCOUNT WITH PERMISSIONS ================= */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full p-5 sm:p-6 max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Create New User Account</h3>
                <p className="text-xs text-slate-500">Configure credentials and assign operational vs financial permissions.</p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="flex-1 overflow-y-auto py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Username *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. rahul"
                    value={createUsername}
                    onChange={e => setCreateUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    placeholder="rahul@example.com"
                    value={createEmail}
                    onChange={e => setCreateEmail(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Department / Project (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Operations, Logistics, Outreach"
                    value={createDepartment}
                    onChange={e => setCreateDepartment(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    System Role *
                  </label>
                  <select
                    value={createRole}
                    onChange={e => handleCreateRoleChange(e.target.value as Role)}
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 bg-white"
                  >
                    <option value="MEMBER">MEMBER (Frontline POS &amp; Game Play)</option>
                    <option value="HEAD">HEAD (Stall &amp; Module Leads)</option>
                    {isDeveloper && <option value="ADMIN">ADMIN (Senior Operations)</option>}
                    {isDeveloper && <option value="DEVELOPER">DEVELOPER (Full System Access)</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Password *
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
              </div>

              {/* Granular Permission Matrix */}
              <div className="pt-4 border-t border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Granular Permission Profile
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Customize feature access or pick a template above
                  </span>
                </div>

                <PermissionMatrixEditor
                  permissions={createPerms}
                  onChange={setCreatePerms}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
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

      {/* ================= MODAL: CONFIGURE PERMISSIONS FOR ANY USER ================= */}
      {permTargetUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full p-5 sm:p-6 max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Configure Permissions: {permTargetUser.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  @{permTargetUser.username} • {permTargetUser.role}
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
              <PermissionMatrixEditor
                permissions={activePerms}
                onChange={setActivePerms}
              />

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
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

      {/* ================= MODAL: PASSWORD RESET ================= */}
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
                  onClick={() => {
                    setResetTargetUser(null);
                    setNewPassword('');
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating...' : 'Confirm Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: RETIRE USER CONFIRMATION ================= */}
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
                <span>Permanent Attribution &amp; Security Notice</span>
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

      {/* ================= MODAL: REACTIVATE USER CONFIRMATION ================= */}
      {reactivateTargetUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200">
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

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Reactivating this account will restore active status and allow the user to log in again. All historical sales and records will continue to be linked to this account.
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
