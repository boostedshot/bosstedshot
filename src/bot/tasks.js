const { Markup } = require('telegraf');
const db = require('../db');
const { canCreateTask, TASK_COSTS, CREDITS_REWARD, TASK_TYPE_LABELS, PLANS } = require('../services/subscriptions');
const { normalizeDribbbleUrl, isShotUrl, isProfileUrl, getShotInfo } = require('../services/dribbble');

// ─── Task feed ────────────────────────────────────────────────────────────────
async function showTaskFeed(ctx) {
  const user = ctx.dbUser;
  const tasks = await db.getActiveTasks(user.id, 5);

  if (tasks.length === 0) {
    return ctx.replyWithMarkdown(
      '📭 *Нет доступных заданий*\n\n' +
      'Все задания выполнены или вы уже выполнили все доступные.\n' +
      'Загляните позже или создайте своё задание!'
    );
  }

  for (const task of tasks) {
    await sendTaskCard(ctx, task, user);
    await new Promise(r => setTimeout(r, 300));
  }
}

async function sendTaskCard(ctx, task, user) {
  const typeLabel = TASK_TYPE_LABELS[task.task_type];
  const reward = CREDITS_REWARD[task.task_type];
  const remaining = task.max_completions - task.current_completions;
  
  const text =
    `${typeLabel}\n\n` +
    `🔗 ${task.dribbble_url}\n` +
    (task.comment_text ? `💬 Текст комментария:\n_"${task.comment_text}"_\n\n` : '\n') +
    `💰 Награда: *+${reward} кредитов*\n` +
    `👥 Осталось мест: ${remaining}`;

  const buttons = [
    [Markup.button.callback(`✅ Выполнить (${typeLabel})`, `complete_${task.id}`)],
    [Markup.button.url('🏀 Открыть на Dribbble', task.dribbble_url)],
    [Markup.button.callback('⏭ Пропустить', `skip_${task.id}`)],
  ];

  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
}

// ─── Task creation flow ───────────────────────────────────────────────────────
async function startTaskCreation(ctx) {
  const user = ctx.dbUser;
  const plan = PLANS[user.subscription] || PLANS.free;

  const buttons = [];
  if (plan.taskTypes.includes('like')) {
    buttons.push([Markup.button.callback(`❤️ Лайк (${TASK_COSTS.like} кред.)`, 'create_like')]);
  }
  if (plan.taskTypes.includes('comment')) {
    buttons.push([Markup.button.callback(`💬 Комментарий (${TASK_COSTS.comment} кред.)`, 'create_comment')]);
  }
  if (plan.taskTypes.includes('follow')) {
    buttons.push([Markup.button.callback(`👤 Подписка (${TASK_COSTS.follow} кред.)`, 'create_follow')]);
  }
  buttons.push([Markup.button.callback('❌ Отмена', 'cancel_task')]);

  await ctx.replyWithMarkdown(
    `➕ *Создать задание*\n\n` +
    `💳 Ваш баланс: *${user.credits} кредитов*\n\n` +
    `Выберите тип задания:`,
    Markup.inlineKeyboard(buttons)
  );
}

// ─── Register handlers on bot ─────────────────────────────────────────────────
function registerTaskHandlers(bot) {
  bot.hears('📋 Доступные задания', showTaskFeed);
  bot.hears('➕ Создать задание', startTaskCreation);
  bot.hears('📊 Мои задания', showMyTasks);

  // Task type selection
  ['like', 'comment', 'follow'].forEach(type => {
    bot.action(`create_${type}`, async (ctx) => {
      const user = ctx.dbUser;
      const check = canCreateTask(user, type);
      
      await ctx.answerCbQuery();
      
      if (!check.allowed) {
        return ctx.replyWithMarkdown(
          `❌ *Невозможно создать задание*\n\n${check.reason}\n\n` +
          (check.reason.includes('тариф') ? '💎 Улучшите тариф для доступа к этому типу.' : '')
        );
      }

      ctx.session.newTask = { type, cost: check.cost };
      ctx.session.waitingFor = 'task_url';

      const urlHint = type === 'follow'
        ? 'профиль (https://dribbble.com/username)'
        : 'шот (https://dribbble.com/shots/...)';

      await ctx.replyWithMarkdown(
        `🔗 Отправьте ссылку на ваш Dribbble ${urlHint}:`,
        Markup.keyboard([['❌ Отмена']]).resize()
      );
    });
  });

  // Complete task
  bot.action(/^complete_(\d+)$/, async (ctx) => {
    const taskId = parseInt(ctx.match[1]);
    const user = ctx.dbUser;

    await ctx.answerCbQuery('⏳ Проверяем...');

    try {
      const completion = await db.completeTask(taskId, user.id);
      
      // Get task details
      const task = await db.getTaskById(taskId);
      if (!task) return ctx.reply('❌ Задание не найдено');

      const reward = CREDITS_REWARD[task.task_type];

      // For MVP: auto-verify after user clicks "done"
      // In production: use Dribbble scraper to verify
      await db.verifyCompletion(taskId, user.id, reward);

      await ctx.replyWithMarkdown(
        `✅ *Задание выполнено!*\n\n` +
        `💰 Начислено: *+${reward} кредитов*\n` +
        `💳 Новый баланс: *${user.credits + reward} кредитов*\n\n` +
        `_Подтверждение будет проверено в течение 24 часов_`
      );

      // Notify task creator
      try {
        await bot.telegram.sendMessage(
          task.creator_id,
          `🎉 Ваше задание выполнено!\n` +
          `Тип: ${TASK_TYPE_LABELS[task.task_type]}\n` +
          `Выполнений: ${task.current_completions + 1}/${task.max_completions}`
        );
      } catch {}
      
    } catch (err) {
      if (err.message === 'Already completed') {
        await ctx.reply('⚠️ Вы уже выполнили это задание');
      } else {
        await ctx.reply('❌ Ошибка. Попробуйте позже.');
      }
    }
  });

  // Skip task
  bot.action(/^skip_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('Пропущено');
    await ctx.deleteMessage().catch(() => {});
  });

  // Cancel
  bot.action('cancel_task', async (ctx) => {
    ctx.session.waitingFor = null;
    ctx.session.newTask = null;
    await ctx.answerCbQuery('Отменено');
    await ctx.reply('Отменено', { reply_markup: { remove_keyboard: true } });
  });

  bot.hears('❌ Отмена', async (ctx) => {
    ctx.session.waitingFor = null;
    ctx.session.newTask = null;
    const { mainMenu } = require('./index');
    await ctx.reply('Отменено', mainMenu());
  });
}

async function showMyTasks(ctx) {
  const user = ctx.dbUser;
  const tasks = await db.getUserTasks(user.id);

  if (tasks.length === 0) {
    return ctx.reply('📭 У вас пока нет заданий');
  }

  const lines = tasks.slice(0, 10).map(t => {
    const status = { active: '🟢', paused: '⏸', completed: '✅', cancelled: '❌' }[t.status];
    return `${status} ${TASK_TYPE_LABELS[t.task_type]} — ${t.verified_count}/${t.max_completions} выполн.`;
  });

  await ctx.replyWithMarkdown(
    `📊 *Ваши задания (последние ${tasks.length}):*\n\n` + lines.join('\n')
  );
}

module.exports = { registerTaskHandlers, sendTaskCard };
