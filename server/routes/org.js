'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const { requireAuth, requireAccountType, requirePermission, logDenied } = require('../middleware');
const { userHasPermission, PERMISSION_CATALOG, permissionsForRole } = require('../permissions');
const { hashPassword } = require('../auth');
const { sendJson, nowISO } = require('../utils');
const { HttpError } = require('../router');
const { evaluateCompliance, classifyExpiry } = require('../compliance');

function requireOrgAdmin(ctx) {
  // "staff.manage" is the catalog permission for this; admins always have it implicitly.
  if (!ctx.user.is_admin && !userHasPermission(ctx.user, 'staff.manage')) {
    logDenied({ user: ctx.user, req: ctx.req, requiredPermission: 'staff.manage', reason: 'missing permission' });
    throw new HttpError(403, 'Missing permission: staff.manage');
  }
}

function publicRole(role) {
  return { id: role.id, org_id: role.org_id, name: role.name, permissions: permissionsForRole(role.id) };
}

function publicStaff(u) {
  return { id: u.id, name: u.name, email: u.email, is_admin: !!u.is_admin, role_id: u.role_id, active: !!u.active };
}

function register(router) {
  // ---- Permission catalog (for building the role UI) ----
  router.get('/api/permissions', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    const applicable = PERMISSION_CATALOG.filter((p) => p.applies_to === 'both' || p.applies_to === ctx.user.account_type);
    sendJson(ctx.res, 200, { permissions: applicable });
    return 'STOP';
  });

  // ---- Roles ----
  router.get('/api/org/roles', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    const roles = db.prepare(`SELECT * FROM roles WHERE org_id = ? ORDER BY name`).all(ctx.user.org_id);
    sendJson(ctx.res, 200, { roles: roles.map(publicRole) });
    return 'STOP';
  });

  router.post('/api/org/roles', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    requireOrgAdmin(ctx);
    const { name, permission_keys } = ctx.body || {};
    if (!name || !Array.isArray(permission_keys)) throw new HttpError(400, 'name and permission_keys[] are required');

    const validKeys = new Set(
      PERMISSION_CATALOG.filter((p) => p.applies_to === 'both' || p.applies_to === ctx.user.account_type).map((p) => p.key)
    );
    for (const k of permission_keys) {
      if (!validKeys.has(k)) throw new HttpError(400, `Permission "${k}" is not valid for a ${ctx.user.account_type} org`);
    }

    let roleId;
    try {
      const result = db
        .prepare(`INSERT INTO roles (org_id, name, created_at) VALUES (?, ?, ?)`)
        .run(ctx.user.org_id, name, nowISO());
      roleId = Number(result.lastInsertRowid);
    } catch (e) {
      throw new HttpError(409, `Role "${name}" already exists`);
    }
    const permRows = db.prepare(`SELECT id, key FROM permissions WHERE key IN (${permission_keys.map(() => '?').join(',') || "''"})`).all(...permission_keys);
    const insertRP = db.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`);
    for (const p of permRows) insertRP.run(roleId, p.id);

    const role = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(roleId);
    sendJson(ctx.res, 201, { role: publicRole(role) });
    return 'STOP';
  });

  router.put('/api/org/roles/:id', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    requireOrgAdmin(ctx);
    const role = db.prepare(`SELECT * FROM roles WHERE id = ? AND org_id = ?`).get(ctx.params.id, ctx.user.org_id);
    if (!role) throw new HttpError(404, 'Role not found');

    const { name, permission_keys } = ctx.body || {};
    if (name) db.prepare(`UPDATE roles SET name = ? WHERE id = ?`).run(name, role.id);

    if (Array.isArray(permission_keys)) {
      const validKeys = new Set(
        PERMISSION_CATALOG.filter((p) => p.applies_to === 'both' || p.applies_to === ctx.user.account_type).map((p) => p.key)
      );
      for (const k of permission_keys) {
        if (!validKeys.has(k)) throw new HttpError(400, `Permission "${k}" is not valid for a ${ctx.user.account_type} org`);
      }
      db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(role.id);
      const permRows = db.prepare(`SELECT id, key FROM permissions WHERE key IN (${permission_keys.map(() => '?').join(',') || "''"})`).all(...permission_keys);
      const insertRP = db.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`);
      for (const p of permRows) insertRP.run(role.id, p.id);
    }

    const updated = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(role.id);
    sendJson(ctx.res, 200, { role: publicRole(updated) });
    return 'STOP';
  });

  router.delete('/api/org/roles/:id', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    requireOrgAdmin(ctx);
    const role = db.prepare(`SELECT * FROM roles WHERE id = ? AND org_id = ?`).get(ctx.params.id, ctx.user.org_id);
    if (!role) throw new HttpError(404, 'Role not found');
    const inUse = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role_id = ?`).get(role.id);
    if (inUse.n > 0) throw new HttpError(409, 'Role is assigned to staff; reassign them first');
    db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(role.id);
    db.prepare(`DELETE FROM roles WHERE id = ?`).run(role.id);
    sendJson(ctx.res, 200, { ok: true });
    return 'STOP';
  });

  // ---- Staff ----
  router.get('/api/org/staff', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    requireOrgAdmin(ctx);
    const staff = db.prepare(`SELECT * FROM users WHERE org_id = ? ORDER BY is_admin DESC, name`).all(ctx.user.org_id);
    sendJson(ctx.res, 200, { staff: staff.map(publicStaff) });
    return 'STOP';
  });

  router.post('/api/org/staff', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    requireOrgAdmin(ctx);
    const { name, email, role_id } = ctx.body || {};
    if (!name || !email) throw new HttpError(400, 'name and email are required');
    if (role_id) {
      const role = db.prepare(`SELECT * FROM roles WHERE id = ? AND org_id = ?`).get(role_id, ctx.user.org_id);
      if (!role) throw new HttpError(400, 'role_id does not belong to your org');
    }
    // Bootstrap-of-staff: there is no email delivery in this hackathon build, so
    // "inviting" a teammate means the Admin creates the account directly and
    // hands them a temp password out of band. A real deployment would swap this
    // for an emailed invite link + forced password reset.
    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const hash = hashPassword(tempPassword);
    let userId;
    try {
      const result = db
        .prepare(
          `INSERT INTO users (account_type, org_id, role_id, is_admin, name, email, password_hash, created_at)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .run(ctx.user.account_type, ctx.user.org_id, role_id || null, name, String(email).toLowerCase(), hash, nowISO());
      userId = Number(result.lastInsertRowid);
    } catch (e) {
      throw new HttpError(409, 'A user with that email already exists');
    }
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    sendJson(ctx.res, 201, { staff: publicStaff(user), temp_password: tempPassword });
    return 'STOP';
  });

  router.put('/api/org/staff/:id', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    requireOrgAdmin(ctx);
    const target = db.prepare(`SELECT * FROM users WHERE id = ? AND org_id = ?`).get(ctx.params.id, ctx.user.org_id);
    if (!target) throw new HttpError(404, 'Staff member not found');
    if (target.is_admin) throw new HttpError(400, 'Cannot modify the org Admin account');

    const { role_id, active } = ctx.body || {};
    if (role_id !== undefined) {
      if (role_id !== null) {
        const role = db.prepare(`SELECT * FROM roles WHERE id = ? AND org_id = ?`).get(role_id, ctx.user.org_id);
        if (!role) throw new HttpError(400, 'role_id does not belong to your org');
      }
      db.prepare(`UPDATE users SET role_id = ? WHERE id = ?`).run(role_id, target.id);
    }
    if (active !== undefined) {
      db.prepare(`UPDATE users SET active = ? WHERE id = ?`).run(active ? 1 : 0, target.id);
    }
    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(target.id);
    sendJson(ctx.res, 200, { staff: publicStaff(updated) });
    return 'STOP';
  });

  // ---- Carrier compliance ----
  function publicCompliance(row) {
    if (!row) return null;
    return {
      carrier_org_id: row.carrier_org_id,
      mc_dot_number: row.mc_dot_number,
      authority_status: row.authority_status,
      insurance_expiry: row.insurance_expiry,
      approved_equipment: JSON.parse(row.approved_equipment || '[]'),
      approved_commodities: JSON.parse(row.approved_commodities || '[]'),
      updated_at: row.updated_at,
    };
  }

  // Broker staff browse this to pick a carrier; carrier staff use it to see/edit their own.
  router.get('/api/compliance', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    let rows;
    if (ctx.user.account_type === 'broker') {
      rows = db
        .prepare(
          `SELECT o.id AS org_id, o.name AS org_name, c.* FROM orgs o LEFT JOIN carrier_compliance c ON c.carrier_org_id = o.id WHERE o.type = 'carrier'`
        )
        .all();
    } else {
      rows = db
        .prepare(`SELECT o.id AS org_id, o.name AS org_name, c.* FROM orgs o LEFT JOIN carrier_compliance c ON c.carrier_org_id = o.id WHERE o.id = ?`)
        .all(ctx.user.org_id);
    }
    sendJson(ctx.res, 200, {
      carriers: rows.map((r) => {
        const compliance = r.updated_at ? publicCompliance(r) : null;
        return { org_id: r.org_id, org_name: r.org_name, compliance, alert: classifyExpiry(r.updated_at ? r : null) };
      }),
    });
    return 'STOP';
  });

  // Stretch goal: compliance expiry renewal alerts. Broker-only summary of
  // carriers that need attention — expired, expiring within the warning
  // window, or missing a record entirely — sorted worst-first so the most
  // urgent thing is always at the top.
  router.get('/api/org/compliance-alerts', requireAuth, requireAccountType('broker'), async (ctx) => {
    const rows = db
      .prepare(
        `SELECT o.id AS org_id, o.name AS org_name, c.* FROM orgs o LEFT JOIN carrier_compliance c ON c.carrier_org_id = o.id WHERE o.type = 'carrier'`
      )
      .all();
    const severity = { critical: 0, missing: 1, warning: 2, ok: 3 };
    const alerts = rows
      .map((r) => ({ org_id: r.org_id, org_name: r.org_name, ...classifyExpiry(r.updated_at ? r : null) }))
      .filter((a) => a.level !== 'ok')
      .sort((a, b) => severity[a.level] - severity[b.level]);
    sendJson(ctx.res, 200, { alerts });
    return 'STOP';
  });

  router.put('/api/compliance/:carrierOrgId', requireAuth, requireAccountType('carrier'), async (ctx) => {
    requireOrgAdmin(ctx);
    const carrierOrgId = Number(ctx.params.carrierOrgId);
    if (carrierOrgId !== ctx.user.org_id) throw new HttpError(403, 'Can only edit your own carrier org compliance record');

    const { mc_dot_number, authority_status, insurance_expiry, approved_equipment, approved_commodities } = ctx.body || {};
    const existing = db.prepare(`SELECT * FROM carrier_compliance WHERE carrier_org_id = ?`).get(carrierOrgId);
    const payload = {
      mc_dot_number: mc_dot_number ?? existing?.mc_dot_number ?? null,
      authority_status: authority_status ?? existing?.authority_status ?? 'active',
      insurance_expiry: insurance_expiry ?? existing?.insurance_expiry ?? null,
      approved_equipment: JSON.stringify(approved_equipment ?? JSON.parse(existing?.approved_equipment || '[]')),
      approved_commodities: JSON.stringify(approved_commodities ?? JSON.parse(existing?.approved_commodities || '[]')),
    };

    if (existing) {
      db.prepare(
        `UPDATE carrier_compliance SET mc_dot_number=?, authority_status=?, insurance_expiry=?, approved_equipment=?, approved_commodities=?, updated_at=?, updated_by=? WHERE carrier_org_id=?`
      ).run(payload.mc_dot_number, payload.authority_status, payload.insurance_expiry, payload.approved_equipment, payload.approved_commodities, nowISO(), ctx.user.id, carrierOrgId);
    } else {
      db.prepare(
        `INSERT INTO carrier_compliance (carrier_org_id, mc_dot_number, authority_status, insurance_expiry, approved_equipment, approved_commodities, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(carrierOrgId, payload.mc_dot_number, payload.authority_status, payload.insurance_expiry, payload.approved_equipment, payload.approved_commodities, nowISO(), ctx.user.id);
    }

    // Re-evaluate compliance on any currently-assigned, not-yet-departed loads for this carrier.
    const record = db.prepare(`SELECT * FROM carrier_compliance WHERE carrier_org_id = ?`).get(carrierOrgId);
    const affected = db
      .prepare(`SELECT * FROM loads WHERE carrier_org_id = ? AND status IN ('Carrier Assigned','Rate Confirmed')`)
      .all(carrierOrgId);
    for (const load of affected) {
      const evalResult = evaluateCompliance(record, load);
      db.prepare(`UPDATE loads SET compliance_flag=?, compliance_flag_reason=?, updated_at=? WHERE id=?`).run(
        evalResult.flagged ? 1 : 0,
        evalResult.reason,
        nowISO(),
        load.id
      );
    }

    sendJson(ctx.res, 200, { compliance: publicCompliance(record) });
    return 'STOP';
  });
}

module.exports = { register };
