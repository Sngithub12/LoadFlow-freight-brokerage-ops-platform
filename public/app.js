'use strict';

/* ============================== State ============================== */
const S = {
  token: localStorage.getItem('loadflow_token') || null,
  user: null,
  statusFlow: ['Posted', 'Carrier Assigned', 'Rate Confirmed', 'Dispatched', 'In Transit', 'Delivered', 'POD Verified', 'Invoiced/Closed'],
};

const app = document.getElementById('app');

/* ============================== API ============================== */
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers['Authorization'] = `Bearer ${S.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (res.status === 401) {
    logout(false);
    throw new Error(data.error || 'Session expired, please log in again');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ============================== Helpers ============================== */
function hasPerm(key) {
  if (!S.user) return false;
  return S.user.is_admin || (S.user.permissions || []).includes(key);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(n) { return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateTime(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function go(hash) { location.hash = hash; }

function showToast(msg, type = 'ok') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function closeModal() { const m = document.querySelector('.modal-backdrop'); if (m) m.remove(); }
function openModal(innerHtml) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
  return backdrop;
}

/* ============================== Ladder (signature component) ============================== */
function ladderHtml(currentStatus, { mini = false } = {}) {
  const flow = S.statusFlow;
  const idx = flow.indexOf(currentStatus);
  if (mini) {
    return `<div class="ladder-mini" title="${esc(currentStatus)}">${flow
      .map((_, i) => `<span class="dot ${i < idx ? 'done' : i === idx ? 'current' : ''}"></span>`)
      .join('')}</div>`;
  }
  let segs = '';
  flow.forEach((label, i) => {
    const nodeState = i < idx ? 'done' : i === idx ? 'current' : '';
    segs += `<div class="node ${nodeState}"></div>`;
    if (i < flow.length - 1) {
      const segState = i < idx ? 'done' : i === idx ? 'current' : '';
      segs += `<div class="seg ${segState}"></div>`;
    }
  });
  const labels = flow.map((l) => `<span>${esc(l)}</span>`).join('');
  return `<div class="ladder">${segs}</div><div class="ladder-labels">${labels}</div>`;
}

function complianceBadge(load) {
  if (load.compliance_flag) return `<span class="badge badge-flag"><span class="badge-dot"></span>Flagged</span>`;
  if (load.compliance_override_note) return `<span class="badge badge-warn"><span class="badge-dot"></span>Overridden</span>`;
  return '';
}
function statusBadge(status) {
  const cls = status === 'Invoiced/Closed' ? 'badge-ok' : status === 'Posted' ? 'badge-neutral' : 'badge-teal';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

/* ============================== Auth ============================== */
async function login(email, password) {
  const data = await api('POST', '/api/auth/login', { email, password });
  S.token = data.token;
  S.user = data.user;
  localStorage.setItem('loadflow_token', S.token);
  go('#/dashboard');
}
function logout(navigate = true) {
  if (S.token) api('POST', '/api/auth/logout').catch(() => {});
  S.token = null; S.user = null;
  localStorage.removeItem('loadflow_token');
  if (navigate) go('#/login');
  else render();
}

const DEMO_ACCOUNTS = [
  { label: 'Broker · Admin', email: 'admin@meridianfreight.com', password: 'admin123' },
  { label: 'Broker · Dispatcher', email: 'dispatcher@meridianfreight.com', password: 'dispatch123' },
  { label: 'Broker · Ops Lead', email: 'opslead@meridianfreight.com', password: 'opslead123' },
  { label: 'Carrier · Admin (compliant)', email: 'admin@swifttrucking.com', password: 'admin123' },
  { label: 'Carrier · Driver', email: 'driver@swifttrucking.com', password: 'driver123' },
  { label: 'Carrier · Admin (expired ins.)', email: 'admin@bluelinelogistics.com', password: 'admin123' },
  { label: 'Shipper', email: 'shipper@globalretail.com', password: 'shipper123' },
];

function renderLogin() {
  app.innerHTML = `
  <div class="login-screen">
    <div class="login-card">
      <div class="login-brand"><span class="mark">▮▮▶</span><span class="word">LoadFlow</span></div>
      <div class="login-sub">Freight brokerage operations console</div>
      <div id="login-error"></div>
      <form id="login-form">
        <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username" /></div>
        <div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password" /></div>
        <button class="btn btn-primary btn-full" type="submit">Sign in</button>
      </form>
      <details class="demo-accounts">
        <summary>Demo accounts (click to autofill)</summary>
        <div class="demo-list">
          ${DEMO_ACCOUNTS.map((a) => `<div class="demo-row" data-demo="${esc(a.email)}" data-pw="${esc(a.password)}"><span>${esc(a.label)}</span><span class="who mono">${esc(a.email)}</span></div>`).join('')}
        </div>
      </details>
    </div>
  </div>`;

  app.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = app.querySelector('#login-error');
    errBox.innerHTML = '';
    try {
      await login(fd.get('email'), fd.get('password'));
    } catch (err) {
      errBox.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });
  app.querySelectorAll('.demo-row').forEach((row) => {
    row.addEventListener('click', () => {
      app.querySelector('[name=email]').value = row.dataset.demo;
      app.querySelector('[name=password]').value = row.dataset.pw;
    });
  });
}

/* ============================== Shell ============================== */
function navItemsFor(user) {
  const items = [{ href: '#/dashboard', label: 'Load Board', icon: '☰' }];
  if (user.account_type === 'carrier') items[0].label = 'My Loads';
  if (user.account_type === 'shipper') items[0].label = 'My Shipments';
  if (user.account_type === 'broker' || user.account_type === 'carrier') {
    items.push({ href: '#/compliance', label: 'Compliance', icon: '⛨' });
  }
  if (hasPerm('staff.manage')) items.push({ href: '#/staff', label: 'Staff & Roles', icon: '☺' });
  if (S.user.is_admin) items.push({ href: '#/audit', label: 'Audit Log', icon: '≡' });
  return items;
}

function renderShell(contentHtml, activeHref) {
  const items = navItemsFor(S.user);
  const orgKind = S.user.account_type === 'shipper' ? 'Shipper' : S.user.account_type === 'broker' ? 'Broker' : 'Carrier';
  app.innerHTML = `
  <div class="shell">
    <div class="sidebar">
      <div class="login-brand"><span class="mark">▮▮▶</span><span class="word">LoadFlow</span></div>
      <div class="org-tag"><div class="name">${esc(S.user.org_name || S.user.name)}</div><div class="kind">${orgKind}${S.user.is_admin ? ' · Admin' : ''}</div></div>
      ${items.map((i) => `<a class="nav-item ${i.href === activeHref ? 'active' : ''}" href="${i.href}"><span>${i.icon}</span>${esc(i.label)}</a>`).join('')}
      <div class="sidebar-footer">
        <div class="user-chip"><div class="name">${esc(S.user.name)}</div>${esc(S.user.email)}</div>
        <a class="nav-item" id="logout-link" href="#">↩ Sign out</a>
      </div>
    </div>
    <div class="main">${contentHtml}</div>
  </div>`;
  const lo = app.querySelector('#logout-link');
  if (lo) lo.addEventListener('click', (e) => { e.preventDefault(); logout(); });
}

/* ============================== Dashboard ============================== */
async function renderDashboard(query) {
  renderShell(`<div class="page-head"><h1>Loading…</h1></div>`, '#/dashboard');
  try {
    const isBroker = S.user.account_type === 'broker';
    const [{ loads }, alertsResult] = await Promise.all([
      api('GET', `/api/loads${query ? '?' + query : ''}`),
      isBroker ? api('GET', '/api/org/compliance-alerts').catch(() => ({ alerts: [] })) : Promise.resolve({ alerts: [] }),
    ]);
    const complianceAlerts = alertsResult.alerts || [];
    const total = loads.length;
    const flagged = loads.filter((l) => l.compliance_flag).length;
    const active = loads.filter((l) => !['Posted', 'Invoiced/Closed'].includes(l.status)).length;
    const posted = loads.filter((l) => l.status === 'Posted').length;

    const title = S.user.account_type === 'broker' ? 'Load Board' : S.user.account_type === 'carrier' ? 'Assigned Loads' : 'My Shipments';
    const params = new URLSearchParams(query || '');
    const canCreate = S.user.account_type === 'broker' && hasPerm('load.create');

    const alertLevelBadge = { critical: 'badge-flag', missing: 'badge-flag', warning: 'badge-warn' };
    const alertBanner = complianceAlerts.length
      ? `<div class="flag-banner" style="align-items:center">
          <span>⚠</span>
          <div style="flex:1">
            <strong>${complianceAlerts.length} carrier${complianceAlerts.length > 1 ? 's' : ''} need${complianceAlerts.length > 1 ? '' : 's'} compliance attention</strong>
            — ${complianceAlerts
              .slice(0, 3)
              .map((a) => `${esc(a.org_name)} <span class="badge ${alertLevelBadge[a.level] || 'badge-neutral'}" style="margin-left:2px">${esc(a.message)}</span>`)
              .join(', ')}${complianceAlerts.length > 3 ? `, +${complianceAlerts.length - 3} more` : ''}
          </div>
          <a class="btn btn-sm btn-ghost" href="#/compliance">Review</a>
        </div>`
      : '';

    const html = `
    <div class="page-head">
      <div><h1>${title}</h1><div class="sub">${S.user.account_type === 'broker' ? "Your brokerage's posted &amp; in-flight loads" : S.user.account_type === 'carrier' ? 'Loads assigned to your carrier org' : 'Status &amp; delivery confirmation for your freight'}</div></div>
      ${canCreate ? `<button class="btn btn-primary" id="new-load-btn">+ New Load</button>` : ''}
    </div>
    ${alertBanner}
    <div class="grid-3" style="margin-bottom:20px">
      <div class="stat"><div class="num">${total}</div><div class="label">Total loads</div></div>
      <div class="stat"><div class="num">${S.user.account_type === 'broker' ? posted : active}</div><div class="label">${S.user.account_type === 'broker' ? 'Awaiting carrier' : 'In progress'}</div></div>
      <div class="stat"><div class="num" style="color:${flagged ? 'var(--danger)' : 'inherit'}">${flagged}</div><div class="label">Compliance flags</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="q" placeholder="Search reference, origin, destination…" value="${esc(params.get('q') || '')}" style="min-width:260px" />
      <select id="status-filter">
        <option value="">All statuses</option>
        ${S.statusFlow.map((s) => `<option value="${esc(s)}" ${params.get('status') === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
    </div>
    <div class="card" style="padding:0">
      <table>
        <thead><tr><th>Reference</th><th>Route</th><th>Pipeline</th><th>Status</th><th>${S.user.account_type === 'shipper' ? 'Broker' : S.user.account_type === 'broker' ? 'Carrier' : 'Shipper'}</th><th>Flags</th><th>Updated</th></tr></thead>
        <tbody>
          ${loads.length === 0 ? `<tr class="empty-row"><td colspan="7">No loads match. ${canCreate ? 'Post the first one.' : ''}</td></tr>` : ''}
          ${loads
            .map(
              (l) => `<tr class="row-link" data-goto="#/loads/${l.id}">
              <td class="ref">${esc(l.reference)}</td>
              <td>${esc(l.origin)} → ${esc(l.destination)}</td>
              <td>${ladderHtml(l.status, { mini: true })}</td>
              <td>${statusBadge(l.status)}</td>
              <td>${esc(l.other_party_name || '—')}</td>
              <td>${complianceBadge(l)}</td>
              <td class="mono" style="color:var(--text-dim);font-size:12px">${fmtDateTime(l.updated_at)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
    renderShell(html, '#/dashboard');

    app.querySelectorAll('[data-goto]').forEach((row) => row.addEventListener('click', () => go(row.dataset.goto)));
    const qInput = app.querySelector('#q');
    const statusSel = app.querySelector('#status-filter');
    function applyFilters() {
      const p = new URLSearchParams();
      if (qInput.value.trim()) p.set('q', qInput.value.trim());
      if (statusSel.value) p.set('status', statusSel.value);
      renderDashboard(p.toString());
    }
    let debounce;
    qInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(applyFilters, 300); });
    statusSel.addEventListener('change', applyFilters);
    if (canCreate) app.querySelector('#new-load-btn').addEventListener('click', openNewLoadModal);
  } catch (err) {
    renderShell(`<div class="error-msg">${esc(err.message)}</div>`, '#/dashboard');
  }
}

function openNewLoadModal() {
  const m = openModal(`
    <button class="modal-close" id="mclose">&times;</button>
    <h2>Post a new load</h2>
    <div id="nl-error"></div>
    <form id="nl-form">
      <div class="field"><label>Shipper email</label><input name="shipper_email" type="email" required placeholder="shipper@company.com" /></div>
      <div class="grid-2">
        <div class="field"><label>Origin</label><input name="origin" required placeholder="Chicago, IL" /></div>
        <div class="field"><label>Destination</label><input name="destination" required placeholder="Dallas, TX" /></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Pickup date</label><input name="pickup_date" type="date" /></div>
        <div class="field"><label>Delivery date</label><input name="delivery_date" type="date" /></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Equipment type</label><input name="equipment_type" list="equip-list" required placeholder="Dry Van" /></div>
        <div class="field"><label>Commodity type</label><input name="commodity_type" list="commodity-list" required placeholder="General" /></div>
      </div>
      <datalist id="equip-list"><option>Dry Van</option><option>Reefer</option><option>Flatbed</option><option>Step Deck</option><option>Tanker</option></datalist>
      <datalist id="commodity-list"><option>General</option><option>Refrigerated</option><option>Hazmat</option><option>Electronics</option><option>Perishable</option></datalist>
      <div class="hint">The shipper must already have a LoadFlow account (ask them to sign up, or create one out of band).</div>
      <div class="action-row"><button class="btn btn-primary" type="submit">Post load</button></div>
    </form>`);
  m.querySelector('#mclose').addEventListener('click', closeModal);
  m.querySelector('#nl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      const { load } = await api('POST', '/api/loads', body);
      closeModal();
      showToast(`Load ${load.reference} posted`);
      go(`#/loads/${load.id}`);
    } catch (err) {
      m.querySelector('#nl-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });
}

/* ============================== Load detail ============================== */
async function renderLoadDetail(id) {
  renderShell(`<div class="page-head"><h1>Loading…</h1></div>`, '#/dashboard');
  try {
    const [{ load }, { audit }, { rates }] = await Promise.all([
      api('GET', `/api/loads/${id}`),
      api('GET', `/api/loads/${id}/audit`),
      api('GET', `/api/loads/${id}/rates`),
    ]);
    let carriers = [];
    if (S.user.account_type === 'broker') {
      try { carriers = (await api('GET', '/api/compliance')).carriers; } catch (e) {}
    }

    const isBroker = S.user.account_type === 'broker';
    const isCarrier = S.user.account_type === 'carrier';
    const currentRate = rates.find((r) => r.is_current);

    let actions = '';
    if (isBroker) {
      if (load.status === 'Posted' && hasPerm('load.assign_carrier')) actions += `<button class="btn btn-primary" data-act="assign">Assign carrier</button>`;
      if (load.status === 'Carrier Assigned' && load.compliance_flag && hasPerm('load.override_compliance_flag')) actions += `<button class="btn btn-danger" data-act="override">Override compliance flag</button>`;
      if (load.status === 'Carrier Assigned' && !load.compliance_flag && hasPerm('rate.confirm')) actions += `<button class="btn btn-primary" data-act="confirm-rate">Confirm rate</button>`;
      if (load.status === 'Rate Confirmed' && hasPerm('load.update_status')) actions += `<button class="btn btn-primary" data-act="dispatch">Dispatch</button>`;
      if (load.status === 'POD Verified' && hasPerm('load.update_status')) actions += `<button class="btn btn-primary" data-act="close">Close / invoice</button>`;
    }
    if (isCarrier) {
      if (load.status === 'Carrier Assigned' && hasPerm('load.update_status')) actions += `<button class="btn btn-danger" data-act="decline">Decline load</button>`;
      if (load.status === 'Dispatched' && hasPerm('load.update_status')) actions += `<button class="btn btn-teal" data-act="in-transit">Mark in transit</button>`;
      if (load.status === 'In Transit' && hasPerm('load.update_status')) actions += `<button class="btn btn-teal" data-act="delivered">Mark delivered</button>`;
      if (load.status === 'Delivered' && hasPerm('pod.upload')) actions += `<button class="btn btn-teal" data-act="pod">Upload POD</button>`;
    }

    const html = `
    <div class="page-head">
      <div><h1 class="mono">${esc(load.reference)}</h1><div class="sub">${esc(load.origin)} → ${esc(load.destination)}</div></div>
      ${statusBadge(load.status)}
    </div>

    ${load.compliance_flag ? `<div class="flag-banner"><span>⚠</span><div><strong>Compliance flag:</strong> ${esc(load.compliance_flag_reason || 'Carrier does not meet requirements')}. Progression past "Carrier Assigned" is blocked until this is resolved or overridden.</div></div>` : ''}
    ${load.compliance_override_note ? `<div class="override-banner"><strong>Compliance overridden.</strong> ${esc(load.compliance_override_note)}</div>` : ''}

    <div class="card">
      <h3>Pipeline</h3>
      ${ladderHtml(load.status)}
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Shipment details</h3>
        <table>
          <tr><td style="color:var(--text-dim)">Equipment</td><td>${esc(load.equipment_type)}</td></tr>
          <tr><td style="color:var(--text-dim)">Commodity</td><td>${esc(load.commodity_type)}</td></tr>
          <tr><td style="color:var(--text-dim)">Pickup</td><td>${fmtDate(load.pickup_date)}</td></tr>
          <tr><td style="color:var(--text-dim)">Delivery</td><td>${fmtDate(load.delivery_date)}</td></tr>
          <tr><td style="color:var(--text-dim)">Broker</td><td>${esc(load.broker_org_name || '—')}</td></tr>
          <tr><td style="color:var(--text-dim)">Carrier</td><td>${esc(load.carrier_org_name || 'Not yet assigned')}</td></tr>
          <tr><td style="color:var(--text-dim)">Shipper</td><td>${esc(load.shipper_name || '—')}</td></tr>
          ${load.pod_file_name ? `<tr><td style="color:var(--text-dim)">POD file</td><td class="mono">${esc(load.pod_file_name)}</td></tr>` : ''}
        </table>
      </div>
      <div class="card">
        <h3>Rate confirmation${currentRate ? ` · v${currentRate.version}` : ''}</h3>
        ${currentRate
          ? `<div style="font-family:var(--font-mono);font-size:22px;font-weight:600;margin-bottom:8px">${fmtMoney(currentRate.base_rate)}</div>
             ${currentRate.accessorials.length ? `<table>${currentRate.accessorials.map((a) => `<tr><td style="color:var(--text-dim)">${esc(a.label)}</td><td>${fmtMoney(a.amount)}</td></tr>`).join('')}</table>` : ''}
             ${rates.length > 1 ? `<div class="hint">${rates.length} versions on file · latest confirmed ${fmtDateTime(currentRate.confirmed_at)}</div>` : ''}`
          : `<div class="hint">No rate confirmed yet.</div>`}
      </div>
    </div>

    ${actions ? `<div class="card"><h3>Actions</h3><div class="action-row">${actions}</div></div>` : ''}

    <div class="card">
      <h3>Audit trail</h3>
      <div class="audit-list">
        ${audit
          .map(
            (a) => `<div class="audit-item">
              <div class="t">${fmtDateTime(a.changed_at)}</div>
              <div><strong>${esc(a.action.replace(/_/g, ' '))}</strong>${a.from_status ? ` — ${esc(a.from_status)} → ${esc(a.to_status)}` : ''}<br/>
              <span class="who">${esc(a.changed_by_name)} (${esc(a.changed_by_account_type)})${a.note ? ' · ' + esc(a.note) : ''}</span></div>
            </div>`
          )
          .join('')}
      </div>
    </div>
    <a class="subtle-link" href="#/dashboard">← Back to list</a>
    `;
    renderShell(html, '#/dashboard');

    app.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => handleLoadAction(btn.dataset.act, load, carriers)));
  } catch (err) {
    renderShell(`<div class="error-msg">${esc(err.message)}</div><a class="subtle-link" href="#/dashboard">← Back</a>`, '#/dashboard');
  }
}

async function handleLoadAction(action, load, carriers) {
  try {
    if (action === 'assign') {
      const options = carriers
        .map(
          (c) =>
            `<option value="${c.org_id}">${esc(c.org_name)}${c.compliance ? (c.compliance.authority_status !== 'active' ? ' — authority not active' : '') : ' — no compliance record'}</option>`
        )
        .join('');
      const m = openModal(`
        <button class="modal-close" id="mclose">&times;</button>
        <h2>Assign carrier</h2>
        <div class="hint" style="margin-bottom:12px">Compliance is checked automatically against equipment (${esc(load.equipment_type)}) and commodity (${esc(load.commodity_type)}) requirements.</div>
        <div id="am-error"></div>
        <form id="am-form">
          <div class="field"><label>Carrier</label><select name="carrier_org_id" required><option value="">Select a carrier…</option>${options}</select></div>
          <div class="action-row"><button class="btn btn-primary" type="submit">Assign</button></div>
        </form>`);
      m.querySelector('#mclose').addEventListener('click', closeModal);
      m.querySelector('#am-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const carrier_org_id = Number(new FormData(e.target).get('carrier_org_id'));
        try {
          await api('POST', `/api/loads/${load.id}/assign-carrier`, { carrier_org_id });
          closeModal(); showToast('Carrier assigned'); renderLoadDetail(load.id);
        } catch (err) { m.querySelector('#am-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`; }
      });
      return;
    }

    if (action === 'override') {
      const m = openModal(`
        <button class="modal-close" id="mclose">&times;</button>
        <h2>Override compliance flag</h2>
        <div class="hint" style="margin-bottom:12px">Flag: ${esc(load.compliance_flag_reason)}</div>
        <div id="ov-error"></div>
        <form id="ov-form">
          <div class="field"><label>Justification (required, kept in the audit trail)</label><textarea name="note" rows="3" required placeholder="e.g. manual insurance certificate verified 7/16 by ops"></textarea></div>
          <div class="action-row"><button class="btn btn-danger" type="submit">Override &amp; continue</button></div>
        </form>`);
      m.querySelector('#mclose').addEventListener('click', closeModal);
      m.querySelector('#ov-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const note = new FormData(e.target).get('note');
        try {
          await api('POST', `/api/loads/${load.id}/override-compliance`, { note });
          closeModal(); showToast('Compliance flag overridden'); renderLoadDetail(load.id);
        } catch (err) { m.querySelector('#ov-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`; }
      });
      return;
    }

    if (action === 'confirm-rate') {
      const m = openModal(`
        <button class="modal-close" id="mclose">&times;</button>
        <h2>Confirm rate</h2>
        <div id="rc-error"></div>
        <form id="rc-form">
          <div class="field"><label>Base rate (USD)</label><input name="base_rate" type="number" min="1" step="0.01" required /></div>
          <div class="field"><label>Accessorials (optional)</label>
            <div id="acc-rows"></div>
            <button type="button" class="btn btn-sm btn-ghost" id="add-acc">+ Add accessorial</button>
          </div>
          <div class="action-row"><button class="btn btn-primary" type="submit">Confirm rate</button></div>
        </form>`);
      m.querySelector('#mclose').addEventListener('click', closeModal);
      const accRows = m.querySelector('#acc-rows');
      function addAccRow() {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px';
        row.innerHTML = `<input placeholder="Label (e.g. Fuel surcharge)" class="acc-label" style="flex:2;background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:7px 9px" />
          <input placeholder="Amount" type="number" step="0.01" class="acc-amount" style="flex:1;background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:7px 9px" />
          <button type="button" class="btn btn-sm btn-ghost rm-acc">✕</button>`;
        row.querySelector('.rm-acc').addEventListener('click', () => row.remove());
        accRows.appendChild(row);
      }
      m.querySelector('#add-acc').addEventListener('click', addAccRow);
      m.querySelector('#rc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const base_rate = Number(new FormData(e.target).get('base_rate'));
        const accessorials = [...accRows.querySelectorAll('div')]
          .map((row) => ({ label: row.querySelector('.acc-label').value, amount: Number(row.querySelector('.acc-amount').value) }))
          .filter((a) => a.label && a.amount);
        try {
          await api('POST', `/api/loads/${load.id}/confirm-rate`, { base_rate, accessorials });
          closeModal(); showToast('Rate confirmed'); renderLoadDetail(load.id);
        } catch (err) { m.querySelector('#rc-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`; }
      });
      return;
    }

    if (action === 'pod') {
      const m = openModal(`
        <button class="modal-close" id="mclose">&times;</button>
        <h2>Upload proof of delivery</h2>
        <div class="hint" style="margin-bottom:12px">This build stores a filename reference only (no binary storage).</div>
        <div id="pod-error"></div>
        <form id="pod-form">
          <div class="field"><label>File name</label><input name="file_name" required placeholder="POD-${esc(load.reference)}.pdf" /></div>
          <div class="action-row"><button class="btn btn-teal" type="submit">Upload</button></div>
        </form>`);
      m.querySelector('#mclose').addEventListener('click', closeModal);
      m.querySelector('#pod-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const file_name = new FormData(e.target).get('file_name');
        try {
          await api('POST', `/api/loads/${load.id}/pod`, { file_name });
          closeModal(); showToast('POD uploaded & verified'); renderLoadDetail(load.id);
        } catch (err) { m.querySelector('#pod-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`; }
      });
      return;
    }

    if (action === 'decline') {
      const note = prompt('Optional note for declining this load:') || '';
      await api('POST', `/api/loads/${load.id}/decline`, { note });
      showToast('Load declined, returned to Posted'); renderLoadDetail(load.id);
      return;
    }

    // simple one-shot transitions
    const endpointMap = { dispatch: 'dispatch', 'in-transit': 'in-transit', delivered: 'delivered', close: 'close' };
    if (endpointMap[action]) {
      await api('POST', `/api/loads/${load.id}/${endpointMap[action]}`, {});
      showToast('Updated'); renderLoadDetail(load.id);
    }
  } catch (err) {
    showToast(err.message, 'err');
  }
}

/* ============================== Staff & Roles ============================== */
async function renderStaff() {
  renderShell(`<div class="page-head"><h1>Loading…</h1></div>`, '#/staff');
  try {
    const [{ roles }, { staff }, { permissions }] = await Promise.all([
      api('GET', '/api/org/roles'),
      api('GET', '/api/org/staff'),
      api('GET', '/api/permissions'),
    ]);

    const html = `
    <div class="page-head"><div><h1>Staff &amp; Roles</h1><div class="sub">Permissions are checked server-side on every request — this UI just edits the bundles.</div></div></div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Roles</h3>
        <button class="btn btn-sm btn-primary" id="new-role-btn">+ New role</button>
      </div>
      ${roles.length === 0 ? `<div class="hint">No custom roles yet. Admins can act without one; staff need a role to gain permissions.</div>` : ''}
      ${roles
        .map(
          (r) => `<div style="padding:10px 0;border-bottom:1px solid var(--border-soft)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>${esc(r.name)}</strong>
              <div><button class="btn btn-sm btn-ghost" data-edit-role="${r.id}">Edit</button> <button class="btn btn-sm btn-ghost" data-del-role="${r.id}">Delete</button></div>
            </div>
            <div style="margin-top:6px">${r.permissions.length ? r.permissions.map((p) => `<span class="role-chip mono">${esc(p)}</span>`).join('') : '<span class="hint">No permissions granted</span>'}</div>
          </div>`
        )
        .join('')}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Staff</h3>
        <button class="btn btn-sm btn-primary" id="new-staff-btn">+ Add staff</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${staff
            .map(
              (u) => `<tr>
              <td>${esc(u.name)}</td><td class="mono" style="font-size:12px">${esc(u.email)}</td>
              <td>${u.is_admin ? '<span class="badge badge-ok">Admin</span>' : roleSelectHtml(u, roles)}</td>
              <td>${u.active ? '<span class="badge badge-ok">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
              <td>${u.is_admin ? '' : `<button class="btn btn-sm btn-ghost" data-toggle-active="${u.id}" data-active="${u.active}">${u.active ? 'Deactivate' : 'Reactivate'}</button>`}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
    renderShell(html, '#/staff');

    app.querySelector('#new-role-btn').addEventListener('click', () => openRoleModal(null, permissions));
    app.querySelectorAll('[data-edit-role]').forEach((b) => b.addEventListener('click', () => openRoleModal(roles.find((r) => r.id == b.dataset.editRole), permissions)));
    app.querySelectorAll('[data-del-role]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Delete this role?')) return;
        try { await api('DELETE', `/api/org/roles/${b.dataset.delRole}`); showToast('Role deleted'); renderStaff(); }
        catch (err) { showToast(err.message, 'err'); }
      })
    );
    app.querySelector('#new-staff-btn').addEventListener('click', () => openStaffModal(roles));
    app.querySelectorAll('[data-role-select]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        try { await api('PUT', `/api/org/staff/${sel.dataset.roleSelect}`, { role_id: sel.value ? Number(sel.value) : null }); showToast('Role updated'); }
        catch (err) { showToast(err.message, 'err'); renderStaff(); }
      })
    );
    app.querySelectorAll('[data-toggle-active]').forEach((b) =>
      b.addEventListener('click', async () => {
        try { await api('PUT', `/api/org/staff/${b.dataset.toggleActive}`, { active: b.dataset.active === '0' }); renderStaff(); }
        catch (err) { showToast(err.message, 'err'); }
      })
    );
  } catch (err) {
    renderShell(`<div class="error-msg">${esc(err.message)}</div>`, '#/staff');
  }
}
function roleSelectHtml(u, roles) {
  return `<select data-role-select="${u.id}"><option value="">No role</option>${roles.map((r) => `<option value="${r.id}" ${u.role_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;
}

function openRoleModal(role, permissions) {
  const m = openModal(`
    <button class="modal-close" id="mclose">&times;</button>
    <h2>${role ? 'Edit role' : 'New role'}</h2>
    <div id="rm-error"></div>
    <form id="rm-form">
      <div class="field"><label>Role name</label><input name="name" required value="${role ? esc(role.name) : ''}" /></div>
      <div class="field"><label>Permissions</label>
        ${permissions
          .map(
            (p) => `<label class="perm-check"><input type="checkbox" name="perm" value="${p.key}" ${role && role.permissions.includes(p.key) ? 'checked' : ''}/> ${esc(p.label)} <span class="k">${p.key}</span></label>`
          )
          .join('')}
      </div>
      <div class="action-row"><button class="btn btn-primary" type="submit">${role ? 'Save changes' : 'Create role'}</button></div>
    </form>`);
  m.querySelector('#mclose').addEventListener('click', closeModal);
  m.querySelector('#rm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get('name');
    const permission_keys = fd.getAll('perm');
    try {
      if (role) await api('PUT', `/api/org/roles/${role.id}`, { name, permission_keys });
      else await api('POST', '/api/org/roles', { name, permission_keys });
      closeModal(); showToast('Role saved'); renderStaff();
    } catch (err) { m.querySelector('#rm-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`; }
  });
}

function openStaffModal(roles) {
  const m = openModal(`
    <button class="modal-close" id="mclose">&times;</button>
    <h2>Add staff</h2>
    <div class="hint" style="margin-bottom:12px">There's no email delivery in this build — you'll get a temp password to hand off directly.</div>
    <div id="sm-error"></div>
    <form id="sm-form">
      <div class="field"><label>Name</label><input name="name" required /></div>
      <div class="field"><label>Email</label><input name="email" type="email" required /></div>
      <div class="field"><label>Role</label><select name="role_id"><option value="">No role (no permissions)</option>${roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="action-row"><button class="btn btn-primary" type="submit">Create account</button></div>
    </form>`);
  m.querySelector('#mclose').addEventListener('click', closeModal);
  m.querySelector('#sm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { name: fd.get('name'), email: fd.get('email'), role_id: fd.get('role_id') ? Number(fd.get('role_id')) : null };
    try {
      const { temp_password } = await api('POST', '/api/org/staff', body);
      closeModal();
      openModal(`<h2>Account created</h2><p>Share these credentials with ${esc(body.name)}:</p>
        <div class="card mono" style="background:var(--panel-alt)">${esc(body.email)}<br/>Temp password: <strong>${esc(temp_password)}</strong></div>
        <div class="action-row"><button class="btn btn-primary" id="done-btn">Done</button></div>`);
      document.querySelector('#done-btn').addEventListener('click', () => { closeModal(); renderStaff(); });
    } catch (err) { m.querySelector('#sm-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`; }
  });
}

/* ============================== Compliance ============================== */
async function renderCompliance() {
  renderShell(`<div class="page-head"><h1>Loading…</h1></div>`, '#/compliance');
  try {
    const { carriers } = await api('GET', '/api/compliance');
    if (S.user.account_type === 'broker') {
      const needsAttention = carriers.filter((c) => c.alert && c.alert.level !== 'ok');
      const alertBadgeClass = { critical: 'badge-flag', missing: 'badge-flag', warning: 'badge-warn', ok: 'badge-ok' };

      const alertsCard = `
      <div class="card">
        <h3>Renewal alerts</h3>
        ${needsAttention.length === 0
          ? `<div class="hint">All carriers are within their compliance window — nothing needs attention right now.</div>`
          : `<table>
              <thead><tr><th>Carrier</th><th>Status</th></tr></thead>
              <tbody>${needsAttention
                .map(
                  (c) => `<tr>
                    <td>${esc(c.org_name)}</td>
                    <td><span class="badge ${alertBadgeClass[c.alert.level]}">${esc(c.alert.message)}</span></td>
                  </tr>`
                )
                .join('')}</tbody>
            </table>`}
      </div>`;

      const html = `
      <div class="page-head"><div><h1>Carrier Compliance</h1><div class="sub">Reference used automatically when you assign a carrier to a load. Renewal alerts fire within ${30} days of an insurance expiry.</div></div></div>
      ${alertsCard}
      <div class="card" style="padding:0"><table>
        <thead><tr><th>Carrier</th><th>MC/DOT</th><th>Authority</th><th>Insurance</th><th>Equipment</th><th>Commodities</th></tr></thead>
        <tbody>${carriers
          .map((c) => {
            const cmp = c.compliance;
            const alert = c.alert || { level: 'missing' };
            return `<tr>
            <td>${esc(c.org_name)}</td>
            <td class="mono">${esc(cmp?.mc_dot_number || '—')}</td>
            <td>${cmp ? (cmp.authority_status === 'active' ? '<span class="badge badge-ok">Active</span>' : `<span class="badge badge-flag">${esc(cmp.authority_status)}</span>`) : '<span class="badge badge-neutral">No record</span>'}</td>
            <td>${cmp?.insurance_expiry ? `<span class="badge ${alertBadgeClass[alert.level] || 'badge-neutral'}">${fmtDate(cmp.insurance_expiry)}</span>` : '<span class="badge badge-neutral">—</span>'}</td>
            <td>${cmp?.approved_equipment?.join(', ') || '—'}</td>
            <td>${cmp?.approved_commodities?.join(', ') || '—'}</td>
          </tr>`;
          })
          .join('')}</tbody>
      </table></div>`;
      renderShell(html, '#/compliance');
      return;
    }

    // carrier: edit own record
    const own = carriers[0];
    const cmp = own?.compliance;
    const canEdit = S.user.is_admin || hasPerm('staff.manage');
    const html = `
    <div class="page-head"><div><h1>Your Compliance Record</h1><div class="sub">Brokers see this automatically when deciding whether to assign you a load.</div></div></div>
    <div class="card">
      <form id="cf-form">
        <div class="grid-2">
          <div class="field"><label>MC/DOT number</label><input name="mc_dot_number" value="${esc(cmp?.mc_dot_number || '')}" ${canEdit ? '' : 'disabled'} /></div>
          <div class="field"><label>Authority status</label><select name="authority_status" ${canEdit ? '' : 'disabled'}>
            <option value="active" ${cmp?.authority_status === 'active' ? 'selected' : ''}>Active</option>
            <option value="pending" ${cmp?.authority_status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="revoked" ${cmp?.authority_status === 'revoked' ? 'selected' : ''}>Revoked</option>
          </select></div>
        </div>
        <div class="field"><label>Insurance expiry</label><input name="insurance_expiry" type="date" value="${esc(cmp?.insurance_expiry || '')}" ${canEdit ? '' : 'disabled'} /></div>
        <div class="field"><label>Approved equipment (comma-separated)</label><input name="approved_equipment" value="${esc((cmp?.approved_equipment || []).join(', '))}" placeholder="Dry Van, Reefer" ${canEdit ? '' : 'disabled'} /></div>
        <div class="field"><label>Approved commodities (comma-separated)</label><input name="approved_commodities" value="${esc((cmp?.approved_commodities || []).join(', '))}" placeholder="General, Refrigerated" ${canEdit ? '' : 'disabled'} /></div>
        ${canEdit ? `<div class="action-row"><button class="btn btn-primary" type="submit">Save</button></div>` : `<div class="hint">Only your org Admin (or staff with "Manage staff & roles") can edit this.</div>`}
      </form>
    </div>`;
    renderShell(html, '#/compliance');
    if (canEdit) {
      app.querySelector('#cf-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {
          mc_dot_number: fd.get('mc_dot_number'),
          authority_status: fd.get('authority_status'),
          insurance_expiry: fd.get('insurance_expiry'),
          approved_equipment: fd.get('approved_equipment').split(',').map((s) => s.trim()).filter(Boolean),
          approved_commodities: fd.get('approved_commodities').split(',').map((s) => s.trim()).filter(Boolean),
        };
        try { await api('PUT', `/api/compliance/${S.user.org_id}`, body); showToast('Compliance record updated'); renderCompliance(); }
        catch (err) { showToast(err.message, 'err'); }
      });
    }
  } catch (err) {
    renderShell(`<div class="error-msg">${esc(err.message)}</div>`, '#/compliance');
  }
}

/* ============================== Audit log ============================== */
async function renderAuditLog() {
  renderShell(`<div class="page-head"><h1>Loading…</h1></div>`, '#/audit');
  try {
    const { audit } = await api('GET', '/api/org/audit-log');
    const html = `
    <div class="page-head"><div><h1>Audit Log</h1><div class="sub">Every status change across your org's loads (latest 200).</div></div></div>
    <div class="card">
      <div class="audit-list">
        ${audit.length === 0 ? '<div class="hint">No activity yet.</div>' : ''}
        ${audit
          .map(
            (a) => `<div class="audit-item">
            <div class="t">${fmtDateTime(a.changed_at)}</div>
            <div><a href="#/loads/${a.load_id}" class="ref">${esc(a.reference)}</a> — <strong>${esc(a.action.replace(/_/g, ' '))}</strong>${a.from_status ? ` (${esc(a.from_status)} → ${esc(a.to_status)})` : ''}<br/>
            <span class="who">${esc(a.changed_by_name)}${a.note ? ' · ' + esc(a.note) : ''}</span></div>
          </div>`
          )
          .join('')}
      </div>
    </div>`;
    renderShell(html, '#/audit');
  } catch (err) {
    renderShell(`<div class="error-msg">${esc(err.message)}</div>`, '#/audit');
  }
}

/* ============================== Router ============================== */
async function boot() {
  if (S.token && !S.user) {
    try { S.user = (await api('GET', '/api/auth/me')).user; } catch (e) { S.token = null; }
  }
  try { const r = await api('GET', '/api/status-flow'); S.statusFlow = r.flow; } catch (e) {}
  render();
}

function render() {
  if (!S.token || !S.user) { renderLogin(); return; }
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\//, '').split('/');
  if (hash === '#/login' || hash === '#/') { go('#/dashboard'); return; }
  if (parts[0] === 'dashboard') return renderDashboard('');
  if (parts[0] === 'loads' && parts[1]) return renderLoadDetail(parts[1]);
  if (parts[0] === 'staff') return renderStaff();
  if (parts[0] === 'compliance') return renderCompliance();
  if (parts[0] === 'audit') return renderAuditLog();
  renderDashboard('');
}

window.addEventListener('hashchange', render);
boot();
