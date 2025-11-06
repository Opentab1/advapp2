import type { User, AdminUser, ClientUser } from '../types';

// Type guards
export function isAdminUser(user: User | null): user is AdminUser {
  if (!user) return false;
  return ['admin', 'sales', 'support', 'installer'].includes(user.role) && !user.venueId;
}

export function isClientUser(user: User | null): user is ClientUser {
  if (!user) return false;
  return ['owner', 'manager', 'staff', 'custom'].includes(user.role) && !!user.venueId;
}

// Permission checks
export function canSkipTerms(user: User | null): boolean {
  return isAdminUser(user);
}

export function canCreateVenues(user: User | null): boolean {
  if (!isAdminUser(user)) return false;
  return ['admin', 'sales'].includes(user.role);
}

export function canDeleteVenues(user: User | null): boolean {
  if (!isAdminUser(user)) return false;
  return user.role === 'admin';
}

export function canManageUsers(user: User | null): boolean {
  if (!isAdminUser(user)) return false;
  return ['admin', 'sales'].includes(user.role);
}

export function canViewAuditLogs(user: User | null): boolean {
  if (!isAdminUser(user)) return false;
  return user.role === 'admin';
}

export function canGenerateConfigs(user: User | null): boolean {
  if (!isAdminUser(user)) return false;
  return ['admin', 'sales', 'installer'].includes(user.role);
}

export function canViewAllVenues(user: User | null): boolean {
  return isAdminUser(user);
}

// Get user display name
export function getUserDisplayName(user: User | null): string {
  if (!user) return 'Guest';
  return user.email?.split('@')[0] || 'User';
}

// Get user role display
export function getUserRoleDisplay(role: User['role']): string {
  const roleMap = {
    owner: 'Owner',
    manager: 'Manager',
    staff: 'Staff',
    admin: 'Super Admin',
    sales: 'Sales Team',
    support: 'Support Team',
    installer: 'Installer',
    custom: 'Custom Role'
  };
  return roleMap[role] || role;
}
