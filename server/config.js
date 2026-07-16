'use strict';
require('dotenv').config(); // loads .env into process.env before we read it, if present

function intFromEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const DEV_FALLBACK_SECRET = 'loadflow-dev-secret-change-me';

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (NODE_ENV === 'production') {
    // Refuse to start rather than silently sign tokens with a guessable
    // secret. This is the one thing that must never be optional in a real
    // deployment — a leaked/guessable JWT_SECRET means anyone can forge a
    // valid login for any account.
    console.error(
      '[config] FATAL: JWT_SECRET is not set. Refusing to start with NODE_ENV=production.\n' +
        '  Set it in your environment or .env file. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
    process.exit(1);
  }
  console.warn(
    '[config] JWT_SECRET not set — using a dev-only fallback (fine for local testing, NOT fine for a real deployment).'
  );
  JWT_SECRET = DEV_FALLBACK_SECRET;
}

module.exports = {
  NODE_ENV,
  PORT: intFromEnv('PORT', 3000),
  SESSION_TTL_HOURS: intFromEnv('SESSION_TTL_HOURS', 12),
  JWT_SECRET,
};
