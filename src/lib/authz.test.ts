import { describe, expect, it } from 'vitest';

import { hasPermissionForUser } from './permissions';

describe('hasPermissionForUser', () => {
  it('returns true for matching direct permission strings', () => {
    expect(hasPermissionForUser(['inventory.read', 'sales.write'], 'inventory.read')).toBe(true);
  });

  it('returns true for object-shaped permission entries', () => {
    const permissions = [
      { permission: { key: 'projects.read' } },
      { permission: { key: 'events.manage' } },
    ];

    expect(hasPermissionForUser(permissions, 'events.manage')).toBe(true);
  });

  it('returns false when no relevant permission exists', () => {
    expect(hasPermissionForUser([{ permission: { key: 'users.read' } }], 'inventory.write')).toBe(false);
  });

  it('treats a null or undefined list as no permissions', () => {
    expect(hasPermissionForUser(null, 'inventory.manage')).toBe(false);
    expect(hasPermissionForUser(undefined, 'inventory.manage')).toBe(false);
  });
});
