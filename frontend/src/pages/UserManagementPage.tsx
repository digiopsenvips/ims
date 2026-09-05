import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { User, Role } from '../types';
import {
  Users,
  Plus,
  Shield,
  KeyRound,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  Sliders,
  Check,
} from 'lucide-react';

const PERMISSION_DEFINITIONS = [
  {
    key: 'view_inventory',
    label: 'View Inventory Counts',
    description: 'Permits viewing live stock counts on the inventory dashboard.',
  },
  {
    key: 'view_revenue',
    label: 'View Sales Amounts / Revenue',
    description: 'Permits viewing financial revenue and transaction total values.',
  },
  {
    key: 'view_customer_pii',
    label: 'View Customer Names & Phone Numbers',
    description: 'Permits viewing buyer personally identifiable info (PII). Off by default.',
  },
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
    key: 'edit_inventory',
    label: 'Edit Inventory Stock',
    description: 'Permits submitting bulk intake and making manual stock adjustments.',
  },
  {
    key: 'edit_events',
    label: 'Edit Events & Allocations',
    description: 'Permits scheduling events, adjusting allocations, and ending stalls.',
  },
  {
    key: 'export_data',
    label: 'Export Data to CSV',
    description: 'Permits downloading offline CSV reports of transactions.',
  },
];

export const UserManagementPage: React.FC = () => {
  const { user: currentUser, isDeveloper, isAdmin } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  const handleDeleteUser = async (target: User) => {
    if (!window.confirm(`Are you sure you want to delete user account '${target.name}' (@${target.username})?`)) {
      return;
    }

    try {
      await api.delete(`/users/${target.id}`);
      setStatusMessage({ type: 'success', text: `User @${target.username} deleted successfully.` });
      fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to delete user' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              User Accounts & RBAC
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {isDeveloper
              ? 'Developer full access: manage accounts, passwords, and configure Head granular permissions.'
              : 'Admin access: view all system users and permission profiles (account creation/deletion restricted to Developer).'}
          </p>
        </div>

        {isDeveloper && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Create Account</span>
          </button>
        )}
      </div>

      {/* Notifications */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-md text-xs flex items-center justify-between border ${
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

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Name & Profile</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Active Head Permissions</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => {
                const isHead = u.role === 'HEAD';
                const activePermCount = u.permissions
                  ? Object.values(u.permissions).filter(Boolean).length
                  : 0;

                return (
                  <tr key={u.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{u.name}</div>
                      <div className="text-[10px] text-slate-400">{u.email || 'No email registered'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-700">
                      @{u.username}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
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
                    <td className="px-4 py-3 text-slate-600">
                      {isHead ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-slate-800">
                            {activePermCount} of {PERMISSION_DEFINITIONS.length} enabled
                          </span>
                          {isDeveloper && (
                            <button
                              onClick={() => handleOpenPermsModal(u)}
                              className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer flex items-center gap-1"
                            >
                              <Sliders className="w-3 h-3" />
                              <span>Configure</span>
                            </button>
                          )}
                        </div>
                      ) : u.role === 'DEVELOPER' || u.role === 'ADMIN' ? (
                        <span className="text-slate-400 italic">Full privileges</span>
                      ) : (
                        <span className="text-slate-400 italic">Sales entry only</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isDeveloper && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => {
                              setResetTargetUser(u);
                              setNewPassword('');
                            }}
                            className="p-1 text-slate-400 hover:text-slate-800 rounded transition-colors cursor-pointer"
                            title="Reset Password"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>

                          {u.id !== currentUser?.id && (
                            <button
                              onClick={() => handleDeleteUser(u)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                              title="Delete Account"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create User */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Create New User Account</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
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
                      className={`py-2 text-xs font-bold rounded-md border transition-all cursor-pointer ${
                        createRole === role
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
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
                  className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                  placeholder="Minimum 6 characters"
                  value={createPassword}
                  onChange={e => setCreatePassword(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              {/* If Role is HEAD, show the permission checklist right here */}
              {createRole === 'HEAD' && (
                <div className="pt-3 border-t border-slate-200">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">
                    Initial Permission Checklist
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto p-2 bg-slate-50 rounded border border-slate-200">
                    {PERMISSION_DEFINITIONS.map(p => {
                      const isChecked = !!createPerms[p.key];
                      return (
                        <label
                          key={p.key}
                          className="flex items-start gap-2.5 p-1.5 rounded hover:bg-white transition-colors cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e =>
                              setCreatePerms({ ...createPerms, [p.key]: e.target.checked })
                            }
                            className="mt-0.5 rounded text-slate-900 focus:ring-0"
                          />
                          <div>
                            <div className="text-xs font-semibold text-slate-900">{p.label}</div>
                            <div className="text-[10px] text-slate-500">{p.description}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-6 max-h-[90vh] flex flex-col">
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
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePermissions} className="flex-1 overflow-y-auto py-4 space-y-3">
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
                {PERMISSION_DEFINITIONS.map(p => {
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
                        className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${
                          isChecked ? 'bg-emerald-600 justify-end' : 'bg-slate-300 justify-start'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPermTargetUser(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Reset Password: @{resetTargetUser.username}
              </h3>
              <button
                onClick={() => setResetTargetUser(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
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
                  placeholder="Enter new password (min 6 chars)"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResetTargetUser(null)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer shadow-sm"
                >
                  {isSubmitting ? 'Updating...' : 'Confirm Password Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
