export function hasPermissionForUser(
  userPermissions: Array<{ permission?: { key?: string | null } | null } | string> | null | undefined,
  permissionKey: string,
): boolean {
  return (userPermissions ?? []).some((entry) => {
    if (typeof entry === 'string') {
      return entry === permissionKey;
    }

    return entry?.permission?.key === permissionKey;
  });
}
