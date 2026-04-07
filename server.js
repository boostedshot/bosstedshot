require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('../src/db');
const { PLANS, TASK_TYPE_LABELS } = require('../src/services/subscriptions');

const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
};

// ─── Login ────────────────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  res.send(renderPage('Вход', `
    <div class="login-box">
      <h2>🔐 Панель управления</h2>
      <form method="POST" action="/admin/login">
        <input type="password" name="secret" placeholder="Секретный ключ" required>
        <button type="submit">Войти</button>
      </form>
      ${req.query.err ? '<p class="error">Неверный ключ</p>' : ''}
    </div>
  `));
});

app.post('/admin/login', (req, res) => {
  if (req.body.secret === ADMIN_SECRET) {
    req.session.admin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?err=1');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/admin', requireAuth, async (req, res) => {
  const stats = await db.getStats();
  
  res.send(renderPage('Dashboard', `
    <h1>📊 Dashboard</h1>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-num">${stats.total_users}</div>
        <div class="stat-label">Всего пользователей</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-num">${stats.paid_users}</div>
        <div class="stat-label">Платных подписок</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.active_tasks}</div>
        <div class="stat-label">Активных заданий</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.total_completions}</div>
        <div class="stat-label">Выполнено заданий</div>
      </div>
      <div class="stat-card success">
        <div class="stat-num">+${stats.new_users_today}</div>
        <div class="stat-label">Новых за 24ч</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.total_tasks}</div>
        <div class="stat-label">Всего заданий</div>
      </div>
    </div>
    <div class="quick-links">
      <a href="/admin/users" class="btn">👥 Пользователи</a>
      <a href="/admin/tasks" class="btn">📋 Задания</a>
      <a href="/admin/subscriptions" class="btn">💎 Подписки</a>
    </div>
  `));
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/admin/users', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page || 1);
  const search = req.query.search || '';
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const users = await db.getAllUsers(limit, offset, search);
  
  const rows = users.map(u => {
    const subBadge = u.subscription !== 'free'
      ? `<span class="badge ${u.subscription}">${(PLANS[u.subscription]?.emoji || '')} ${u.subscription}</span>`
      : '<span class="badge free">free</span>';
    
    const banBtn = u.is_banned
      ? `<button onclick="userAction(${u.id}, 'unban')" class="btn-sm success">Разбан</button>`
      : `<button onclick="userAction(${u.id}, 'ban')" class="btn-sm danger">Бан</button>`;

    return `
      <tr>
        <td><code>${u.id}</code></td>
        <td>@${u.username || '—'} <br><small>${u.first_name || ''}</small></td>
        <td>${subBadge}</td>
        <td>${u.credits}</td>
        <td>${u.dribbble_url ? `<a href="${u.dribbble_url}" target="_blank">🏀</a>` : '—'}</td>
        <td>${new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
        <td>
          ${banBtn}
          <button onclick="showAddCredits(${u.id})" class="btn-sm">+ кред.</button>
          <button onclick="showSubModal(${u.id})" class="btn-sm accent">подписка</button>
        </td>
      </tr>
    `;
  }).join('');

  res.send(renderPage('Пользователи', `
    <h1>👥 Пользователи</h1>
    <div class="toolbar">
      <form method="GET">
        <input type="text" name="search" value="${search}" placeholder="Поиск по ID, username...">
        <button type="submit" class="btn">Найти</button>
        ${search ? '<a href="/admin/users" class="btn">✕ Сброс</a>' : ''}
      </form>
    </div>
    <table>
      <thead><tr>
        <th>ID</th><th>Пользователь</th><th>Тариф</th>
        <th>Кредиты</th><th>Dribbble</th><th>Дата</th><th>Действия</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="pagination">
      ${page > 1 ? `<a href="?page=${page-1}&search=${search}" class="btn">← Назад</a>` : ''}
      <span>Страница ${page}</span>
      ${users.length === limit ? `<a href="?page=${page+1}&search=${search}" class="btn">Далее →</a>` : ''}
    </div>

    <!-- Modals -->
    <div id="modal" class="modal" style="display:none">
      <div class="modal-box">
        <h3 id="modal-title"></h3>
        <div id="modal-body"></div>
        <button onclick="closeModal()" class="btn">Закрыть</button>
      </div>
    </div>

    <script>
    function closeModal() { document.getElementById('modal').style.display='none'; }
    
    function showAddCredits(userId) {
      document.getElementById('modal-title').textContent = 'Добавить кредиты';
      document.getElementById('modal-body').innerHTML = \`
        <input type="number" id="credits-amount" placeholder="Количество (может быть отрицательным)" style="width:100%;margin:8px 0">
        <button class="btn accent" onclick="addCredits(\${userId})">Применить</button>
      \`;
      document.getElementById('modal').style.display='flex';
    }

    function showSubModal(userId) {
      document.getElementById('modal-title').textContent = 'Изменить подписку';
      document.getElementById('modal-body').innerHTML = \`
        <select id="sub-plan" style="width:100%;margin:8px 0">
          <option value="free">Free</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="agency">Agency</option>
        </select>
        <button class="btn accent" onclick="changeSub(\${userId})">Применить</button>
      \`;
      document.getElementById('modal').style.display='flex';
    }

    async function userAction(userId, action) {
      if (!confirm('Подтвердить?')) return;
      const r = await fetch('/admin/api/users/' + userId + '/' + action, { method: 'POST' });
      const d = await r.json();
      if (d.ok) location.reload();
      else alert('Ошибка: ' + d.error);
    }

    async function addCredits(userId) {
      const amount = parseInt(document.getElementById('credits-amount').value);
      if (!amount) return alert('Введите количество');
      const r = await fetch('/admin/api/users/' + userId + '/credits', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ amount })
      });
      const d = await r.json();
      if (d.ok) location.reload();
      else alert('Ошибка: ' + d.error);
    }

    async function changeSub(userId) {
      const plan = document.getElementById('sub-plan').value;
      const r = await fetch('/admin/api/users/' + userId + '/subscription', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ plan })
      });
      const d = await r.json();
      if (d.ok) location.reload();
      else alert('Ошибка: ' + d.error);
    }
    </script>
  `));
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
app.get('/admin/tasks', requireAuth, async (req, res) => {
  const { rows: tasks } = await db.query(`
    SELECT t.*, u.username, u.first_name,
      (SELECT COUNT(*) FROM task_completions WHERE task_id = t.id AND status = 'verified') as verified
    FROM tasks t JOIN users u ON t.creator_id = u.id
    ORDER BY t.created_at DESC LIMIT 50
  `);

  const statusColors = { active: 'success', paused: '', completed: 'accent', cancelled: 'danger' };
  const rows = tasks.map(t => `
    <tr>
      <td>#${t.id}</td>
      <td><span class="badge ${statusColors[t.status]}">${t.status}</span></td>
      <td>${TASK_TYPE_LABELS[t.task_type] || t.task_type}</td>
      <td>@${t.username || t.first_name}</td>
      <td><a href="${t.dribbble_url}" target="_blank">🔗 Открыть</a></td>
      <td>${t.verified}/${t.max_completions}</td>
      <td>${new Date(t.created_at).toLocaleDateString('ru-RU')}</td>
      <td>
        ${t.status === 'active' 
          ? `<button onclick="taskAction(${t.id},'cancel')" class="btn-sm danger">Отменить</button>`
          : '—'
        }
      </td>
    </tr>
  `).join('');

  res.send(renderPage('Задания', `
    <h1>📋 Задания</h1>
    <table>
      <thead><tr>
        <th>ID</th><th>Статус</th><th>Тип</th><th>Создатель</th>
        <th>Ссылка</th><th>Выполнено</th><th>Дата</th><th>Действия</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <script>
    async function taskAction(taskId, action) {
      if (!confirm('Подтвердить?')) return;
      const r = await fetch('/admin/api/tasks/' + taskId + '/' + action, { method: 'POST' });
      const d = await r.json();
      if (d.ok) location.reload();
      else alert('Ошибка');
    }
    </script>
  `));
});

// ─── Subscriptions ────────────────────────────────────────────────────────────
app.get('/admin/subscriptions', requireAuth, async (req, res) => {
  const { rows: subs } = await db.query(`
    SELECT s.*, u.username, u.first_name
    FROM subscriptions s JOIN users u ON s.user_id = u.id
    ORDER BY s.started_at DESC LIMIT 100
  `);

  const rows = subs.map(s => `
    <tr>
      <td>@${s.username || s.first_name}</td>
      <td><span class="badge ${s.plan}">${(PLANS[s.plan]?.emoji || '')} ${s.plan}</span></td>
      <td><span class="badge ${s.status === 'active' ? 'success' : ''}">${s.status}</span></td>
      <td>${new Date(s.started_at).toLocaleDateString('ru-RU')}</td>
      <td>${new Date(s.expires_at).toLocaleDateString('ru-RU')}</td>
      <td>${s.amount} ⭐</td>
    </tr>
  `).join('');

  res.send(renderPage('Подписки', `
    <h1>💎 Подписки</h1>
    <table>
      <thead><tr>
        <th>Пользователь</th><th>Тариф</th><th>Статус</th>
        <th>Начало</th><th>Конец</th><th>Сумма</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `));
});

// ─── API endpoints ────────────────────────────────────────────────────────────
app.post('/admin/api/users/:id/ban', requireAuth, async (req, res) => {
  try {
    await db.updateUser(req.params.id, { is_banned: true });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/admin/api/users/:id/unban', requireAuth, async (req, res) => {
  try {
    await db.updateUser(req.params.id, { is_banned: false });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/admin/api/users/:id/credits', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    await db.addCredits(req.params.id, parseInt(amount));
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/admin/api/users/:id/subscription', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    if (plan === 'free') {
      await db.updateUser(req.params.id, { subscription: 'free', subscription_expires_at: null });
    } else {
      await db.activateSubscription(req.params.id, plan, 1);
    }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/admin/api/tasks/:id/cancel', requireAuth, async (req, res) => {
  try {
    await db.query(`UPDATE tasks SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ─── HTML template ────────────────────────────────────────────────────────────
function renderPage(title, content) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — DribbbleBoost Admin</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
         background: #f5f5f7; color: #1d1d1f; min-height: 100vh; }
  
  .sidebar { position: fixed; top: 0; left: 0; width: 220px; height: 100vh;
             background: #1c1c1e; padding: 24px 0; }
  .sidebar .logo { padding: 0 20px 24px; font-size: 18px; font-weight: 600;
                   color: #fff; border-bottom: 1px solid #333; }
  .sidebar a { display: block; padding: 12px 20px; color: #ebebf5cc; text-decoration: none;
               font-size: 14px; transition: all .2s; }
  .sidebar a:hover, .sidebar a.active { background: #2c2c2e; color: #fff; }
  
  .main { margin-left: 220px; padding: 32px; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 24px; }
  
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                gap: 16px; margin-bottom: 32px; }
  .stat-card { background: #fff; border-radius: 12px; padding: 20px;
               box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .stat-card.accent { background: #1c6ef2; color: #fff; }
  .stat-card.success { background: #28a745; color: #fff; }
  .stat-num { font-size: 32px; font-weight: 700; line-height: 1; }
  .stat-label { font-size: 13px; opacity: .7; margin-top: 6px; }
  
  table { width: 100%; background: #fff; border-radius: 12px; border-collapse: collapse;
          box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
  th { background: #f5f5f7; padding: 12px 16px; text-align: left; font-size: 12px;
       font-weight: 600; text-transform: uppercase; color: #666; }
  td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
  tr:hover td { background: #fafafa; }
  code { font-size: 12px; background: #f5f5f7; padding: 2px 6px; border-radius: 4px; }
  small { color: #888; font-size: 12px; }
  
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 12px;
           font-weight: 500; background: #e5e5ea; color: #666; }
  .badge.success, .badge.active { background: #d4edda; color: #155724; }
  .badge.danger, .badge.cancelled { background: #f8d7da; color: #721c24; }
  .badge.accent, .badge.completed { background: #cce5ff; color: #004085; }
  .badge.pro { background: #fff3cd; color: #856404; }
  .badge.agency { background: #e8d5f5; color: #5a2d8c; }
  .badge.basic { background: #d1ecf1; color: #0c5460; }
  
  .btn { display: inline-block; padding: 8px 16px; background: #1c6ef2; color: #fff;
         border: none; border-radius: 8px; cursor: pointer; text-decoration: none;
         font-size: 14px; transition: opacity .2s; }
  .btn:hover { opacity: .85; }
  .btn-sm { padding: 4px 10px; font-size: 12px; border-radius: 6px; border: none;
            cursor: pointer; background: #e5e5ea; color: #333; margin: 2px; transition: all .2s; }
  .btn-sm:hover { background: #d5d5da; }
  .btn-sm.danger { background: #f8d7da; color: #721c24; }
  .btn-sm.success { background: #d4edda; color: #155724; }
  .btn-sm.accent { background: #cce5ff; color: #004085; }
  
  .toolbar { display: flex; gap: 12px; margin-bottom: 20px; }
  .toolbar input { padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px;
                   font-size: 14px; min-width: 280px; }
  .toolbar form { display: flex; gap: 8px; align-items: center; }
  
  .pagination { display: flex; gap: 12px; align-items: center; margin-top: 20px; }
  .quick-links { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
  
  /* Login page */
  .login-box { max-width: 360px; margin: 120px auto; background: #fff; border-radius: 16px;
               padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,.12); text-align: center; }
  .login-box h2 { margin-bottom: 24px; }
  .login-box input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px;
                     font-size: 15px; margin-bottom: 12px; }
  .login-box button { width: 100%; padding: 12px; background: #1c6ef2; color: #fff;
                      border: none; border-radius: 8px; font-size: 15px; cursor: pointer; }
  .error { color: #e53e3e; margin-top: 8px; font-size: 14px; }
  
  /* Modal */
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex;
           align-items: center; justify-content: center; z-index: 100; }
  .modal-box { background: #fff; border-radius: 16px; padding: 32px; min-width: 340px; }
  .modal-box h3 { margin-bottom: 16px; }
  .modal-box input, .modal-box select { 
    width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px; 
    font-size: 14px; margin-bottom: 12px; }
  a { color: #1c6ef2; }
</style>
</head>
<body>
${title !== 'Вход' ? `
<nav class="sidebar">
  <div class="logo">🏀 DribbbleBoost</div>
  <a href="/admin">📊 Dashboard</a>
  <a href="/admin/users">👥 Пользователи</a>
  <a href="/admin/tasks">📋 Задания</a>
  <a href="/admin/subscriptions">💎 Подписки</a>
  <a href="/admin/logout" style="margin-top:auto;color:#ff4444">🚪 Выйти</a>
</nav>
` : ''}
<div class="${title !== 'Вход' ? 'main' : ''}">${content}</div>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`🖥 Admin panel running at http://localhost:${PORT}/admin`);
});

module.exports = app;
