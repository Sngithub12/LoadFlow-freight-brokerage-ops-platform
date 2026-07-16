// db.js — schema + connection.
// Uses Node's built-in `node:sqlite` (stable since Node 22.5) rather than a
// database package — this layer specifically needs no `npm install` and no
// native build step, even though the rest of the app now depends on
// express/jsonwebtoken/bcryptjs (see package.json).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'loadflow.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('broker','carrier')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  applies_to TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id),
  permission_id INTEGER NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_type TEXT NOT NULL CHECK(account_type IN ('broker','carrier','shipper')),
  org_id INTEGER REFERENCES orgs(id),
  role_id INTEGER REFERENCES roles(id),
  is_admin INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS carrier_compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier_org_id INTEGER NOT NULL UNIQUE REFERENCES orgs(id),
  mc_dot_number TEXT,
  authority_status TEXT NOT NULL DEFAULT 'active',
  insurance_expiry TEXT,
  approved_equipment TEXT NOT NULL DEFAULT '[]',
  approved_commodities TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  broker_org_id INTEGER NOT NULL REFERENCES orgs(id),
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  carrier_org_id INTEGER REFERENCES orgs(id),
  status TEXT NOT NULL DEFAULT 'Posted',
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  pickup_date TEXT,
  delivery_date TEXT,
  equipment_type TEXT NOT NULL,
  commodity_type TEXT NOT NULL,
  compliance_flag INTEGER NOT NULL DEFAULT 0,
  compliance_flag_reason TEXT,
  compliance_override_note TEXT,
  compliance_overridden_by INTEGER REFERENCES users(id),
  pod_file_name TEXT,
  pod_uploaded_by INTEGER REFERENCES users(id),
  pod_uploaded_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id INTEGER NOT NULL REFERENCES loads(id),
  version INTEGER NOT NULL,
  base_rate REAL NOT NULL,
  accessorials TEXT NOT NULL DEFAULT '[]',
  is_current INTEGER NOT NULL DEFAULT 1,
  confirmed_by INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TEXT NOT NULL,
  UNIQUE(load_id, version)
);

CREATE TABLE IF NOT EXISTS load_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id INTEGER NOT NULL REFERENCES loads(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_denied_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  required_permission TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

module.exports = db;
