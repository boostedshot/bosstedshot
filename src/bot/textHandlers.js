const { Markup } = require('telegraf');
const db = require('../db');
const { normalizeDribbbleUrl, isDribbbleUrl, isShotUrl, isProfileUrl, verifyDribbbleProfile } = require('../services/dribbble');
const { TASK_COSTS, CREDITS_REWARD, TASK_TYPE_LABELS, PLANS } = require('../services/subscriptions');

function registerTextHandlers(bot) {
  bot.on('text', async (ctx, next) => {
    const user = ctx.dbUser;
    const text = ctx.message.text;
    const waiting = ctx.session?.waitingFor;

    if (!waiting) return next();

    // ── Онбординг: первый ввод Dribbble профиля ──────────────────────
    if (waiting === 'onboarding_dribbble_url') {
      const url = normalizeDribbbleUrl(text.trim());

      if (!url || !isProfileUrl(url)) {
        return ctx.reply('❌ Нужна ссылка на профиль: https://dribbble.com/username');
      }

      await ctx.reply('🔍 Проверяю ваш профиль... Подождите немного.');

      const result = await verifyDribbbleProfile(url);

      if (!result.valid) {
        return ctx.replyWithMarkdown(
          `❌ *Профиль не прошёл проверку*\n\n` +
          `_${result.reason}_\n\n` +
          `Попробуйте другой профиль или убедитесь что:\n` +
          `• В портфолио не менее 5 работ\n` +
          `• Аккаунт зарегистрирован 3+ месяца назад\n` +
          `• Профиль публичный`
        );
      }

      await db.updateUser(user.id, { dribbble_url: url });
      ctx.session.waitingFor = null;

      const { mainMenu } = require('./index');
      const plan = PLANS[user.subscription] || PLANS.free;
      return ctx.replyWithMarkdown(
        `✅ *Профиль подтверждён!*\n\n` +
        `🏀 ${url}\n` +
        (result.shotCount ? `🎨 Работ: ${result.shotCount}\n` : '') +
        `\n💳 Баланс: *${user.credits} кредитов*\n` +
        `📦 Тариф: ${plan.emoji} *${plan.name}*\n\n` +
        `Добро пожаловать в DribbbleBoost!`,
        mainMenu()
      );
    }

    // ── Смена Dribbble profile URL (из профиля) ───────────────────────
    if (waiting === 'dribbble_url') {
      const url = normalizeDribbbleUrl(text.trim());

      if (!url || !isProfileUrl(url)) {
        return ctx.reply('❌ Неверная ссылка. Отправьте ссылку вида https://dribbble.com/username');
      }

      await ctx.reply('🔍 Проверяю профиль...');
      const result = await verifyDribbbleProfile(url);

      if (!result.valid) {
        return ctx.replyWithMarkdown(
          `❌ *Профиль не прошёл проверку*\n\n_${result.reason}_`
        );
      }

      await db.updateUser(user.id, { dribbble_url: url });
      ctx.session.waitingFor = null;

      const { mainMenu } = require('./index');
      return ctx.replyWithMarkdown(
        `✅ Dribbble профиль обновлён!\n🏀 ${url}`,
        mainMenu()
      );
    }

    // ── Task creation: URL step ──────────────────────────────────────
    if (waiting === 'task_url') {
      const url = normalizeDribbbleUrl(text.trim());
      const taskType = ctx.session.newTask?.type;

      if (!url || !isDribbbleUrl(url)) {
        return ctx.reply('❌ Неверная ссылка на Dribbble. Попробуйте ещё раз.');
      }

      if (taskType === 'follow' && !isProfileUrl(url)) {
        return ctx.reply('❌ Для задания "Подписка" нужна ссылка на профиль (https://dribbble.com/username)');
      }

      if (taskType === 'like' && !isShotUrl(url)) {
        return ctx.reply('❌ Для задания "Лайк" нужна ссылка на шот (https://dribbble.com/shots/...)');
      }

      ctx.session.newTask.url = url;

      if (taskType === 'comment') {
        ctx.session.waitingFor = 'task_comment';
        return ctx.reply(
          '💬 Введите текст комментария, который должны написать другие пользователи:\n\n' +
          '_Пример: "Amazing work! Love the color palette 🎨"_',
          { parse_mode: 'Markdown' }
        );
      }

      // Like or follow — go straight to confirm
      ctx.session.waitingFor = null;
      return confirmTask(ctx, url, taskType, null);
    }

    // ── Task creation: comment text step ────────────────────────────
    if (waiting === 'task_comment') {
      const commentText = text.trim();
      
      if (commentText.length < 5) {
        return ctx.reply('❌ Комментарий слишком короткий. Минимум 5 символов.');
      }

      if (commentText.length > 300) {
        return ctx.reply('❌ Комментарий слишком длинный. Максимум 300 символов.');
      }

      ctx.session.newTask.comment = commentText;
      ctx.session.waitingFor = null;

      return confirmTask(ctx, ctx.session.newTask.url, 'comment', commentText);
    }

    return next();
  });
}

async function confirmTask(ctx, url, taskType, commentText) {
  const user = ctx.dbUser;
  const cost = TASK_COSTS[taskType];
  const reward = CREDITS_REWARD[taskType];
  const label = TASK_TYPE_LABELS[taskType];

  const text =
    `✅ *Подтвердите создание задания*\n\n` +
    `Тип: ${label}\n` +
    `Ссылка: ${url}\n` +
    (commentText ? `Комментарий: _"${commentText}"_\n` : '') +
    `\nСтоимость: *${cost} кредитов*\n` +
    `Ваш баланс: *${user.credits}* → *${user.credits - cost}*\n` +
    `Вознаграждение за выполнение: *${reward} кредитов* каждому`;

  const { mainMenu } = require('./index');

  await ctx.replyWithMarkdown(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Создать задание', `confirm_task_create`)],
      [Markup.button.callback('❌ Отмена', 'cancel_task')],
    ])
  );

  // Store for confirmation
  ctx.session.pendingTask = { url, taskType, commentText, cost };
}

function registerConfirmHandler(bot) {
  bot.action('confirm_task_create', async (ctx) => {
    await ctx.answerCbQuery('⏳ Создаём задание...');
    
    const user = ctx.dbUser;
    const pending = ctx.session.pendingTask;

    if (!pending) {
      return ctx.reply('❌ Что-то пошло не так. Начните заново.');
    }

    if (user.credits < pending.cost) {
      return ctx.reply('❌ Недостаточно кредитов для создания задания.');
    }

    try {
      // Deduct credits
      await db.addCredits(user.id, -pending.cost);

      // Create task
      const task = await db.createTask(
        user.id,
        pending.url,
        pending.taskType,
        pending.commentText,
        CREDITS_REWARD[pending.taskType]
      );

      // Update daily task count
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = user.last_task_date?.toISOString?.()?.slice(0, 10);
      const count = lastDate === today ? (user.tasks_created_today || 0) + 1 : 1;
      await db.updateUser(user.id, {
        tasks_created_today: count,
        last_task_date: new Date(),
      });

      ctx.session.pendingTask = null;

      const { mainMenu } = require('./index');
      await ctx.replyWithMarkdown(
        `🎉 *Задание создано!*\n\n` +
        `ID: #${task.id}\n` +
        `Тип: ${TASK_TYPE_LABELS[pending.taskType]}\n` +
        `Ссылка: ${pending.url}\n\n` +
        `Другие пользователи уже получают уведомление 📢\n` +
        `Следите за выполнением в разделе "📊 Мои задания"`,
        mainMenu()
      );

    } catch (err) {
      console.error('Task creation error:', err);
      await ctx.reply('❌ Ошибка создания задания. Попробуйте позже.');
    }
  });
}

module.exports = { registerTextHandlers, registerConfirmHandler };
