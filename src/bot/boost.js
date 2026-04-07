const { Markup } = require('telegraf');
const db = require('../db');
const { getLatestShot, isProfileUrl, normalizeDribbbleUrl } = require('../services/dribbble');

async function handleBoost(ctx) {
  const user = ctx.dbUser;

  // Проверяем лимит — 1 буст в день
  const todayBoost = await db.getTodayBoost(user.id);
  if (todayBoost) {
    return ctx.replyWithMarkdown(
      `⏳ *Вы уже сделали буст сегодня*\n\n` +
      `Буст доступен 1 раз в день. Приходите завтра!`
    );
  }

  // Берём последний шот из RSS
  await ctx.reply('🔍 Загружаю ваш последний шот...');
  const shot = await getLatestShot(user.dribbble_url);

  if (!shot) {
    return ctx.replyWithMarkdown(
      `❌ *Не удалось загрузить шоты*\n\n` +
      `Убедитесь что ваш профиль публичный и есть хотя бы один шот.`
    );
  }

  ctx.session.pendingBoostShot = shot;

  const text =
    `🏀 *Последний шот найден:*\n\n` +
    `*${shot.title}*\n` +
    `${shot.url}\n\n` +
    `Разослать всем пользователям?`;

  await ctx.replyWithMarkdown(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Да, разослать!', 'confirm_boost')],
      [Markup.button.callback('❌ Отмена', 'cancel_boost')],
    ])
  );
}

async function sendBoostToAll(ctx, bot) {
  const user = ctx.dbUser;
  const shot = ctx.session.pendingBoostShot;

  if (!shot) return ctx.reply('❌ Что-то пошло не так, попробуйте ещё раз.');

  await ctx.answerCbQuery('🚀 Рассылаем...');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Сохраняем буст
  await db.createBoost(user.id, shot.url);
  ctx.session.pendingBoostShot = null;

  // Получаем всех пользователей
  const users = await db.getAllUsersExcept(user.id);

  const caption =
    `🎨 *Новая работа от @${shot.username}*\n\n` +
    `*${shot.title}*\n\n` +
    `❤️ Поставьте лайк последней работе\n` +
    `⭐ По желанию: добавьте в избранное\n` +
    `💬 По желанию: напишите комментарий\n\n` +
    `👉 [Открыть профиль](${user.dribbble_url})`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('🏀 Открыть профиль на Dribbble', user.dribbble_url)],
  ]);

  let sent = 0;
  let failed = 0;

  for (const u of users) {
    try {
      if (shot.image) {
        await bot.telegram.sendPhoto(u.id, shot.image, {
          caption,
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } else {
        await bot.telegram.sendMessage(u.id, caption, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
      sent++;
      // Небольшая задержка чтобы не получить flood limit
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
    ctx.session.pendingBoostShot = null;
    await ctx.answerCbQuery('Отменено');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply('Отменено.');
  });
}

module.exports = { registerBoostHandlers };
