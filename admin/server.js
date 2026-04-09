require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const db = require('../src/db');

const app = express();
const PORT = process.env.PORT || process.env.ADMIN_PORT || 3001;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));

const requireAuth = (req, res, next) => {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
};

// ─── Login ────────────────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  res.send(loginPage(req.query.err));
});

app.post('/admin/login', (req, res) => {
  if (req.body.secret === ADMIN_SECRET) { req.session.admin = true; res.redirect('/admin'); }
  else res.redirect('/admin/login?err=1');
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/admin', requireAuth, async (req, res) => {
  const [stats, top, boostHistory] = await Promise.all([
    db.getDashboardStats(),
    db.getBoostLeaderboard('desc'),
    db.getAllBoosts(60, 0),
  ]);

  // Boosts per day (last 14 days)
  const dayMap = {};
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dayMap[d.toISOString().slice(0, 10)] = 0;
  }
  boostHistory.forEach(b => {
    const day = (b.created_at || '').slice(0, 10);
    if (dayMap[day] !== undefined) dayMap[day]++;
  });
  const chartLabels = JSON.stringify(Object.keys(dayMap).map(d => {
    const [, m, dd] = d.split('-');
    return `${dd}/${m}`;
  }));
  const chartData = JSON.stringify(Object.values(dayMap));

  // Pie: active vs never boosted
  const active = stats.totalUsers - stats.neverBoosted;
  const pieLabels = JSON.stringify(['Boosted', 'Never boosted']);
  const pieData = JSON.stringify([active, stats.neverBoosted]);

  const topRows = top.slice(0, 5).map((u, i) => `
    <tr>
      <td><span class="rank">#${i + 1}</span></td>
      <td>
        <div class="user-cell">
          <span class="avatar">${(u.first_name || u.username || '?')[0].toUpperCase()}</span>
          <div>
            <div class="user-name">${u.first_name || '—'}</div>
            <div class="user-sub">${u.username ? '@' + u.username : ''}</div>
          </div>
        </div>
      </td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank" class="link">View profile</a>` : '—'}</td>
      <td><span class="chip chip-blue">${u.boost_count} boosts</span></td>
      <td class="text-muted">${u.last_boost ? fmtDate(u.last_boost) : '—'}</td>
    </tr>
  `).join('');

  res.send(layout('Dashboard', `
    <div class="page-header">
      <h1>Dashboard</h1>
    </div>

    <div class="stats-grid">
      ${statCard('Total users', stats.totalUsers, 'users', 'blue')}
      ${statCard('Boosts today', stats.todayBoosts, 'rocket', 'purple')}
      ${statCard('Total boosts', stats.totalBoosts, 'chart', 'green')}
      ${statCard('Never boosted', stats.neverBoosted, 'sleep', 'orange')}
    </div>

    <div class="charts-row">
      <div class="card chart-card">
        <div class="card-header">
          <h2>Boosts per day</h2>
          <span class="text-muted">Last 14 days</span>
        </div>
        <canvas id="lineChart" height="100"></canvas>
      </div>
      <div class="card chart-card chart-card--small">
        <div class="card-header">
          <h2>Activity</h2>
        </div>
        <canvas id="pieChart"></canvas>
        <div class="pie-legend">
          <span class="legend-dot blue"></span><span>Boosted (${active})</span>
          <span class="legend-dot orange"></span><span>Never (${stats.neverBoosted})</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Top active users</h2>
        <a href="/admin/leaderboard" class="link">View all</a>
      </div>
      <table>
        <thead><tr><th>#</th><th>User</th><th>Dribbble</th><th>Boosts</th><th>Last boost</th></tr></thead>
        <tbody>${topRows}</tbody>
      </table>
    </div>

    <script>
    const lineCtx = document.getElementById('lineChart').getContext('2d');
    new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: ${chartLabels},
        datasets: [{
          label: 'Boosts',
          data: ${chartData},
          fill: true,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          tension: 0.4,
          pointBackgroundColor: '#6366f1',
          pointRadius: 4,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f3f4f6' } },
          x: { grid: { display: false } }
        }
      }
    });

    const pieCtx = document.getElementById('pieChart').getContext('2d');
    new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: ${pieLabels},
        datasets: [{
          data: ${pieData},
          backgroundColor: ['#6366f1', '#f97316'],
          borderWidth: 0,
          hoverOffset: 6,
        }]
      },
      options: {
        cutout: '70%',
        plugins: { legend: { display: false } },
      }
    });
    </script>
  `));
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/admin/users', requireAuth, async (req, res) => {
  const page_num = parseInt(req.query.page || 1);
  const search = req.query.search || '';
  const limit = 20;
  const offset = (page_num - 1) * limit;
  const users = await db.getAllUsers(limit, offset, search);

  const rows = users.map(u => `
    <tr class="${u.is_banned ? 'row-banned' : ''}">
      <td><code class="code">${u.id}</code></td>
      <td>
        <div class="user-cell">
          <span class="avatar avatar-sm">${(u.first_name || u.username || '?')[0].toUpperCase()}</span>
          <div>
            <div class="user-name">${u.first_name || '—'}</div>
            <div class="user-sub">${u.username ? '@' + u.username : ''}</div>
          </div>
        </div>
      </td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank" class="link">View profile</a>` : '<span class="text-muted">—</span>'}</td>
      <td class="text-muted">${fmtDate(u.created_at)}</td>
      <td>${u.is_banned
        ? '<span class="chip chip-red">Banned</span>'
        : '<span class="chip chip-green">Active</span>'}</td>
      <td style="display:flex;gap:6px;align-items:center">
        ${u.is_banned
          ? `<button onclick="userAction(${u.id},'unban')" class="btn btn-sm btn-green">Unban</button>`
          : `<button onclick="userAction(${u.id},'ban')" class="btn btn-sm btn-red">Ban</button>`}
        <button onclick="deleteUser(${u.id},'${(u.first_name || u.username || 'this user').replace(/'/g, '')}')" class="btn btn-sm btn-delete">Delete</button>
      </td>
    </tr>
  `).join('');

  res.send(layout('Users', `
    <div class="page-header">
      <h1>Users</h1>
    </div>
    <div class="card">
      <div class="card-header">
        <form method="GET" class="search-form">
          <div class="input-wrap">
            <svg class="input-icon" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="#9ca3af" stroke-width="1.5"/><path d="M15 15l-3-3" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round"/></svg>
            <input type="text" name="search" value="${search}" placeholder="Search by name, username, or ID...">
          </div>
          <button type="submit" class="btn btn-primary">Search</button>
          ${search ? `<a href="/admin/users" class="btn btn-secondary">Clear</a>` : ''}
        </form>
      </div>
      <table>
        <thead><tr><th>ID</th><th>User</th><th>Dribbble</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows.length ? rows : '<tr><td colspan="6" class="empty">No users found</td></tr>'}</tbody>
      </table>
      <div class="pagination">
        ${page_num > 1 ? `<a href="?page=${page_num - 1}&search=${search}" class="btn btn-secondary">← Prev</a>` : ''}
        <span class="text-muted">Page ${page_num}</span>
        ${users.length === limit ? `<a href="?page=${page_num + 1}&search=${search}" class="btn btn-secondary">Next →</a>` : ''}
      </div>
    </div>
    <script>
    async function userAction(id, action) {
      if (!confirm('Are you sure?')) return;
      const r = await fetch('/admin/api/users/' + id + '/' + action, { method: 'POST' });
      const d = await r.json();
      if (d.ok) location.reload(); else alert('Error: ' + d.error);
    }
    async function deleteUser(id, name) {
      if (!confirm('Delete ' + name + '?\n\nThis will permanently remove the user and all their data. This cannot be undone.')) return;
      const r = await fetch('/admin/api/users/' + id + '/delete', { method: 'POST' });
      const d = await r.json();
      if (d.ok) location.reload(); else alert('Error: ' + d.error);
    }
    </script>
  `));
});

// ─── Boosts ───────────────────────────────────────────────────────────────────
app.get('/admin/boosts', requireAuth, async (req, res) => {
  const page_num = parseInt(req.query.page || 1);
  const limit = 50;
  const offset = (page_num - 1) * limit;
  const boosts = await db.getAllBoosts(limit, offset);

  const rows = boosts.map(b => `
    <tr>
      <td class="text-muted">${fmtDate(b.created_at)}</td>
      <td>
        <div class="user-cell">
          <span class="avatar avatar-sm">${(b.first_name || b.username || '?')[0].toUpperCase()}</span>
          <div>
            <div class="user-name">${b.first_name || '—'}</div>
            <div class="user-sub">${b.username ? '@' + b.username : ''}</div>
          </div>
        </div>
      </td>
      <td>${b.dribbble_url ? `<a href="${b.dribbble_url}" target="_blank" class="link">Profile</a>` : '—'}</td>
    </tr>
  `).join('');

  res.send(layout('Boosts', `
    <div class="page-header">
      <h1>Boosts</h1>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Date</th><th>User</th><th>Profile</th></tr></thead>
        <tbody>${rows.length ? rows : '<tr><td colspan="3" class="empty">No boosts yet</td></tr>'}</tbody>
      </table>
      <div class="pagination">
        ${page_num > 1 ? `<a href="?page=${page_num - 1}" class="btn btn-secondary">← Prev</a>` : ''}
        <span class="text-muted">Page ${page_num}</span>
        ${boosts.length === limit ? `<a href="?page=${page_num + 1}" class="btn btn-secondary">Next →</a>` : ''}
      </div>
    </div>
  `));
});

// ─── Inactive ─────────────────────────────────────────────────────────────────
app.get('/admin/inactive', requireAuth, async (req, res) => {
  const days = parseInt(req.query.days || 7);
  const users = await db.getUsersWhoDidntBoost(days);

  const rows = users.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <span class="avatar avatar-sm">${(u.first_name || u.username || '?')[0].toUpperCase()}</span>
          <div>
            <div class="user-name">${u.first_name || '—'}</div>
            <div class="user-sub">${u.username ? '@' + u.username : ''}</div>
          </div>
        </div>
      </td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank" class="link">Profile</a>` : '—'}</td>
      <td class="text-muted">${fmtDate(u.created_at)}</td>
    </tr>
  `).join('');

  res.send(layout('Inactive', `
    <div class="page-header">
      <h1>Inactive Users</h1>
    </div>
    <div class="card">
      <div class="card-header">
        <form method="GET" class="search-form">
          <span class="text-muted">No boost in the last</span>
          <select name="days" class="select">
            ${[3, 7, 14, 30].map(d => `<option value="${d}" ${d == days ? 'selected' : ''}>${d} days</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-primary">Show</button>
        </form>
        <span class="chip chip-orange">${users.length} users</span>
      </div>
      <table>
        <thead><tr><th>User</th><th>Dribbble</th><th>Joined</th></tr></thead>
        <tbody>${rows.length ? rows : '<tr><td colspan="3" class="empty">Everyone is active! 🎉</td></tr>'}</tbody>
      </table>
    </div>
  `));
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────
app.get('/admin/leaderboard', requireAuth, async (req, res) => {
  const sort = req.query.sort || 'desc';
  const users = await db.getBoostLeaderboard(sort);

  const max = users[0]?.boost_count || 1;

  const rows = users.map((u, i) => `
    <tr>
      <td><span class="rank">#${i + 1}</span></td>
      <td>
        <div class="user-cell">
          <span class="avatar avatar-sm">${(u.first_name || u.username || '?')[0].toUpperCase()}</span>
          <div>
            <div class="user-name">${u.first_name || '—'}</div>
            <div class="user-sub">${u.username ? '@' + u.username : ''}</div>
          </div>
        </div>
      </td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank" class="link">Profile</a>` : '—'}</td>
      <td>
        <div class="bar-wrap">
          <div class="bar-fill" style="width:${Math.round((u.boost_count / max) * 100)}%"></div>
          <span class="bar-label">${u.boost_count}</span>
        </div>
      </td>
      <td class="text-muted">${u.last_boost ? fmtDate(u.last_boost) : '—'}</td>
    </tr>
  `).join('');

  res.send(layout('Leaderboard', `
    <div class="page-header">
      <h1>Leaderboard</h1>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="tab-group">
          <a href="?sort=desc" class="tab ${sort === 'desc' ? 'tab-active' : ''}">Most active</a>
          <a href="?sort=asc" class="tab ${sort === 'asc' ? 'tab-active' : ''}">Least active</a>
        </div>
      </div>
      <table>
        <thead><tr><th>#</th><th>User</th><th>Dribbble</th><th>Boosts</th><th>Last boost</th></tr></thead>
        <tbody>${rows.length ? rows : '<tr><td colspan="5" class="empty">No data</td></tr>'}</tbody>
      </table>
    </div>
  `));
});

// ─── API ──────────────────────────────────────────────────────────────────────
app.post('/admin/api/users/:id/ban', requireAuth, async (req, res) => {
  try { await db.updateUser(req.params.id, { is_banned: true }); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/admin/api/users/:id/unban', requireAuth, async (req, res) => {
  try { await db.updateUser(req.params.id, { is_banned: false }); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/admin/api/users/:id/delete', requireAuth, async (req, res) => {
  try { await db.deleteUser(req.params.id); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statCard(label, value, icon, color) {
  const icons = {
    users: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    rocket: `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>`,
    chart: `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
    sleep: `<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/>`,
  };
  const colorMap = {
    blue: '#6366f1', purple: '#a855f7', green: '#22c55e', orange: '#f97316',
  };
  const bgMap = {
    blue: 'rgba(99,102,241,0.1)', purple: 'rgba(168,85,247,0.1)', green: 'rgba(34,197,94,0.1)', orange: 'rgba(249,115,22,0.1)',
  };
  return `
    <div class="stat-card">
      <div class="stat-icon" style="background:${bgMap[color]};color:${colorMap[color]}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg>
      </div>
      <div class="stat-body">
        <div class="stat-num">${value}</div>
        <div class="stat-label">${label}</div>
      </div>
    </div>`;
}

function loginPage(err) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;background:linear-gradient(135deg,#f0f0ff 0%,#faf5ff 100%);min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:20px;padding:40px;width:360px;box-shadow:0 8px 40px rgba(99,102,241,.15)}
  .logo{text-align:center;margin-bottom:24px}
  .logo-icon{width:56px;height:56px;background:linear-gradient(135deg,#6366f1,#a855f7);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:12px}
  h2{font-size:22px;font-weight:700;color:#111;text-align:center;margin-bottom:4px}
  .sub{text-align:center;color:#9ca3af;font-size:14px;margin-bottom:28px}
  input{width:100%;padding:12px 16px;border:1.5px solid #e5e7eb;border-radius:12px;font-size:15px;outline:none;transition:.15s;margin-bottom:12px}
  input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
  button{width:100%;padding:13px;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;transition:.2s}
  button:hover{opacity:.9}
  .error{color:#ef4444;font-size:13px;text-align:center;margin-top:10px}
</style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">🏀</div>
      <h2>DribbbleBoost</h2>
      <p class="sub">Admin Panel</p>
    </div>
    <form method="POST" action="/admin/login">
      <input type="password" name="secret" placeholder="Password" required autofocus>
      <button type="submit">Sign in</button>
    </form>
    ${err ? '<p class="error">Wrong password. Try again.</p>' : ''}
  </div>
</body>
</html>`;
}

function layout(title, content) {
  const nav = [
    { href: '/admin', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Dashboard' },
    { href: '/admin/users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12 7a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm9 4h-6', label: 'Users' },
    { href: '/admin/boosts', icon: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z', label: 'Boosts' },
    { href: '/admin/inactive', icon: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z', label: 'Inactive' },
    { href: '/admin/leaderboard', icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', label: 'Leaderboard' },
  ];

  const navItems = nav.map(n => {
    const active = n.href === '/admin' ? title === 'Dashboard' : title === n.label;
    return `
      <a href="${n.href}" class="nav-item ${active ? 'nav-active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${n.icon}"/></svg>
        ${n.label}
      </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — DribbbleBoost Admin</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;background:#f8f9fc;color:#111827;min-height:100vh;display:flex}

  /* Sidebar */
  .sidebar{width:230px;min-height:100vh;background:#fff;border-right:1px solid #f0f0f5;display:flex;flex-direction:column;position:fixed;top:0;left:0;z-index:10}
  .sidebar-logo{padding:22px 20px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f0f0f5}
  .sidebar-logo-icon{width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#a855f7);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
  .sidebar-logo-text{font-weight:700;font-size:15px;color:#111}
  .sidebar-logo-sub{font-size:11px;color:#9ca3af}
  .nav-section{padding:12px 12px 0;flex:1}
  .nav-label{font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:.8px;text-transform:uppercase;padding:0 8px 6px}
  .nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;color:#6b7280;text-decoration:none;font-size:14px;font-weight:500;transition:all .15s;margin-bottom:2px}
  .nav-item svg{width:18px;height:18px;flex-shrink:0}
  .nav-item:hover{background:#f5f5ff;color:#6366f1}
  .nav-active{background:#eef2ff!important;color:#6366f1!important}
  .nav-active svg{stroke:#6366f1}
  .sidebar-footer{padding:16px 12px;border-top:1px solid #f0f0f5}
  .logout-btn{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;color:#9ca3af;text-decoration:none;font-size:14px;font-weight:500;transition:.15s}
  .logout-btn:hover{background:#fef2f2;color:#ef4444}

  /* Main */
  .main{margin-left:230px;padding:28px 32px;flex:1;max-width:calc(100vw - 230px)}
  .page-header{margin-bottom:24px}
  .page-header h1{font-size:22px;font-weight:700;color:#111}

  /* Stats */
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px}
  .stat-card{background:#fff;border-radius:16px;padding:20px;display:flex;align-items:center;gap:16px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 1px 2px rgba(0,0,0,.04);border:1px solid #f0f0f5}
  .stat-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .stat-icon svg{width:22px;height:22px}
  .stat-num{font-size:28px;font-weight:800;line-height:1;color:#111}
  .stat-label{font-size:13px;color:#9ca3af;margin-top:3px}

  /* Charts */
  .charts-row{display:grid;grid-template-columns:1fr 280px;gap:16px;margin-bottom:24px}
  .chart-card{padding:20px}
  .chart-card--small{}
  .pie-legend{display:flex;align-items:center;gap:8px;font-size:13px;color:#6b7280;margin-top:12px;justify-content:center;flex-wrap:wrap}
  .legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .legend-dot.blue{background:#6366f1}
  .legend-dot.orange{background:#f97316}

  /* Card */
  .card{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 1px 2px rgba(0,0,0,.04);border:1px solid #f0f0f5;overflow:hidden;margin-bottom:20px}
  .card-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #f9f9fc;flex-wrap:wrap;gap:10px}
  .card-header h2{font-size:15px;font-weight:600;color:#111}

  /* Table */
  table{width:100%;border-collapse:collapse}
  th{background:#fafafd;padding:10px 20px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af;letter-spacing:.5px;border-bottom:1px solid #f0f0f5}
  td{padding:13px 20px;border-bottom:1px solid #f9f9fc;font-size:14px;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fafafa}
  .row-banned td{opacity:.45}
  .empty{text-align:center;color:#9ca3af;padding:40px!important;font-size:14px}

  /* User cell */
  .user-cell{display:flex;align-items:center;gap:10px}
  .avatar{width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#a855f7);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px;flex-shrink:0}
  .avatar-sm{width:30px;height:30px;border-radius:8px;font-size:13px}
  .user-name{font-weight:500;font-size:14px}
  .user-sub{font-size:12px;color:#9ca3af}

  /* Chips */
  .chip{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
  .chip-blue{background:#eef2ff;color:#6366f1}
  .chip-green{background:#dcfce7;color:#16a34a}
  .chip-red{background:#fef2f2;color:#ef4444}
  .chip-orange{background:#fff7ed;color:#ea580c}

  /* Buttons */
  .btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 16px;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;border:none;text-decoration:none;transition:.15s}
  .btn-primary{background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff!important}
  .btn-primary:hover{opacity:.9}
  .btn-secondary{background:#f3f4f6;color:#374151!important;border:1px solid #e5e7eb}
  .btn-secondary:hover{background:#e5e7eb}
  .btn-sm{padding:5px 12px;font-size:12px;border-radius:8px}
  .btn-green{background:#dcfce7;color:#16a34a!important}
  .btn-green:hover{background:#bbf7d0}
  .btn-red{background:#fef2f2;color:#ef4444!important}
  .btn-red:hover{background:#fee2e2}
  .btn-delete{background:#1c1c1e;color:#fff!important}
  .btn-delete:hover{background:#3a3a3c}

  /* Misc */
  .rank{font-weight:700;color:#6366f1;font-size:15px}
  .code{font-size:12px;background:#f3f4f6;padding:2px 7px;border-radius:6px;font-family:monospace}
  .link{color:#6366f1;text-decoration:none;font-weight:500}
  .link:hover{text-decoration:underline}
  .text-muted{color:#9ca3af}

  /* Search */
  .search-form{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .input-wrap{position:relative}
  .input-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px}
  .input-wrap input{padding:9px 12px 9px 36px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;outline:none;transition:.15s;min-width:260px}
  .input-wrap input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
  .select{padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;outline:none;background:#fff}

  /* Bar */
  .bar-wrap{display:flex;align-items:center;gap:10px;min-width:140px}
  .bar-fill{height:6px;border-radius:3px;background:linear-gradient(90deg,#6366f1,#a855f7);min-width:4px}
  .bar-label{font-size:13px;font-weight:600;color:#111;white-space:nowrap}

  /* Tabs */
  .tab-group{display:flex;background:#f3f4f6;border-radius:10px;padding:3px;gap:2px}
  .tab{padding:6px 14px;border-radius:8px;font-size:13px;font-weight:500;color:#6b7280;text-decoration:none;transition:.15s}
  .tab:hover{color:#111}
  .tab-active{background:#fff;color:#6366f1!important;box-shadow:0 1px 3px rgba(0,0,0,.1)}

  /* Pagination */
  .pagination{display:flex;align-items:center;gap:10px;padding:16px 20px}
</style>
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">🏀</div>
      <div>
        <div class="sidebar-logo-text">DribbbleBoost</div>
        <div class="sidebar-logo-sub">Admin Panel</div>
      </div>
    </div>
    <div class="nav-section">
      ${navItems}
    </div>
    <div class="sidebar-footer">
      <a href="/admin/logout" class="logout-btn">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign out
      </a>
    </div>
  </aside>
  <main class="main">
    ${content}
  </main>
</body>
</html>`;
}

app.listen(PORT, () => console.log(`Admin: http://localhost:${PORT}/admin`));
module.exports = app;
