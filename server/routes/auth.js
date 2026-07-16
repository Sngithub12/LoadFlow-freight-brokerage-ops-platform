'use strict';
const db = require('../db');
const { verifyPassword, createSession, destroySession } = require('../auth');
const { requireAuth, logDenied } = require('../middleware');
const { permissionsForRole, allPermissionKeys } = require('../permissions');
const { sendJson } = require('../utils');
const { HttpError } = require('../router');

function publicUser(user) {
  const org = user.org_id ? db.prepare(`SELECT name FROM orgs WHERE id = ?`).get(user.org_id) : null;
  return {
    id: user.id,
    account_type: user.account_type,
    org_id: user.org_id,
    org_name: org ? org.name : null,
    role_id: user.role_id,
    is_admin: !!user.is_admin,
    name: user.name,
    email: user.email,
    permissions: user.is_admin ? allPermissionKeys() : permissionsForRole(user.role_id),
  };
}

function register(router) {
  router.post('/api/auth/login', async (ctx) => {
    const { email, password } = ctx.body || {};
    if (!email || !password) throw new HttpError(400, 'email and password are required');

    const user = db.prepare(`SELECT * FROM users WHERE email = ? AND active = 1`).get(String(email).toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      logDenied({ user: null, req: ctx.req, requiredPermission: null, reason: `failed login for ${email}` });
      throw new HttpError(401, 'Invalid email or password');
    }
    const token = createSession(user.id);
    sendJson(ctx.res, 200, { token, user: publicUser(user) });
    return 'STOP';
  });

  router.get('/api/auth/me', requireAuth, async (ctx) => {
    sendJson(ctx.res, 200, { user: publicUser(ctx.user) });
    return 'STOP';
  });

  router.post('/api/auth/logout', requireAuth, async (ctx) => {
    const auth = ctx.req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) destroySession(token);
    sendJson(ctx.res, 200, { ok: true });
    return 'STOP';
  });
}

module.exports = { register, publicUser };
