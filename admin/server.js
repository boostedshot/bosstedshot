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
  res.send(page('Вход', `
    <div class="login-box">
      <div class="login-logo">🏀</div>
      <h2>DribbbleBoost Admin</h2>
      <form method="POST" action="/admin/login">
        <input type="password" name="secret" placeholder="Пароль" required autofocus>
        <button type="submit">Войти</button>
      </form>
      ${req.query.err ? '<p class="error">Неверный пароль</p>' : ''}
    </div>
  `));
});

app.post('/admin/login', (req, res) => {
  if (req.body.secret === ADMIN_SECRET) { req.session.admin = true; res.redirect('/admin'); }
  else res.redirect('/admin/login?err=1');
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/admin', requireAuth, async (req, res) => {
  const stats = await db.getDashboardStats();
  const top = await db.getBoostLeaderboard('desc');
  const topRows = top.slice(0, 5).map((u, i) => `
    <tr>
      <td><b>#${i+1}</b></td>
      <td>${u.first_name || ''} ${u.username ? `@${u.username}` : ''}</td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank">🏀 профиль</a>` : '—'}</td>
      <td><b>${u.boost_count}</b></td>
      <td>${u.last_boost ? fmtDate(u.last_boost) : '—'}</td>
    </tr>
  `).join('');

  res.send(page('Dashboard', `
    <h1>📊 Dashboard</h1>
    <div class="stats-grid">
      <div class="stat-card blue">
        <div class="stat-num">${stats.totalUsers}</div>
        <div class="stat-label">Всего пользователей</div>
      </div>
      <div class="stat-card green">
        <div class="stat-num">${stats.todayBoosts}</div>
        <div class="stat-label">Бустов сегодня</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.totalBoosts}</div>
        <div class="stat-label">Всего бустов</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-num">${stats.neverBoosted}</div>
        <div class="stat-label">Ни разу не бустили</div>
      </div>
    </div>

    <h2 style="margin:32px 0 16px">🏆 Топ активных</h2>
    <table>
      <thead><tr><th>#</th><th>Пользователь</th><th>Dribbble</th><th>Бустов</th><th>Последний</th></tr></thead>
      <tbody>${topRows}</tbody>
    </table>

    <div class="quick-links" style="margin-top:24px">
      <a href="/admin/users" class="btn">👥 Пользователи</a>
      <a href="/admin/boosts" class="btn">🚀 Бусты</a>
      <a href="/admin/inactive" class="btn orange">😴 Неактивные</a>
      <a href="/admin/leaderboard" class="btn">🏆 Лидерборд</a>
    </div>
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
    <tr class="${u.is_banned ? 'banned' : ''}">
      <td><code>${u.id}</code></td>
      <td>
        ${u.first_name || ''}<br>
        <small>${u.username ? '@' + u.username : '—'}</small>
      </td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank">🏀 профиль</a>` : '<span style="color:#aaa">не указан</span>'}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td>
        ${u.is_banned
          ? `<span class="badge danger">забанен</span>`
          : `<span class="badge success">активен</span>`}
      </td>
      <td>
        ${u.is_banned
          ? `<button onclick="userAction(${u.id},'unban')" class="btn-sm success">Разбанить</button>`
          : `<button onclick="userAction(${u.id},'ban')" class="btn-sm danger">Бан</button>`}
      </td>
    </tr>
  `).join('');

  res.send(page('Пользователи', `
    <h1>👥 Пользователи</h1>
    <div class="toolbar">
      <form method="GET">
        <input type="text" name="search" value="${search}" placeholder="Поиск по имени, username, ID...">
        <button type="submit" class="btn">Найти</button>
        ${search ? '<a href="/admin/users" class="btn-sm">✕ Сброс</a>' : ''}
      </form>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Пользователь</th><th>Dribbble</th><th>Регистрация</th><th>Статус</th><th>Действия</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="pagination">
      ${page_num > 1 ? `<a href="?page=${page_num-1}&search=${search}" class="btn-sm">← Назад</a>` : ''}
      <span>Страница ${page_num}</span>
      ${users.length === limit ? `<a href="?page=${page_num+1}&search=${search}" class="btn-sm">Далее →</a>` : ''}
    </div>
    <script>
    async function userAction(id, action) {
      if (!confirm('Подтвердить?')) return;
      const r = await fetch('/admin/api/users/' + id + '/' + action, { method: 'POST' });
      const d = await r.json();
      if (d.ok) location.reload(); else alert('Ошибка: ' + d.error);
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
      <td>${fmtDate(b.created_at)}</td>
      <td>${b.first_name || ''} ${b.username ? `@${b.username}` : ''}</td>
      <td>${b.dribbble_url ? `<a href="${b.dribbble_url}" target="_blank">🏀 открыть</a>` : '—'}</td>
      <td><a href="${b.shot_url}" target="_blank">🔗 шот</a></td>
    </tr>
  `).join('');

  res.send(page('Бусты', `
    <h1>🚀 Бусты</h1>
    <table>
      <thead><tr><th>Дата</th><th>Пользователь</th><th>Профиль</th><th>Шот</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="pagination">
      ${page_num > 1 ? `<a href="?page=${page_num-1}" class="btn-sm">← Назад</a>` : ''}
      <span>Страница ${page_num}</span>
      ${boosts.length === limit ? `<a href="?page=${page_num+1}" class="btn-sm">Далее →</a>` : ''}
    </div>
  `));
});

// ─── Inactive ─────────────────────────────────────────────────────────────────
app.get('/admin/inactive', requireAuth, async (req, res) => {
  const days = parseInt(req.query.days || 7);
  const users = await db.getUsersWhoDidntBoost(days);

  const rows = users.map(u => `
    <tr>
      <td>${u.first_name || ''} ${u.username ? `@${u.username}` : ''}</td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank">🏀 профиль</a>` : '—'}</td>
      <td>${fmtDate(u.created_at)}</td>
    </tr>
  `).join('');

  res.send(page('Неактивные', `
    <h1>😴 Не делали буст</h1>
    <div class="toolbar">
      <form method="GET">
        <label style="font-size:14px;margin-right:8px">За последние</label>
        <select name="days" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:14px">
          ${[3,7,14,30].map(d => `<option value="${d}" ${d==days?'selected':''}>${d} дней</option>`).join('')}
        </select>
        <button type="submit" class="btn">Показать</button>
      </form>
    </div>
    <p style="margin-bottom:16px;color:#666">Найдено: <b>${users.length}</b> пользователей</p>
    <table>
      <thead><tr><th>Пользователь</th><th>Dribbble</th><th>Регистрация</th></tr></thead>
      <tbody>${rows.length ? rows : '<tr><td colspan="3" style="text-align:center;color:#aaa;padding:32px">Все активны! 🎉</td></tr>'}</tbody>
    </table>
  `));
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────
app.get('/admin/leaderboard', requireAuth, async (req, res) => {
  const sort = req.query.sort || 'desc';
  const users = await db.getBoostLeaderboard(sort);

  const rows = users.map((u, i) => `
    <tr>
      <td><b>${i+1}</b></td>
      <td>${u.first_name || ''} ${u.username ? `@${u.username}` : ''}</td>
      <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank">🏀 профиль</a>` : '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="background:#1c6ef2;height:8px;border-radius:4px;width:${Math.min(u.boost_count * 12, 120)}px"></div>
          <b>${u.boost_count}</b>
        </div>
      </td>
      <td>${u.last_boost ? fmtDate(u.last_boost) : '<span style="color:#aaa">никогда</span>'}</td>
    </tr>
  `).join('');

  res.send(page('Лидерборд', `
    <h1>🏆 Лидерборд активности</h1>
    <div class="toolbar">
      <a href="?sort=desc" class="btn ${sort==='desc'?'':'btn-outline'}">⬇ Чаще бустят</a>
      <a href="?sort=asc" class="btn ${sort==='asc'?'':'btn-outline'}" style="margin-left:8px">⬆ Реже бустят</a>
    </div>
    <table>
      <thead><tr><th>#</th><th>Пользователь</th><th>Dribbble</th><th>Бустов</th><th>Последний буст</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function page(title, content) {
  const nav = title !== 'Вход' ? `
    <nav class="sidebar">
      <div class="logo">🏀 DribbbleBoost</div>
      <a href="/admin">📊 Dashboard</a>
      <a href="/admin/users">👥 Пользователи</a>
      <a href="/admin/boosts">🚀 Бусты</a>
      <a href="/admin/inactive">😴 Неактивные</a>
      <a href="/admin/leaderboard">🏆 Лидерборд</a>
      <a href="/admin/logout" class="logout">🚪 Выйти</a>
    </nav>` : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;color:#1d1d1f;min-height:100vh}
  .sidebar{position:fixed;top:0;left:0;width:220px;height:100vh;background:#1c1c1e;padding:0;display:flex;flex-direction:column}
  .sidebar .logo{padding:24px 20px;font-size:17px;font-weight:700;color:#fff;border-bottom:1px solid #333}
  .sidebar a{display:block;padding:12px 20px;color:#ebebf5cc;text-decoration:none;font-size:14px;transition:all .15s}
  .sidebar a:hover{background:#2c2c2e;color:#fff}
  .sidebar .logout{margin-top:auto;color:#ff6b6b!important}
  .main{margin-left:220px;padding:32px}
  h1{font-size:24px;font-weight:700;margin-bottom:24px}
  h2{font-size:18px;font-weight:600;margin-bottom:12px}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:32px}
  .stat-card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .stat-card.blue{background:#1c6ef2;color:#fff}
  .stat-card.green{background:#28a745;color:#fff}
  .stat-card.orange{background:#fd7e14;color:#fff}
  .stat-num{font-size:36px;font-weight:800;line-height:1}
  .stat-label{font-size:13px;opacity:.75;margin-top:6px}
  table{width:100%;background:#fff;border-radius:12px;border-collapse:collapse;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;margin-bottom:16px}
  th{background:#f5f5f7;padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#888;letter-spacing:.5px}
  td{padding:12px 16px;border-top:1px solid #f0f0f0;font-size:14px;vertical-align:middle}
  tr:hover td{background:#fafafa}
  tr.banned td{opacity:.5}
  code{font-size:12px;background:#f5f5f7;padding:2px 6px;border-radius:4px}
  small{color:#888;font-size:12px}
  a{color:#1c6ef2;text-decoration:none}
  a:hover{text-decoration:underline}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
  .badge.success{background:#d4edda;color:#155724}
  .badge.danger{background:#f8d7da;color:#721c24}
  .btn{display:inline-block;padding:9px 18px;background:#1c6ef2;color:#fff!important;border:none;border-radius:9px;cursor:pointer;text-decoration:none!important;font-size:14px;font-weight:500;transition:opacity .2s}
  .btn:hover{opacity:.85}
  .btn.orange{background:#fd7e14}
  .btn.btn-outline{background:#fff;color:#1c6ef2!important;border:1px solid #1c6ef2}
  .btn-sm{padding:5px 12px;font-size:12px;border-radius:7px;border:none;cursor:pointer;background:#e5e5ea;color:#333;transition:all .2s}
  .btn-sm:hover{background:#d5d5da}
  .btn-sm.danger{background:#f8d7da;color:#721c24}
  .btn-sm.success{background:#d4edda;color:#155724}
  .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap}
  .toolbar input,.toolbar select{padding:9px 12px;border:1px solid #ddd;border-radius:9px;font-size:14px}
  .toolbar input{min-width:260px}
  .pagination{display:flex;gap:12px;align-items:center;margin-top:16px}
  .quick-links{display:flex;gap:10px;flex-wrap:wrap}
  .login-box{max-width:360px;margin:100px auto;background:#fff;border-radius:18px;padding:40px;box-shadow:0 4px 32px rgba(0,0,0,.12);text-align:center}
  .login-logo{font-size:48px;margin-bottom:12px}
  .login-box h2{margin-bottom:24px;font-size:20px}
  .login-box input{width:100%;padding:12px;border:1px solid #ddd;border-radius:9px;font-size:15px;margin-bottom:12px}
  .login-box button{width:100%;padding:13px;background:#1c6ef2;color:#fff;border:none;border-radius:9px;font-size:15px;font-weight:600;cursor:pointer}
  .error{color:#e53e3e;margin-top:8px;font-size:14px}
</style>
</head>
<body>
${nav}
<div class="${title !== 'Вход' ? 'main' : ''}">${content}</div>
</body>
</html>`;
}

app.listen(PORT, () => console.log(`Admin: http://localhost:${PORT}/admin`));
module.exports = app;
