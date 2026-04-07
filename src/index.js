require('dotenv').config();
const { bot } = require('./bot/index');
const { registerBoostHandlers } = require('./bot/boost');
const { registerTextHandlers } = require('./bot/textHandlers');
const cron = require('node-cron');
const db = require('./db');

// Register handlers
registerBoostHandlers(bot);
registerTextHandlers(bot); // must be last

// ─── Cron: сброс дневного лимита бустов в полночь ────────────────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('[CRON] New day — boost limits reset');
  } catch (err) {
    console.error('[CRON] Error:', err.message);
  }
});

// ─── Error handling ───────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Bot error [${ctx.updateType}]:`, err.message);
  ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.').catch(() => {});
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch(
  { allowedUpdates: ['message', 'callback_query'] },
  () => {
    process.stderr.write(`🤖 DribbbleBoost started! @${bot.botInfo?.username}\n`);
  }
).catch(err => {
  process.stderr.write(`Failed to start: ${err.message}\n`);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
