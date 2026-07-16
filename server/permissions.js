'use strict';
const db = require('./db');

// The permission catalog is fixed. Roles are just named bundles of these keys,
// created per-org through the UI (see routes/org.js). Nothing in the request
// handlers ever compares against a role *name* — only against these keys.
const PERMISSION_CATALOG = [
  { key: 'load.create', label: 'Create loads', applies_to: 'broker' },
  { key: 'load.assign_carrier', label: 'Assign carrier to load', applies_to: 'broker' },
  { key: 'load.override_compliance_flag', label: 'Override compliance flag', applies_to: 'broker' },
  { key: 'rate.confirm', label: 'Confirm rate', applies_to: 'broker' },
  { key: 'load.update_status', label: 'Update load status', applies_to: 'both' },
  { key: 'staff.manage', label: 'Manage staff & roles', applies_to: 'both' },
  { key: 'pod.upload', label: 'Upload proof of delivery', applies_to: 'carrier' },
];

function seedPermissions() {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO permissions (key, label, applies_to) VALUES (?, ?, ?)`
  );
  for (const p of PERMISSION_CATALOG) insert.run(p.key, p.label, p.applies_to);
}

function permissionsForRole(roleId) {
  if (!roleId) return [];
  const rows = db
    .prepare(
      `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`
    )
    .all(roleId);
  return rows.map((r) => r.key);
}

// Admins implicitly hold every permission that applies to their org type.
// Shippers never hold permissions from this catalog — they have a separate,
// narrower read-only surface (their own loads only).
function userHasPermission(user, permissionKey) {
  if (!user) return false;
  if (user.account_type === 'shipper') return false;
  if (user.is_admin) return true;
  const granted = permissionsForRole(user.role_id);
  return granted.includes(permissionKey);
}

function allPermissionKeys() {
  return PERMISSION_CATALOG.map((p) => p.key);
}

module.exports = { PERMISSION_CATALOG, seedPermissions, permissionsForRole, userHasPermission, allPermissionKeys };
