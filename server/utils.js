'use strict';

// res is a real Express response here, so this is just a thin, explicit
// wrapper — kept because every route handler already calls sendJson(ctx.res, ...)
// and rewriting ~25 call sites to res.status().json() directly wasn't worth
// the risk for a purely cosmetic change.
function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function nowISO() {
  return new Date().toISOString();
}

module.exports = { sendJson, nowISO };
