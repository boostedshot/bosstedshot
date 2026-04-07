require('dotenv').config();
const { bot } = require('./bot/index');
const { registerTaskHandlers } = require('./bot/tasks');
const { registerSubscriptionHandlers } = require('./bot/subscriptions');
const { registerTextHandlers, registerConfirmHandler } = require('./bot/textHandlers');
const cron = require('node-cron');
const db = require('./db');

// Register all handlers
registerTaskHandlers(bot);
registerSubscriptionHandlers(bot);
registerConfirmHandler(bot);
registerTextHandlers(bot); // must be last (catches all text)

// No-op action (for already subscribed buttons)
bot.action('noop', (ctx) => ctx.answerCbQuery());

// ─── Cron: notify users about pending tasks every 30 min ─────────────────────
cron.schedule('*/30 * * * *', async () => {
  try {
    const { rows: activeTasks } = await db.query(
      `SELECT COUNT(*) as count FROM tasks WHERE status = 'active' AND expires_at > NOW()`
    );
    
    if (activeTasks[0].count > 0) {
      const { rows: users } = await db.query(
        `SELECT id FROM users 
         WHERE is_banned = false 
           AND subscription != 'free'
           AND id IN (
             SELECT DISTINCT creator_id FROM tasks WHERE status = 'active'
               INTERSECT
             SELECT id FROM users WHERE credits > 0
           )
         LIMIT 100`
      );
      
      console.log(`[CRON] ${activeTasks[0].count} active tasks, notifying ${users.length} eligible users`);
    }
  } catch (err) {
    console.error('[CRON] Error:', err.message);
  }
});

// ─── Cron: reset daily task counts at midnight ────────────────────────────────
cron.schedule('0 0 * * *', async () => {
  await db.query(`UPDATE users SET tasks_created_today = 0, last_task_date = NULL`);
  console.log('[CRON] Daily task counts reset');
});

// ─── Cron: expire old tasks ───────────────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  const { rowCount } = await db.query(
    `UPDATE tasks SET status = 'completed' 
     WHERE status = 'active' AND expires_at < NOW()`
  );
  if (rowCount > 0) console.log(`[CRON] Expired ${rowCount} tasks`);
});

// ─── Error handling ───────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}:`, err);
  ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.').catch(() => {});
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch({
  allowedUpdates: ['message', 'callback_query'],
}).then(() => {
  console.log('🤖 DribbbleBoost Bot started!');
  console.log(`Bot: @${bot.botInfo?.username}`);
}).catch(err => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
