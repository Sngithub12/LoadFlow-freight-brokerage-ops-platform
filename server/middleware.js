'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { getUserFromToken } = require('./auth');
const { userHasPermission } = require('./permissions');
const { HttpError } = require('./router');
const { nowISO } = require('./utils');

const LOG_PATH = path.join(__dirname, '..', 'data', 'permission_denied.log');

function logDenied({ user, req, requiredPermission, reason }) {
  const entry = {
    user_id: user ? user.id : null,
    email: user ? user.email : null,
    method: req.method,
    path: req.url,
    required_permission: requiredPermission || null,
    reason,
    created_at: nowISO(),
  };
  db.prepare(
    `INSERT INTO permission_denied_log (user_id, email, method, path, required_permission, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(entry.user_id, entry.email, entry.method, entry.path, entry.required_permission, entry.reason, entry.created_at);
  const line = `[${entry.created_at}] DENY ${entry.method} ${entry.path} user=${entry.email || 'anon'} required=${entry.required_permission || '-'} reason="${entry.reason}"\n`;
  console.warn(line.trim());
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (e) {
    // logging must never crash a request
    console.error('Failed to write permission_denied.log', e);
  }
}

// Populates ctx.user from the bearer token. Throws 401 if absent/invalid.
async function requireAuth(ctx) {
  const auth = ctx.req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = getUserFromToken(token);
  if (!user) {
    throw new HttpError(401, 'Not authenticated');
  }
  ctx.user = user;
}

// Factory: require a specific permission key from the fixed catalog.
// Admins of the relevant org type always pass. Shippers never pass (they hold
// no permissions from this catalog by design).
function requirePermission(permissionKey) {
  return async function (ctx) {
    if (!ctx.user) throw new HttpError(401, 'Not authenticated');
    if (!userHasPermission(ctx.user, permissionKey)) {
      logDenied({ user: ctx.user, req: ctx.req, requiredPermission: permissionKey, reason: 'missing permission' });
      throw new HttpError(403, `Missing permission: ${permissionKey}`);
    }
  };
}

// Restrict to one or more account types (broker | carrier | shipper).
function requireAccountType(...types) {
  return async function (ctx) {
    if (!ctx.user) throw new HttpError(401, 'Not authenticated');
    if (!types.includes(ctx.user.account_type)) {
      logDenied({ user: ctx.user, req: ctx.req, requiredPermission: null, reason: `account_type must be one of ${types.join(',')}` });
      throw new HttpError(403, 'Not permitted for this account type');
    }
  };
}

module.exports = { requireAuth, requirePermission, requireAccountType, logDenied };
