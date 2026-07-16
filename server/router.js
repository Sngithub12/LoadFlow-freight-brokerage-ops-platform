'use strict';
// Thin adapter over Express: the route files (routes/auth.js, routes/loads.js,
// etc.) were written against a small "chain of ctx => {...} handlers" style —
// requireAuth, requirePermission('x'), then the actual handler, composed in
// one array per route. That style is preserved here so the RBAC/state-machine
// logic didn't need to be rewritten; what changed is that dispatch is now
// real Express (app.get/post/put/delete, real path-to-regexp param parsing)
// instead of a hand-rolled matcher.
const express = require('express');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Composes a chain of `async (ctx) => {...}` handlers into one Express
// request handler. Any handler can throw HttpError to short-circuit with a
// clean status/message; any handler can `return 'STOP'` once it has written
// the response, to skip the rest of the chain.
function compose(handlers) {
  return async function (req, res, next) {
    const ctx = {
      req,
      res,
      params: req.params,
      query: req.query,
      body: req.body || {},
      user: req.user || null,
    };
    try {
      for (const handler of handlers) {
        const result = await handler(ctx);
        if (ctx.user) req.user = ctx.user; // let later Express middleware see it too
        if (result === 'STOP') break;
      }
    } catch (err) {
      next(err);
    }
  };
}

class Router {
  constructor(app) {
    this.app = app;
  }
  get(pattern, ...handlers) { this.app.get(pattern, compose(handlers)); }
  post(pattern, ...handlers) { this.app.post(pattern, compose(handlers)); }
  put(pattern, ...handlers) { this.app.put(pattern, compose(handlers)); }
  delete(pattern, ...handlers) { this.app.delete(pattern, compose(handlers)); }
}

// Express error-handling middleware (must take 4 args to be recognized as
// such). Mount this last, after every route is registered.
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { Router, HttpError, errorHandler, express };
