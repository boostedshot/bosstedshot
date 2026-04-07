require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const db = require('../db');
const { PLANS, isSubscriptionActive } = require('../services/subscriptions');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── Session middleware ───────────────────────────────────────────────────────
bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  return next();
});

// ─── User middleware: load/create user from DB ────────────────────────────────
bot.use(async (ctx, next) => {
  if (!ctx.from || ctx.from.is_bot) return next();

  ctx.dbUser = await db.getOrCreateUser(ctx.from);

  if (ctx.dbUser.is_banned) {
    return ctx.reply('🚫 Ваш аккаунт заблокирован. Обратитесь в поддержку.');
  }

  return next();
});

// ─── Main keyboard ────────────────────────────────────────────────────────────
function mainMenu() {
  return Markup.keyboard([
    ['📋 Доступные задания', '➕ Создать задание'],
    ['📊 Мои задания', '💎 Подписка'],
    ['👤 Профиль'],
  ]).resize();
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const user = ctx.dbUser;

  // Онбординг: если Dribbble профиль ещё не подтверждён
  if (!user.dribbble_url) {
    ctx.session.waitingFor = 'onboarding_dribbble_url';
    return ctx.replyWithMarkdown(
      `🏀 *Добро пожаловать в DribbbleBoost!*\n\n` +
      `Платформа взаимного продвижения на Dribbble.\n\n` +
      `Для начала нужно подтвердить ваш профиль Dribbble.\n` +
      `Пришлите ссылку на ваш профиль:\n\n` +
      `_Например: https://dribbble.com/username_\n\n` +
      `⚠️ *Требования к аккаунту:*\n` +
      `• Минимум 5 работ в портфолио\n` +
      `• Аккаунт зарегистрирован не менее 3 месяцев назад`,
      Markup.removeKeyboard()
    );
  }

  // Уже онбордингован — показываем меню
  const plan = PLANS[user.subscription] || PLANS.free;
  await ctx.replyWithMarkdown(
    `🏀 *DribbbleBoost*\n\n` +
    `💳 Баланс: *${user.credits} кредитов*\n` +
    `📦 Тариф: ${plan.emoji} *${plan.name}*`,
    mainMenu()
  );
});

// ─── Profile ──────────────────────────────────────────────────────────────────
bot.hears('👤 Профиль', async (ctx) => {
  const user = ctx.dbUser;
  const plan = PLANS[user.subscription] || PLANS.free;
  const active = isSubscriptionActive(user);

  let subText = `${plan.emoji} ${plan.name}`;
  if (user.subscription !== 'free' && user.subscription_expires_at) {
    const exp = new Date(user.subscription_expires_at).toLocaleDateString('ru-RU');
    subText += active ? ` _(до ${exp})_` : ` ⚠️ _истёк ${exp}_`;
  }

  const completions = await db.getCompletionCount(user.id);
  const count = completions;

  await ctx.replyWithMarkdown(
    `👤 *Ваш профиль*\n\n` +
    `👋 ${user.first_name || 'Пользователь'}` +
    (user.username ? ` (@${user.username})` : '') + `\n` +
    `🆔 ID: \`${user.id}\`\n` +
    `💳 Баланс: *${user.credits} кредитов*\n` +
    `📦 Тариф: ${subText}\n` +
    `✅ Выполнено заданий: *${count}*\n` +
    (user.dribbble_url
      ? `🏀 Dribbble: ${user.dribbble_url}\n`
      : `🏀 Dribbble: _не указан_\n`) +
    `\n_Зарегистрирован: ${new Date(user.created_at).toLocaleDateString('ru-RU')}_`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔗 Изменить Dribbble URL', 'set_dribbble_url')],
    ])
  );
});

bot.action('set_dribbble_url', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.waitingFor = 'dribbble_url';
  await ctx.reply(
    '🔗 Отправьте ссылку на ваш профиль Dribbble:\n\n_Например: https://dribbble.com/username_',
    { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
  );
});

module.exports = { bot, mainMenu };
