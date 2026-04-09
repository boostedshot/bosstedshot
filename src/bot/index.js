require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const db = require('../db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

// ─── Session ──────────────────────────────────────────────────────────────────
bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  return next();
});

// ─── User middleware ──────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  if (!ctx.from || ctx.from.is_bot) return next();
  ctx.dbUser = await db.getOrCreateUser(ctx.from);
  if (ctx.dbUser.is_banned) return ctx.reply('Your account has been banned.');
  return next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function deleteMsg(ctx, msgId) {
  if (!msgId) return;
  try { await ctx.telegram.deleteMessage(ctx.chat.id, msgId); } catch {}
}

async function sendStatus(ctx, text, extra = {}) {
  await deleteMsg(ctx, ctx.session.statusMsgId);
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  ctx.session.statusMsgId = msg.message_id;
  return msg;
}

// ─── Main menu ────────────────────────────────────────────────────────────────
function mainMenu() {
  return Markup.keyboard([['Publish new shot']]).resize();
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const user = ctx.dbUser;
  await deleteMsg(ctx, ctx.session.statusMsgId);

  if (!user.dribbble_url) {
    ctx.session.waitingFor = 'onboarding_dribbble_url';
    const msg = await ctx.reply(
      'Hi! 👋 Send me your Dribbble profile link to get started.\n\n_Example: https://dribbble.com/username_\n\n*Requirements:* 5+ shots, account 3+ months old',
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
    ctx.session.statusMsgId = msg.message_id;
    return;
  }

  await sendStatus(ctx, 'Welcome back! 🏀 Ready to boost your shot?', mainMenu());
});

// ─── Admin reply ──────────────────────────────────────────────────────────────
bot.command('reply', async (ctx) => {
  if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
  const parts = ctx.message.text.split(' ');
  const targetId = parts[1];
  const text = parts.slice(2).join(' ');
  if (!targetId || !text) return ctx.reply('Usage: /reply USER_ID message');
  try {
    await bot.telegram.sendMessage(targetId, `📩 *Admin:* ${text}`, { parse_mode: 'Markdown' });
    await ctx.reply('✅ Sent');
  } catch (e) {
    await ctx.reply('Failed: ' + e.message);
  }
});

module.exports = { bot, mainMenu, sendStatus, deleteMsg };
