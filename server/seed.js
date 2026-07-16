'use strict';
// One-time (idempotent-ish) bootstrap. Run with `npm run seed`.
//
// Bootstrap model: the FIRST Admin of a Broker or Carrier org cannot be
// self-registered through the app (there is no public sign-up form — a freight
// brokerage's org roster is not something strangers should be able to create).
// Instead, that first Admin account is provisioned out-of-band, here, the same
// way a real deployment would have an ops/sales team create the org record
// during customer onboarding. Every account after that (staff) is created
// in-app by that Admin via POST /api/org/staff, which is the actual "invite"
// flow (see server/routes/org.js).
const db = require('./db');
const { hashPassword } = require('./auth');
const { seedPermissions } = require('./permissions');
const { nowISO } = require('./utils');

seedPermissions();

function upsertOrg(type, name) {
  const existing = db.prepare(`SELECT * FROM orgs WHERE type = ? AND name = ?`).get(type, name);
  if (existing) return existing;
  const r = db.prepare(`INSERT INTO orgs (type, name, created_at) VALUES (?, ?, ?)`).run(type, name, nowISO());
  return db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(r.lastInsertRowid);
}

function upsertUser({ account_type, org_id, role_id, is_admin, name, email, password }) {
  const existing = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (existing) return existing;
  const hash = hashPassword(password);
  const r = db
    .prepare(
      `INSERT INTO users (account_type, org_id, role_id, is_admin, name, email, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(account_type, org_id || null, role_id || null, is_admin ? 1 : 0, name, email, hash, nowISO());
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(r.lastInsertRowid);
}

function upsertRole(org_id, name, permissionKeys) {
  let role = db.prepare(`SELECT * FROM roles WHERE org_id = ? AND name = ?`).get(org_id, name);
  if (!role) {
    const r = db.prepare(`INSERT INTO roles (org_id, name, created_at) VALUES (?, ?, ?)`).run(org_id, name, nowISO());
    role = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(r.lastInsertRowid);
  }
  db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(role.id);
  const perms = db.prepare(`SELECT id, key FROM permissions WHERE key IN (${permissionKeys.map(() => '?').join(',')})`).all(...permissionKeys);
  const ins = db.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`);
  for (const p of perms) ins.run(role.id, p.id);
  return role;
}

function setCompliance(carrier_org_id, fields) {
  const existing = db.prepare(`SELECT * FROM carrier_compliance WHERE carrier_org_id = ?`).get(carrier_org_id);
  if (existing) {
    db.prepare(
      `UPDATE carrier_compliance SET mc_dot_number=?, authority_status=?, insurance_expiry=?, approved_equipment=?, approved_commodities=?, updated_at=? WHERE carrier_org_id=?`
    ).run(fields.mc_dot_number, fields.authority_status, fields.insurance_expiry, JSON.stringify(fields.approved_equipment), JSON.stringify(fields.approved_commodities), nowISO(), carrier_org_id);
  } else {
    db.prepare(
      `INSERT INTO carrier_compliance (carrier_org_id, mc_dot_number, authority_status, insurance_expiry, approved_equipment, approved_commodities, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(carrier_org_id, fields.mc_dot_number, fields.authority_status, fields.insurance_expiry, JSON.stringify(fields.approved_equipment), JSON.stringify(fields.approved_commodities), nowISO());
  }
}

function makeLoad({ reference, broker_org_id, shipper_id, origin, destination, equipment_type, commodity_type, created_by }) {
  const existing = db.prepare(`SELECT * FROM loads WHERE reference = ?`).get(reference);
  if (existing) return existing;
  const now = nowISO();
  const r = db
    .prepare(
      `INSERT INTO loads (reference, broker_org_id, shipper_id, status, origin, destination, pickup_date, delivery_date, equipment_type, commodity_type, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'Posted', ?, ?, date('now','+2 day'), date('now','+5 day'), ?, ?, ?, ?, ?)`
    )
    .run(reference, broker_org_id, shipper_id, origin, destination, equipment_type, commodity_type, created_by, now, now);
  const load = db.prepare(`SELECT * FROM loads WHERE id = ?`).get(r.lastInsertRowid);
  db.prepare(`INSERT INTO load_audit (load_id, from_status, to_status, action, note, changed_by, changed_at) VALUES (?, NULL, 'Posted', 'create', 'Seed data', ?, ?)`).run(
    load.id,
    created_by,
    now
  );
  return load;
}

// ---- Orgs ----
const broker = upsertOrg('broker', 'Meridian Freight Brokerage');
const carrierGood = upsertOrg('carrier', 'Swift Trucking Co');
const carrierFlagged = upsertOrg('carrier', 'Blue Line Logistics');
const carrierExpiringSoon = upsertOrg('carrier', 'Apex Freight Lines');

// ---- Broker roles + staff ----
const dispatcherRole = upsertRole(broker.id, 'Dispatcher', ['load.assign_carrier', 'rate.confirm']);
const opsLeadRole = upsertRole(broker.id, 'Ops Lead', ['load.create', 'load.assign_carrier', 'rate.confirm', 'load.override_compliance_flag', 'load.update_status']);

const brokerAdmin = upsertUser({ account_type: 'broker', org_id: broker.id, is_admin: true, name: 'Priya Shah', email: 'admin@meridianfreight.com', password: 'admin123' });
const dispatcherUser = upsertUser({ account_type: 'broker', org_id: broker.id, role_id: dispatcherRole.id, name: 'Jordan Lee', email: 'dispatcher@meridianfreight.com', password: 'dispatch123' });
const opsLeadUser = upsertUser({ account_type: 'broker', org_id: broker.id, role_id: opsLeadRole.id, name: 'Casey Rivera', email: 'opslead@meridianfreight.com', password: 'opslead123' });

// ---- Carrier roles + staff (good carrier) ----
const driverRole = upsertRole(carrierGood.id, 'Driver', ['load.update_status', 'pod.upload']);
const carrierDispatchRole = upsertRole(carrierGood.id, 'Carrier Dispatch', ['load.update_status']);

const carrierGoodAdmin = upsertUser({ account_type: 'carrier', org_id: carrierGood.id, is_admin: true, name: 'Marcus Webb', email: 'admin@swifttrucking.com', password: 'admin123' });
const driverUser = upsertUser({ account_type: 'carrier', org_id: carrierGood.id, role_id: driverRole.id, name: 'Sam Okafor', email: 'driver@swifttrucking.com', password: 'driver123' });

// ---- Carrier (flagged/expired) ----
const carrierFlaggedAdmin = upsertUser({ account_type: 'carrier', org_id: carrierFlagged.id, is_admin: true, name: 'Dana Kowalski', email: 'admin@bluelinelogistics.com', password: 'admin123' });

// ---- Carrier (insurance expiring soon, but not expired yet — warning tier) ----
const carrierExpiringSoonAdmin = upsertUser({ account_type: 'carrier', org_id: carrierExpiringSoon.id, is_admin: true, name: 'Ravi Menon', email: 'admin@apexfreightlines.com', password: 'admin123' });

// ---- Shippers ----
const shipper1 = upsertUser({ account_type: 'shipper', name: 'Global Retail Co', email: 'shipper@globalretail.com', password: 'shipper123' });
const shipper2 = upsertUser({ account_type: 'shipper', name: 'TechSupply Inc', email: 'shipper@techsupply.com', password: 'shipper123' });

// ---- Compliance records ----
setCompliance(carrierGood.id, {
  mc_dot_number: 'MC-556213 / DOT-2214877',
  authority_status: 'active',
  insurance_expiry: '2027-01-31',
  approved_equipment: ['Dry Van', 'Reefer'],
  approved_commodities: ['General', 'Refrigerated'],
});
setCompliance(carrierFlagged.id, {
  mc_dot_number: 'MC-119042 / DOT-1187733',
  authority_status: 'active',
  insurance_expiry: '2025-03-15', // expired -> will trigger auto-flag on assignment
  approved_equipment: ['Flatbed'],
  approved_commodities: ['General'],
});
setCompliance(carrierExpiringSoon.id, {
  mc_dot_number: 'MC-887701 / DOT-3390215',
  authority_status: 'active',
  // computed relative to "today" (14 days out) so the renewal-alert warning
  // tier always has a real example to show, regardless of when this is run
  insurance_expiry: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  approved_equipment: ['Dry Van'],
  approved_commodities: ['General'],
});

// ---- Demo loads across the pipeline ----
const loadPosted = makeLoad({
  reference: 'LF-1001',
  broker_org_id: broker.id,
  shipper_id: shipper1.id,
  origin: 'Chicago, IL',
  destination: 'Dallas, TX',
  equipment_type: 'Dry Van',
  commodity_type: 'General',
  created_by: dispatcherUser.id,
});

const loadInFlight = makeLoad({
  reference: 'LF-1002',
  broker_org_id: broker.id,
  shipper_id: shipper2.id,
  origin: 'Atlanta, GA',
  destination: 'Charlotte, NC',
  equipment_type: 'Dry Van',
  commodity_type: 'General',
  created_by: opsLeadUser.id,
});
if (loadInFlight.status === 'Posted') {
  const now = nowISO();
  db.prepare(`UPDATE loads SET carrier_org_id=?, status='Rate Confirmed', compliance_flag=0, updated_at=? WHERE id=?`).run(carrierGood.id, now, loadInFlight.id);
  db.prepare(`INSERT INTO load_audit (load_id, from_status, to_status, action, note, changed_by, changed_at) VALUES (?, 'Posted','Carrier Assigned','assign_carrier','Assigned to Swift Trucking Co',?,?)`).run(loadInFlight.id, dispatcherUser.id, now);
  db.prepare(`INSERT INTO rate_confirmations (load_id, version, base_rate, accessorials, is_current, confirmed_by, confirmed_at) VALUES (?, 1, 2150.00, '[{"label":"Fuel surcharge","amount":180}]', 1, ?, ?)`).run(loadInFlight.id, dispatcherUser.id, now);
  db.prepare(`INSERT INTO load_audit (load_id, from_status, to_status, action, note, changed_by, changed_at) VALUES (?, 'Carrier Assigned','Rate Confirmed','confirm_rate','Rate v1: $2150',?,?)`).run(loadInFlight.id, dispatcherUser.id, now);
}

const loadFlagged = makeLoad({
  reference: 'LF-1003',
  broker_org_id: broker.id,
  shipper_id: shipper1.id,
  origin: 'Denver, CO',
  destination: 'Salt Lake City, UT',
  equipment_type: 'Flatbed',
  commodity_type: 'General',
  created_by: dispatcherUser.id,
});
if (loadFlagged.status === 'Posted') {
  const now = nowISO();
  db.prepare(`UPDATE loads SET carrier_org_id=?, status='Carrier Assigned', compliance_flag=1, compliance_flag_reason=?, updated_at=? WHERE id=?`).run(
    carrierFlagged.id,
    'Insurance expired on 2025-03-15',
    now,
    loadFlagged.id
  );
  db.prepare(`INSERT INTO load_audit (load_id, from_status, to_status, action, note, changed_by, changed_at) VALUES (?, 'Posted','Carrier Assigned','assign_carrier','Auto-flagged: Insurance expired on 2025-03-15',?,?)`).run(loadFlagged.id, dispatcherUser.id, now);
}

console.log('Seed complete.\n');
console.log('Login credentials:');
console.log('  Broker Admin:      admin@meridianfreight.com / admin123');
console.log('  Broker Dispatcher: dispatcher@meridianfreight.com / dispatch123  (role: Dispatcher)');
console.log('  Broker Ops Lead:   opslead@meridianfreight.com / opslead123      (role: Ops Lead)');
console.log('  Carrier Admin:     admin@swifttrucking.com / admin123           (Swift Trucking Co — compliant)');
console.log('  Carrier Driver:    driver@swifttrucking.com / driver123         (role: Driver)');
console.log('  Carrier Admin:     admin@bluelinelogistics.com / admin123       (Blue Line Logistics — expired insurance, demoes auto-flag)');
console.log('  Carrier Admin:     admin@apexfreightlines.com / admin123       (Apex Freight Lines — insurance expiring in 14 days, demoes renewal alert)');
console.log('  Shipper:           shipper@globalretail.com / shipper123');
console.log('  Shipper:           shipper@techsupply.com / shipper123');
console.log('\nDemo loads: LF-1001 (Posted), LF-1002 (Rate Confirmed), LF-1003 (Carrier Assigned + compliance flag)');
