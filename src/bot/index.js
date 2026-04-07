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
  if (ctx.dbUser.is_banned) {
    return ctx.reply('🚫 Ваш аккаунт заблокирован. Обратитесь в поддержку.');
  }
  return next();
});

// ─── Главное меню ─────────────────────────────────────────────────────────────
function mainMenu() {
  return Markup.keyboard([
    ['🚀 Буст шота'],
    ['💬 Чат с админом'],
  ]).resize();
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const user = ctx.dbUser;

  if (!user.dribbble_url) {
    ctx.session.waitingFor = 'onboarding_dribbble_url';
    return ctx.replyWithMarkdown(
      `🏀 *Добро пожаловать в DribbbleBoost!*\n\n` +
      `Здесь дизайнеры помогают друг другу расти на Dribbble.\n\n` +
      `Для начала пришлите ссылку на ваш профиль:\n` +
      `_Например: https://dribbble.com/username_\n\n` +
      `⚠️ *Требования:*\n` +
      `• Минимум 5 работ в портфолио\n` +
      `• Аккаунт создан не менее 3 месяцев назад`,
      Markup.removeKeyboard()
    );
  }

  await ctx.replyWithMarkdown(
    `🏀 *DribbbleBoost*\n\n` +
    `Привет, ${user.first_name || 'дизайнер'}!\n\n` +
    `Нажми *Буст шота* — и твою последнюю работу увидят все участники.`,
    mainMenu()
  );
});

// ─── Профиль (смена URL) ──────────────────────────────────────────────────────
bot.action('set_dribbble_url', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.waitingFor = 'dribbble_url';
  await ctx.reply(
    '🔗 Отправьте новую ссылку на профиль Dribbble:',
    { reply_markup: { remove_keyboard: true } }
  );
});

// ─── Чат с админом ───────────────────────────────────────────────────────────
bot.hears('💬 Чат с админом', async (ctx) => {
  const user = ctx.dbUser;
  ctx.session.waitingFor = 'admin_message';
  await ctx.replyWithMarkdown(
    `💬 *Напишите сообщение для администратора*\n\n` +
    `Опишите ваш вопрос или проблему — мы ответим как можно скорее.`,
    Markup.keyboard([['❌ Отмена']]).resize()
  );
});

// ─── Ответ админа пользователю (/reply ID текст) ─────────────────────────────
bot.command('reply', async (ctx) => {
  if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
  const parts = ctx.message.text.split(' ');
  const targetId = parts[1];
  const text = parts.slice(2).join(' ');
  if (!targetId || !text) return ctx.reply('Формат: /reply USER_ID текст');
  try {
    await bot.telegram.sendMessage(targetId, `📩 *Ответ от администратора:*\n\n${text}`, { parse_mode: 'Markdown' });
    await ctx.reply('✅ Сообщение отправлено');
  } catch (e) {
    await ctx.reply('❌ Не удалось отправить: ' + e.message);
  }
});

module.exports = { bot, mainMenu };
