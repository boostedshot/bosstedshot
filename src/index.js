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
    const count = await db.getActiveTaskCount();
    if (count > 0) console.log(`[CRON] ${count} active tasks available`);
  } catch (err) {
    console.error('[CRON] Error:', err.message);
  }
});

// ─── Cron: reset daily task counts at midnight ────────────────────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    await db.resetDailyTaskCounts();
    console.log('[CRON] Daily task counts reset');
  } catch (err) {
    console.error('[CRON] Reset error:', err.message);
  }
});

// ─── Cron: expire old tasks ───────────────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  try {
    const count = await db.expireOldTasks();
    if (count > 0) console.log(`[CRON] Expired ${count} tasks`);
  } catch (err) {
    console.error('[CRON] Expire error:', err.message);
  }
});

// ─── Error handling ───────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}:`, err);
  ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.').catch(() => {});
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch(
  { allowedUpdates: ['message', 'callback_query'] },
  () => {
    // This callback fires right after getMe(), before polling starts
    process.stderr.write(`🤖 DribbbleBoost Bot started! @${bot.botInfo?.username}\n`);
  }
).catch(err => {
  process.stderr.write(`Failed to start bot: ${err.message}\n`);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
