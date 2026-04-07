const { Markup } = require('telegraf');
const db = require('../db');

async function handleBoost(ctx) {
  const user = ctx.dbUser;

  // Проверяем лимит — 1 буст в день
  const todayBoost = await db.getTodayBoost(user.id);
  if (todayBoost) {
    return ctx.replyWithMarkdown(
      `⏳ *Вы уже сделали буст сегодня*\n\nБуст доступен 1 раз в день. Приходите завтра!`
    );
  }

  await ctx.replyWithMarkdown(
    `🚀 *Разослать буст?*\n\n` +
    `Все пользователи получат ссылку на ваш профиль:\n${user.dribbble_url}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Да, разослать!', 'confirm_boost')],
      [Markup.button.callback('❌ Отмена', 'cancel_boost')],
    ])
  );
}

async function sendBoostToAll(ctx, bot) {
  const user = ctx.dbUser;

  await ctx.answerCbQuery('🚀 Рассылаем...');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Сохраняем буст
  await db.createBoost(user.id, user.dribbble_url);

  // Получаем всех пользователей
  const users = await db.getAllUsersExcept(user.id);

  const name = user.first_name || user.username || 'Дизайнер';
  const text =
    `🏀 *${name}* делится своим профилем на Dribbble!\n\n` +
    `Откройте профиль и поставьте лайк на последний шот 🙏\n\n` +
    `⭐ По желанию: добавьте в избранное\n` +
    `💬 По желанию: напишите комментарий`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('🏀 Открыть профиль', user.dribbble_url)],
  ]);

  let sent = 0;
  let failed = 0;

  for (const u of users) {
    try {
      await bot.telegram.sendMessage(u.id, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
      sent++;
      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      failed++;
    }
  }

  await ctx.replyWithMarkdown(
    `✅ *Буст отправлен!*\n\n` +
    `📨 Получили: *${sent}* пользователей\n` +
    (failed > 0 ? `⚠️ Не доставлено: ${failed}\n` : '') +
    `\n_Следующий буст доступен завтра_`
  );
}

function registerBoostHandlers(bot) {
  bot.hears('🚀 Буст шота', handleBoost);

  bot.action('confirm_boost', async (ctx) => {
    await sendBoostToAll(ctx, bot);
  });

  bot.action('cancel_boost', async (ctx) => {
    await ctx.answerCbQuery('Отменено');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply('Отменено.');
  });
}

module.exports = { registerBoostHandlers };
