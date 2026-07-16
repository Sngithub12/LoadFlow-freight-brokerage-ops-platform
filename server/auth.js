'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const config = require('./config');

const BCRYPT_ROUNDS = 10;

function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

// JWT auth is stateless: the token itself is the "session," signed with
// JWT_SECRET and carrying the user id + an expiry. There's nothing to store
// server-side at login and nothing to delete at logout (see destroySession).
function createSession(userId) {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: `${config.SESSION_TTL_HOURS}h` });
}

// Stateless tokens can't be revoked server-side without a blocklist, which
// this build doesn't implement — "logout" just means the client discards
// the token. Kept as a named function (rather than inlined at the call
// site) so swapping in a real blocklist/refresh-token scheme later is a
// one-file change.
function destroySession(_token) {
  return;
}

function getUserFromToken(token) {
  if (!token) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET);
  } catch (e) {
    return null; // expired, malformed, or signed with a different secret
  }
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(decoded.sub);
  return user || null;
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, getUserFromToken };
