const { Markup } = require('telegraf');
const db = require('../db');
const { deleteMsg, sendStatus, mainMenu } = require('./index');

async function handleBoost(ctx) {
  const user = ctx.dbUser;

  await deleteMsg(ctx, ctx.message.message_id);
  await deleteMsg(ctx, ctx.session.statusMsgId);

  const todayBoost = await db.getTodayBoost(user.id);
  if (todayBoost) {
    return sendStatus(ctx, '⏳ You already boosted today. Come back tomorrow!');
  }

  const msg = await ctx.reply(
    `🚀 Broadcast your profile to all users?\n\n${user.dribbble_url}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Publish', 'confirm_boost')],
        [Markup.button.callback('Cancel', 'cancel_boost')],
      ]),
    }
  );
  ctx.session.statusMsgId = msg.message_id;
}

async function sendBoostToAll(ctx, bot) {
  const user = ctx.dbUser;

  await ctx.answerCbQuery('Broadcasting...');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await deleteMsg(ctx, ctx.session.statusMsgId);
  ctx.session.statusMsgId = null;

  await db.createBoost(user.id, user.dribbble_url);

  const users = await db.getAllUsersExcept(user.id);

  const text = `🔔 New publication\n\n[Open publication here](${user.dribbble_url})`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Put like', `liked_${user.id}`)],
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
    } catch {
      failed++;
    }
  }

  const resultMsg = await ctx.reply(
    `✅ Boost sent!\n\n` +
    `Delivered: *${sent}* users` +
    (failed > 0 ? `\nFailed: ${failed}` : '') +
    `\n\n_Next boost available tomorrow_`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
  ctx.session.statusMsgId = resultMsg.message_id;
}

function registerBoostHandlers(bot) {
  bot.hears('Publish new shot', handleBoost);

  bot.action('confirm_boost', async (ctx) => {
    await sendBoostToAll(ctx, bot);
  });

  bot.action('cancel_boost', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await deleteMsg(ctx, ctx.session.statusMsgId);
    ctx.session.statusMsgId = null;
    await ctx.reply('Cancelled.', mainMenu());
  });

  // "Put like" button — marks task as done for that user
  bot.action(/^liked_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery('');
      await ctx.editMessageText('✅ Task completed successfully', {
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.answerCbQuery('Already marked!');
    }
  });
}

module.exports = { registerBoostHandlers };
