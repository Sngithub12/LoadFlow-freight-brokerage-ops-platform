'use strict';
const path = require('node:path');
const config = require('./config');
const { Router, errorHandler, express } = require('./router');
const { seedPermissions } = require('./permissions');

seedPermissions();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' })); // parses req.body for us — no hand-rolled body reader needed

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Route files are unchanged from the pre-Express version: each exports
// register(router) and receives this same Router adapter (see router.js).
const router = new Router(app);
require('./routes/auth').register(router);
require('./routes/org').register(router);
require('./routes/loads').register(router);
require('./routes/audit').register(router);

// Any /api/* route that didn't match above is a real 404.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback: any other unmatched GET (client-side hash routes like
// /#/loads/3 never even reach the server, but a hard refresh on a path like
// /loads/3 would) gets index.html so the frontend router can take over.
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`LoadFlow listening on http://localhost:${config.PORT}`);
});
