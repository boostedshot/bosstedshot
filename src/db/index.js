require('dotenv').config();
const axios = require('axios');

const BASE = process.env.SUPABASE_URL + '/rest/v1';
const KEY = process.env.SUPABASE_KEY;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

// Helpers
const get = (path, params = {}) =>
  axios.get(BASE + path, { headers, params }).then(r => r.data);

const post = (path, body, extra = {}) =>
  axios.post(BASE + path, body, { headers: { ...headers, ...extra } }).then(r => r.data);

const patch = (path, body, params = {}) =>
  axios.patch(BASE + path, body, { headers: { ...headers, Prefer: 'return=representation' }, params }).then(r => r.data);

const del = (path, params = {}) =>
  axios.delete(BASE + path, { headers, params }).then(r => r.data);

const count = async (path, params = {}) => {
  const r = await axios.get(BASE + path, {
    headers: { ...headers, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
    params,
  });
  const range = r.headers['content-range'] || '';
  return parseInt(range.split('/')[1]) || 0;
};

const db = {
  async getOrCreateUser(tgUser) {
    const rows = await post('/users', {
      id: tgUser.id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
    }, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async updateUser(userId, fields) {
    const rows = await patch('/users', fields, { id: `eq.${userId}` });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async addCredits(userId, amount) {
    const [user] = await get('/users', { id: `eq.${userId}`, select: 'credits' });
    const newCredits = (user?.credits || 0) + amount;
    const rows = await patch('/users', { credits: newCredits }, { id: `eq.${userId}` });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async getActiveTasks(userId, limit = 5) {
    const completed = await get('/task_completions', {
      user_id: `eq.${userId}`,
      select: 'task_id',
    });
    const completedIds = completed.map(c => c.task_id);

    const tasks = await get('/tasks', {
      status: 'eq.active',
      expires_at: `gt.${new Date().toISOString()}`,
      creator_id: `neq.${userId}`,
      select: '*',
      order: 'created_at.desc',
      limit: limit + completedIds.length + 20,
    });

    return tasks
      .filter(t => t.current_completions < t.max_completions)
      .filter(t => !completedIds.includes(t.id))
      .slice(0, limit);
  },

  async getUserTasks(userId) {
    const tasks = await get('/tasks', {
      creator_id: `eq.${userId}`,
      select: '*',
      order: 'created_at.desc',
      limit: 20,
    });
    if (!tasks.length) return [];

    const taskIds = tasks.map(t => t.id).join(',');
    const completions = await get('/task_completions', {
      status: 'eq.verified',
      task_id: `in.(${taskIds})`,
      select: 'task_id',
    });

    const counts = {};
    completions.forEach(c => { counts[c.task_id] = (counts[c.task_id] || 0) + 1; });

    return tasks.map(t => ({ ...t, verified_count: counts[t.id] || 0 }));
  },

  async createTask(creatorId, dribbbleUrl, taskType, commentText, creditsReward) {
    const rows = await post('/tasks', {
      creator_id: creatorId,
      dribbble_url: dribbbleUrl,
      task_type: taskType,
      comment_text: commentText || null,
      credits_reward: creditsReward,
    }, { Prefer: 'return=representation' });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async completeTask(taskId, userId) {
    const existing = await get('/task_completions', {
      task_id: `eq.${taskId}`,
      user_id: `eq.${userId}`,
      select: 'id',
    });
    if (existing.length > 0) throw new Error('Already completed');

    let row;
    try {
      const rows = await post('/task_completions', { task_id: taskId, user_id: userId }, { Prefer: 'return=representation' });
      row = Array.isArray(rows) ? rows[0] : rows;
    } catch (err) {
      if (err.response?.status === 409) throw new Error('Already completed');
      throw err;
    }

    const [task] = await get('/tasks', { id: `eq.${taskId}`, select: 'current_completions' });
    await patch('/tasks', { current_completions: (task?.current_completions || 0) + 1 }, { id: `eq.${taskId}` });

    return row;
  },

  async verifyCompletion(taskId, userId, reward) {
    await patch('/task_completions', {
      status: 'verified',
      verified_at: new Date().toISOString(),
    }, { task_id: `eq.${taskId}`, user_id: `eq.${userId}` });
    await db.addCredits(userId, reward);
  },

  async activateSubscription(userId, plan, months) {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await post('/subscriptions', {
      user_id: userId, plan, amount: 0, expires_at: expiresAt.toISOString(),
    }, { Prefer: 'return=minimal' });

    await patch('/users', {
      subscription: plan,
      subscription_expires_at: expiresAt.toISOString(),
    }, { id: `eq.${userId}` });

    return expiresAt;
  },

  async getStats() {
    const [total, paid, active, allTasks, completions, newToday] = await Promise.all([
      count('/users'),
      count('/users', { subscription: 'neq.free' }),
      count('/tasks', { status: 'eq.active' }),
      count('/tasks'),
      count('/task_completions', { status: 'eq.verified' }),
      count('/users', { created_at: `gt.${new Date(Date.now() - 86400000).toISOString()}` }),
    ]);
    return {
      total_users: total,
      paid_users: paid,
      active_tasks: active,
      total_tasks: allTasks,
      total_completions: completions,
      new_users_today: newToday,
    };
  },

  async getAllUsers(limit, offset, search) {
    const params = { select: '*', order: 'created_at.desc', limit, offset };
    if (search) {
      const numId = parseInt(search);
      params.or = numId
        ? `username.ilike.%${search}%,first_name.ilike.%${search}%,id.eq.${numId}`
        : `username.ilike.%${search}%,first_name.ilike.%${search}%`;
    }
    return get('/users', params);
  },

  async getTasksWithUsers(limit = 50) {
    const tasks = await get('/tasks', {
      select: '*,users(username,first_name)',
      order: 'created_at.desc',
      limit,
    });

    const taskIds = tasks.map(t => t.id).join(',');
    if (!taskIds) return [];

    const completions = await get('/task_completions', {
      status: 'eq.verified',
      task_id: `in.(${taskIds})`,
      select: 'task_id',
    });

    const counts = {};
    completions.forEach(c => { counts[c.task_id] = (counts[c.task_id] || 0) + 1; });

    return tasks.map(t => ({
      ...t,
      username: t.users?.username,
      first_name: t.users?.first_name,
      verified: counts[t.id] || 0,
    }));
  },

  async getSubscriptionsWithUsers(limit = 100) {
    const subs = await get('/subscriptions', {
      select: '*,users(username,first_name)',
      order: 'started_at.desc',
      limit,
    });
    return subs.map(s => ({
      ...s,
      username: s.users?.username,
      first_name: s.users?.first_name,
    }));
  },

  async getTaskById(taskId) {
    const rows = await get('/tasks', { id: `eq.${taskId}`, select: '*' });
    return rows[0] || null;
  },

  async updateTaskStatus(taskId, status) {
    await patch('/tasks', { status }, { id: `eq.${taskId}` });
  },

  async resetDailyTaskCounts() {
    await patch('/users', { tasks_created_today: 0, last_task_date: null }, { tasks_created_today: 'gte.0' });
  },

  async expireOldTasks() {
    const rows = await patch('/tasks', { status: 'completed' }, {
      status: 'eq.active',
      expires_at: `lt.${new Date().toISOString()}`,
    });
    return Array.isArray(rows) ? rows.length : 0;
  },

  async getActiveTaskCount() {
    return count('/tasks', {
      status: 'eq.active',
      expires_at: `gt.${new Date().toISOString()}`,
    });
  },

  async getCompletionCount(userId) {
    return count('/task_completions', {
      user_id: `eq.${userId}`,
      status: 'eq.verified',
    });
  },

  // Все верифицированные пользователи кроме заданного
  async getAllUsersExcept(excludeId) {
    const rows = await get('/users', {
      select: 'id,username,first_name',
      is_banned: 'eq.false',
      dribbble_url: 'not.is.null',
    });
    return (rows || []).filter(u => u.id !== excludeId);
  },

  // Проверить делал ли пользователь буст сегодня
  async getTodayBoost(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await get('/boosts', {
      user_id: `eq.${userId}`,
      date: `eq.${today}`,
      select: 'id',
    });
    return rows.length > 0 ? rows[0] : null;
  },

  async createBoost(userId, shotUrl) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await post('/boosts', {
      user_id: userId,
      shot_url: shotUrl,
      date: today,
    }, { Prefer: 'return=representation' });
    return Array.isArray(rows) ? rows[0] : rows;
  },
};

module.exports = db;
