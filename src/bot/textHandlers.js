const { Markup } = require('telegraf');
const db = require('../db');
const { normalizeDribbbleUrl, isProfileUrl, verifyDribbbleProfile } = require('../services/dribbble');

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

function registerTextHandlers(bot) {
  bot.on('text', async (ctx, next) => {
    if (!ctx.dbUser) return next();
    const user = ctx.dbUser;
    const text = ctx.message.text;
    const waiting = ctx.session?.waitingFor;

    // ── Отмена ────────────────────────────────────────────────────────
    if (text === '❌ Отмена') {
      ctx.session.waitingFor = null;
      ctx.session.pendingBoostShot = null;
      const { mainMenu } = require('./index');
      return ctx.reply('Отменено.', mainMenu());
    }

    if (!waiting) return next();

    // ── Онбординг ─────────────────────────────────────────────────────
    if (waiting === 'onboarding_dribbble_url') {
      const url = normalizeDribbbleUrl(text.trim());
      if (!url || !isProfileUrl(url)) {
        return ctx.reply('❌ Нужна ссылка на профиль: https://dribbble.com/username');
      }

      await ctx.reply('🔍 Проверяю ваш профиль... Подождите ~10 секунд.');
      const result = await verifyDribbbleProfile(url);

      if (!result.valid) {
        return ctx.replyWithMarkdown(
          `❌ *Профиль не прошёл проверку*\n\n_${result.reason}_\n\n` +
          `Убедитесь что:\n• Минимум 5 работ в портфолио\n• Аккаунт создан 3+ месяца назад\n• Профиль публичный`
        );
      }

      await db.updateUser(user.id, { dribbble_url: url });
      ctx.session.waitingFor = null;

      const { mainMenu } = require('./index');
      return ctx.replyWithMarkdown(
        `✅ *Профиль подтверждён!*\n\n` +
        `🏀 ${url}\n` +
        (result.shotCount ? `🎨 Работ найдено: ${result.shotCount}\n\n` : '\n') +
        `Добро пожаловать! Теперь можешь делать буст своих шотов.`,
        mainMenu()
      );
    }

    // ── Смена Dribbble URL ────────────────────────────────────────────
    if (waiting === 'dribbble_url') {
      const url = normalizeDribbbleUrl(text.trim());
      if (!url || !isProfileUrl(url)) {
        return ctx.reply('❌ Нужна ссылка на профиль: https://dribbble.com/username');
      }

      await ctx.reply('🔍 Проверяю профиль...');
      const result = await verifyDribbbleProfile(url);

      if (!result.valid) {
        return ctx.replyWithMarkdown(`❌ *Профиль не прошёл проверку*\n\n_${result.reason}_`);
      }

      await db.updateUser(user.id, { dribbble_url: url });
      ctx.session.waitingFor = null;

      const { mainMenu } = require('./index');
      return ctx.replyWithMarkdown(`✅ Dribbble профиль обновлён!\n🏀 ${url}`, mainMenu());
    }

    // ── Сообщение админу ─────────────────────────────────────────────
    if (waiting === 'admin_message') {
      ctx.session.waitingFor = null;

      // Форвардим админам
      const userInfo = `👤 @${user.username || '—'} (${user.first_name || ''}) ID: \`${user.id}\``;
      const adminMsg = `📩 *Сообщение от пользователя*\n\n${userInfo}\n\n_${text}_\n\nОтветить: /reply ${user.id} текст`;

      let delivered = false;
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(adminId, adminMsg, { parse_mode: 'Markdown' });
          delivered = true;
        } catch (e) {}
      }

      const { mainMenu } = require('./index');
      if (delivered) {
        return ctx.replyWithMarkdown(
          `✅ *Сообщение отправлено!*\n\nМы ответим вам в ближайшее время.`,
          mainMenu()
        );
      } else {
        return ctx.replyWithMarkdown(
          `⚠️ Сообщение принято, но администратор временно недоступен.`,
          mainMenu()
        );
      }
    }

    return next();
  });
}

module.exports = { registerTextHandlers };
