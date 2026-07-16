'use strict';
const db = require('../db');
const { requireAuth, requireAccountType } = require('../middleware');
const { sendJson } = require('../utils');

function register(router) {
  // Org-wide audit trail across every load the org has touched (stretch goal #10).
  router.get('/api/org/audit-log', requireAuth, requireAccountType('broker', 'carrier'), async (ctx) => {
    const col = ctx.user.account_type === 'broker' ? 'broker_org_id' : 'carrier_org_id';
    const rows = db
      .prepare(
        `SELECT a.*, l.reference, u.name AS changed_by_name
         FROM load_audit a
         JOIN loads l ON l.id = a.load_id
         JOIN users u ON u.id = a.changed_by
         WHERE l.${col} = ?
         ORDER BY a.changed_at DESC
         LIMIT 200`
      )
      .all(ctx.user.org_id);
    sendJson(ctx.res, 200, { audit: rows });
    return 'STOP';
  });
}

module.exports = { register };
