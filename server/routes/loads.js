'use strict';
const db = require('../db');
const { requireAuth, requireAccountType, requirePermission, logDenied } = require('../middleware');
const { sendJson, nowISO } = require('../utils');
const { HttpError } = require('../router');
const { evaluateCompliance } = require('../compliance');

const STATUS_FLOW = [
  'Posted',
  'Carrier Assigned',
  'Rate Confirmed',
  'Dispatched',
  'In Transit',
  'Delivered',
  'POD Verified',
  'Invoiced/Closed',
];

function canAccessLoad(user, load) {
  if (user.account_type === 'broker') return user.org_id === load.broker_org_id;
  if (user.account_type === 'carrier') return !!load.carrier_org_id && user.org_id === load.carrier_org_id;
  if (user.account_type === 'shipper') return user.id === load.shipper_id;
  return false;
}

function loadOr404(id) {
  const load = db.prepare(`SELECT * FROM loads WHERE id = ?`).get(id);
  if (!load) throw new HttpError(404, 'Load not found');
  return load;
}

function assertAccess(ctx, load) {
  if (!canAccessLoad(ctx.user, load)) {
    logDenied({ user: ctx.user, req: ctx.req, requiredPermission: null, reason: 'load out of org/object scope' });
    throw new HttpError(403, 'This load is outside your access scope');
  }
}

function recordAudit(loadId, { from, to, action, note, userId }) {
  db.prepare(
    `INSERT INTO load_audit (load_id, from_status, to_status, action, note, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(loadId, from || null, to, action, note || null, userId, nowISO());
}

function transition(load, expectedFrom, toStatus, action, ctx, note) {
  if (load.status !== expectedFrom) {
    throw new HttpError(409, `Load must be in status "${expectedFrom}" for this action (currently "${load.status}")`);
  }
  db.prepare(`UPDATE loads SET status = ?, updated_at = ? WHERE id = ?`).run(toStatus, nowISO(), load.id);
  recordAudit(load.id, { from: load.status, to: toStatus, action, note, userId: ctx.user.id });
}

function publicLoad(load, viewerAccountType) {
  const brokerOrg = db.prepare(`SELECT name FROM orgs WHERE id = ?`).get(load.broker_org_id);
  const carrierOrg = load.carrier_org_id ? db.prepare(`SELECT name FROM orgs WHERE id = ?`).get(load.carrier_org_id) : null;
  const shipper = db.prepare(`SELECT name FROM users WHERE id = ?`).get(load.shipper_id);

  const broker_org_name = brokerOrg ? brokerOrg.name : null;
  const carrier_org_name = carrierOrg ? carrierOrg.name : null;
  const shipper_name = shipper ? shipper.name : null;

  let other_party_name = null;
  if (viewerAccountType === 'broker') other_party_name = carrier_org_name;
  else if (viewerAccountType === 'carrier') other_party_name = broker_org_name;
  else if (viewerAccountType === 'shipper') other_party_name = broker_org_name;

  return {
    ...load,
    compliance_flag: !!load.compliance_flag,
    broker_org_name,
    carrier_org_name,
    shipper_name,
    other_party_name,
  };
}

function register(router) {
  // ---- Create ----
  router.post('/api/loads', requireAuth, requireAccountType('broker'), requirePermission('load.create'), async (ctx) => {
    const { shipper_email, origin, destination, pickup_date, delivery_date, equipment_type, commodity_type } = ctx.body || {};
    if (!shipper_email || !origin || !destination || !equipment_type || !commodity_type) {
      throw new HttpError(400, 'shipper_email, origin, destination, equipment_type, commodity_type are required');
    }
    const shipper = db.prepare(`SELECT * FROM users WHERE email = ? AND account_type = 'shipper'`).get(String(shipper_email).toLowerCase());
    if (!shipper) throw new HttpError(400, `No shipper account found for ${shipper_email}`);

    const now = nowISO();
    const result = db
      .prepare(
        `INSERT INTO loads (reference, broker_org_id, shipper_id, status, origin, destination, pickup_date, delivery_date, equipment_type, commodity_type, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'Posted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('', ctx.user.org_id, shipper.id, origin, destination, pickup_date || null, delivery_date || null, equipment_type, commodity_type, ctx.user.id, now, now);
    const id = Number(result.lastInsertRowid);
    const reference = `LF-${1000 + id}`;
    db.prepare(`UPDATE loads SET reference = ? WHERE id = ?`).run(reference, id);
    recordAudit(id, { from: null, to: 'Posted', action: 'create', note: null, userId: ctx.user.id });

    sendJson(ctx.res, 201, { load: publicLoad(loadOr404(id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- List (scoped + filterable) ----
  router.get('/api/loads', requireAuth, async (ctx) => {
    const { status, q } = ctx.query;
    let rows;
    if (ctx.user.account_type === 'broker') {
      rows = db.prepare(`SELECT * FROM loads WHERE broker_org_id = ? ORDER BY created_at DESC`).all(ctx.user.org_id);
    } else if (ctx.user.account_type === 'carrier') {
      rows = db.prepare(`SELECT * FROM loads WHERE carrier_org_id = ? ORDER BY created_at DESC`).all(ctx.user.org_id);
    } else {
      rows = db.prepare(`SELECT * FROM loads WHERE shipper_id = ? ORDER BY created_at DESC`).all(ctx.user.id);
    }
    if (status) rows = rows.filter((r) => r.status === status);
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter(
        (r) =>
          r.reference.toLowerCase().includes(needle) ||
          r.origin.toLowerCase().includes(needle) ||
          r.destination.toLowerCase().includes(needle) ||
          r.equipment_type.toLowerCase().includes(needle) ||
          r.commodity_type.toLowerCase().includes(needle)
      );
    }
    sendJson(ctx.res, 200, { loads: rows.map((r) => publicLoad(r, ctx.user.account_type)) });
    return 'STOP';
  });

  // ---- Detail ----
  router.get('/api/loads/:id', requireAuth, async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    sendJson(ctx.res, 200, { load: publicLoad(load, ctx.user.account_type) });
    return 'STOP';
  });

  router.get('/api/loads/:id/audit', requireAuth, async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    const rows = db
      .prepare(
        `SELECT a.*, u.name AS changed_by_name, u.account_type AS changed_by_account_type
         FROM load_audit a JOIN users u ON u.id = a.changed_by WHERE a.load_id = ? ORDER BY a.changed_at ASC`
      )
      .all(load.id);
    sendJson(ctx.res, 200, { audit: rows });
    return 'STOP';
  });

  router.get('/api/loads/:id/rates', requireAuth, async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    const rows = db.prepare(`SELECT * FROM rate_confirmations WHERE load_id = ? ORDER BY version ASC`).all(load.id);
    sendJson(ctx.res, 200, { rates: rows.map((r) => ({ ...r, accessorials: JSON.parse(r.accessorials || '[]'), is_current: !!r.is_current })) });
    return 'STOP';
  });

  // ---- Assign carrier (Posted -> Carrier Assigned), auto compliance check ----
  router.post('/api/loads/:id/assign-carrier', requireAuth, requireAccountType('broker'), requirePermission('load.assign_carrier'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    const { carrier_org_id } = ctx.body || {};
    if (!carrier_org_id) throw new HttpError(400, 'carrier_org_id is required');
    const carrierOrg = db.prepare(`SELECT * FROM orgs WHERE id = ? AND type = 'carrier'`).get(carrier_org_id);
    if (!carrierOrg) throw new HttpError(400, 'Unknown carrier org');
    if (load.status !== 'Posted') throw new HttpError(409, `Load must be "Posted" to assign a carrier (currently "${load.status}")`);

    const compliance = db.prepare(`SELECT * FROM carrier_compliance WHERE carrier_org_id = ?`).get(carrier_org_id);
    const evalResult = evaluateCompliance(compliance, load);

    db.prepare(
      `UPDATE loads SET carrier_org_id = ?, status = 'Carrier Assigned', compliance_flag = ?, compliance_flag_reason = ?, compliance_override_note = NULL, compliance_overridden_by = NULL, updated_at = ? WHERE id = ?`
    ).run(carrier_org_id, evalResult.flagged ? 1 : 0, evalResult.reason, nowISO(), load.id);
    recordAudit(load.id, {
      from: 'Posted',
      to: 'Carrier Assigned',
      action: 'assign_carrier',
      note: evalResult.flagged ? `Auto-flagged: ${evalResult.reason}` : `Assigned to ${carrierOrg.name}`,
      userId: ctx.user.id,
    });

    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- Carrier declines an assignment (Carrier Assigned -> Posted) ----
  router.post('/api/loads/:id/decline', requireAuth, requireAccountType('carrier'), requirePermission('load.update_status'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    if (load.status !== 'Carrier Assigned') throw new HttpError(409, `Only a load in "Carrier Assigned" can be declined (currently "${load.status}")`);

    db.prepare(
      `UPDATE loads SET carrier_org_id = NULL, status = 'Posted', compliance_flag = 0, compliance_flag_reason = NULL, updated_at = ? WHERE id = ?`
    ).run(nowISO(), load.id);
    recordAudit(load.id, { from: 'Carrier Assigned', to: 'Posted', action: 'decline', note: ctx.body?.note, userId: ctx.user.id });

    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- Override a compliance flag (stays in Carrier Assigned, clears the block) ----
  router.post('/api/loads/:id/override-compliance', requireAuth, requireAccountType('broker'), requirePermission('load.override_compliance_flag'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    if (!load.compliance_flag) throw new HttpError(409, 'Load is not currently compliance-flagged');
    const { note } = ctx.body || {};
    if (!note || !note.trim()) throw new HttpError(400, 'A justification note is required to override a compliance flag');

    db.prepare(
      `UPDATE loads SET compliance_flag = 0, compliance_override_note = ?, compliance_overridden_by = ?, updated_at = ? WHERE id = ?`
    ).run(note, ctx.user.id, nowISO(), load.id);
    recordAudit(load.id, { from: load.status, to: load.status, action: 'override_compliance', note, userId: ctx.user.id });

    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- Confirm rate (Carrier Assigned -> Rate Confirmed), versioned ----
  router.post('/api/loads/:id/confirm-rate', requireAuth, requireAccountType('broker'), requirePermission('rate.confirm'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    if (load.status !== 'Carrier Assigned') throw new HttpError(409, `Load must be "Carrier Assigned" to confirm a rate (currently "${load.status}")`);
    if (load.compliance_flag) throw new HttpError(409, 'Load is compliance-flagged; resolve or override before confirming a rate');

    const { base_rate, accessorials } = ctx.body || {};
    if (typeof base_rate !== 'number' || base_rate <= 0) throw new HttpError(400, 'base_rate must be a positive number');

    const prev = db.prepare(`SELECT MAX(version) AS v FROM rate_confirmations WHERE load_id = ?`).get(load.id);
    const nextVersion = (prev?.v || 0) + 1;
    db.prepare(`UPDATE rate_confirmations SET is_current = 0 WHERE load_id = ?`).run(load.id);
    db.prepare(
      `INSERT INTO rate_confirmations (load_id, version, base_rate, accessorials, is_current, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(load.id, nextVersion, base_rate, JSON.stringify(accessorials || []), ctx.user.id, nowISO());

    transition(load, 'Carrier Assigned', 'Rate Confirmed', 'confirm_rate', ctx, `Rate v${nextVersion}: $${base_rate}`);
    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- Dispatch (Rate Confirmed -> Dispatched), broker side ----
  router.post('/api/loads/:id/dispatch', requireAuth, requireAccountType('broker'), requirePermission('load.update_status'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    transition(load, 'Rate Confirmed', 'Dispatched', 'dispatch', ctx, ctx.body?.note);
    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- Carrier-side status progress: Dispatched -> In Transit -> Delivered ----
  router.post('/api/loads/:id/in-transit', requireAuth, requireAccountType('carrier'), requirePermission('load.update_status'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    transition(load, 'Dispatched', 'In Transit', 'in_transit', ctx, ctx.body?.note);
    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  router.post('/api/loads/:id/delivered', requireAuth, requireAccountType('carrier'), requirePermission('load.update_status'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    transition(load, 'In Transit', 'Delivered', 'delivered', ctx, ctx.body?.note);
    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- POD upload (Delivered -> POD Verified), carrier side ----
  router.post('/api/loads/:id/pod', requireAuth, requireAccountType('carrier'), requirePermission('pod.upload'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    if (load.status !== 'Delivered') throw new HttpError(409, `Load must be "Delivered" to upload POD (currently "${load.status}")`);
    const { file_name } = ctx.body || {};
    if (!file_name) throw new HttpError(400, 'file_name is required');

    db.prepare(`UPDATE loads SET pod_file_name = ?, pod_uploaded_by = ?, pod_uploaded_at = ? WHERE id = ?`).run(file_name, ctx.user.id, nowISO(), load.id);
    transition(load, 'Delivered', 'POD Verified', 'pod_upload', ctx, `POD: ${file_name}`);
    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  // ---- Close / invoice (POD Verified -> Invoiced/Closed), broker side ----
  router.post('/api/loads/:id/close', requireAuth, requireAccountType('broker'), requirePermission('load.update_status'), async (ctx) => {
    const load = loadOr404(ctx.params.id);
    assertAccess(ctx, load);
    transition(load, 'POD Verified', 'Invoiced/Closed', 'close', ctx, ctx.body?.note);
    sendJson(ctx.res, 200, { load: publicLoad(loadOr404(load.id), ctx.user.account_type) });
    return 'STOP';
  });

  router.get('/api/status-flow', requireAuth, async (ctx) => {
    sendJson(ctx.res, 200, { flow: STATUS_FLOW });
    return 'STOP';
  });
}

module.exports = { register, STATUS_FLOW };
