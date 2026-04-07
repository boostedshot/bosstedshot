const { Markup } = require('telegraf');
const db = require('../db');
const { PLANS, isSubscriptionActive } = require('../services/subscriptions');

function registerSubscriptionHandlers(bot) {
  // Show plans
  bot.hears('💎 Подписка', showPlans);
  bot.action('show_plans', async (ctx) => {
    await ctx.answerCbQuery();
    await showPlans(ctx);
  });

  // Select plan
  Object.keys(PLANS).filter(p => p !== 'free').forEach(plan => {
    bot.action(`subscribe_${plan}`, async (ctx) => {
      await ctx.answerCbQuery();
      const planInfo = PLANS[plan];
      
      await ctx.replyWithMarkdown(
        `💎 *${planInfo.emoji} ${planInfo.name}*\n\n` +
        `${planInfo.description}\n\n` +
        `💰 Стоимость: *${planInfo.priceFmt} / месяц*\n\n` +
        `Подтвердите оплату через Telegram Stars:`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`✅ Оплатить ${planInfo.priceFmt}`, `pay_${plan}`)],
          [Markup.button.callback('◀️ Назад', 'show_plans')],
        ])
      );
    });

    // Payment (mock for MVP - replace with real Telegram Stars/Stripe)
    bot.action(`pay_${plan}`, async (ctx) => {
      await ctx.answerCbQuery('⏳ Обрабатываем...');
      const user = ctx.dbUser;
      const planInfo = PLANS[plan];

      try {
        // MVP: mock payment success
        // Production: use ctx.replyWithInvoice() for Telegram Stars
        const expiresAt = await db.activateSubscription(user.id, plan, 1);
        
        // Add monthly credits
        await db.addCredits(user.id, planInfo.monthlyCredits);

        const expDate = new Date(expiresAt).toLocaleDateString('ru-RU');
        
        await ctx.replyWithMarkdown(
          `🎉 *Подписка активирована!*\n\n` +
          `${planInfo.emoji} Тариф: *${planInfo.name}*\n` +
          `📅 Действует до: *${expDate}*\n` +
          `💰 Начислено: *+${planInfo.monthlyCredits} кредитов*\n\n` +
          `Теперь вам доступны все функции тарифа ${planInfo.name}!`
        );
      } catch (err) {
        console.error('Payment error:', err);
        await ctx.reply('❌ Ошибка оплаты. Попробуйте позже или обратитесь в поддержку.');
      }
    });
  });
}

async function showPlans(ctx) {
  const user = ctx.dbUser;
  const currentPlan = PLANS[user.subscription] || PLANS.free;
  const active = isSubscriptionActive(user);

  let statusText = `📦 *Текущий тариф:* ${currentPlan.emoji} ${currentPlan.name}`;
  if (user.subscription !== 'free' && user.subscription_expires_at) {
    const exp = new Date(user.subscription_expires_at).toLocaleDateString('ru-RU');
    statusText += active ? ` _(до ${exp})_` : ` ⚠️ _истёк ${exp}_`;
  }

  const planRows = Object.entries(PLANS)
    .filter(([key]) => key !== 'free')
    .map(([key, p]) => {
      const isCurrent = user.subscription === key && active;
      const label = isCurrent
        ? `✅ ${p.emoji} ${p.name} (активен)`
        : `${p.emoji} ${p.name} — ${p.priceFmt}/мес`;
      return [Markup.button.callback(label, isCurrent ? 'noop' : `subscribe_${key}`)];
    });

  await ctx.replyWithMarkdown(
    `💎 *Тарифные планы*\n\n` +
    statusText + '\n\n' +
    Object.entries(PLANS).filter(([k]) => k !== 'free').map(([, p]) =>
      `${p.emoji} *${p.name}* — ${p.priceFmt}/мес\n${p.description}`
    ).join('\n\n'),
    Markup.inlineKeyboard(planRows)
  );
}

module.exports = { registerSubscriptionHandlers };
