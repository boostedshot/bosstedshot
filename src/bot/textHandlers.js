const db = require('../db');
const { normalizeDribbbleUrl, isProfileUrl, verifyDribbbleProfile } = require('../services/dribbble');
const { deleteMsg, sendStatus, mainMenu } = require('./index');

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

function registerTextHandlers(bot) {
  bot.on('text', async (ctx, next) => {
    if (!ctx.dbUser) return next();
    const user = ctx.dbUser;
    const text = ctx.message.text;
    const waiting = ctx.session?.waitingFor;

    // ── Cancel ────────────────────────────────────────────────────────
    if (text === 'Cancel') {
      await deleteMsg(ctx, ctx.message.message_id);
      ctx.session.waitingFor = null;
      return sendStatus(ctx, 'Cancelled.', mainMenu());
    }

    if (!waiting) return next();

    // Delete user's input message to keep chat clean
    await deleteMsg(ctx, ctx.message.message_id);

    // ── Onboarding: Dribbble URL ──────────────────────────────────────
    if (waiting === 'onboarding_dribbble_url') {
      const url = normalizeDribbbleUrl(text.trim());
      if (!url || !isProfileUrl(url)) {
        return sendStatus(ctx, '❌ Please send a valid profile link: https://dribbble.com/username');
      }

      await sendStatus(ctx, '🔍 Checking your profile...');
      const result = await verifyDribbbleProfile(url);

      if (!result.valid) {
        return sendStatus(
          ctx,
          `❌ Profile check failed\n\n_${result.reason}_\n\nRequirements:\n• 5+ shots in portfolio\n• Account 3+ months old\n• Public profile`,
          { parse_mode: 'Markdown' }
        );
      }

      await db.updateUser(user.id, { dribbble_url: url });
      ctx.session.waitingFor = null;

      return sendStatus(
        ctx,
        `✅ Profile verified!\n\n${url}` +
        (result.shotCount ? `\n_${result.shotCount} shots found_` : '') +
        `\n\nWelcome! Use *Publish new shot* to boost your profile.`,
        { parse_mode: 'Markdown', ...mainMenu() }
      );
    }

    // ── Change Dribbble URL ───────────────────────────────────────────
    if (waiting === 'dribbble_url') {
      const url = normalizeDribbbleUrl(text.trim());
      if (!url || !isProfileUrl(url)) {
        return sendStatus(ctx, '❌ Please send a valid profile link: https://dribbble.com/username');
      }

      await sendStatus(ctx, '🔍 Checking profile...');
      const result = await verifyDribbbleProfile(url);

      if (!result.valid) {
        return sendStatus(ctx, `❌ Profile check failed\n\n_${result.reason}_`, { parse_mode: 'Markdown' });
      }

      await db.updateUser(user.id, { dribbble_url: url });
      ctx.session.waitingFor = null;

      return sendStatus(ctx, `✅ Dribbble profile updated!\n${url}`, mainMenu());
    }

    // ── Message to admin ──────────────────────────────────────────────
    if (waiting === 'admin_message') {
      ctx.session.waitingFor = null;

      const userInfo = `👤 @${user.username || '—'} (${user.first_name || ''}) ID: \`${user.id}\``;
      const adminMsg = `📩 *Message from user*\n\n${userInfo}\n\n_${text}_\n\nReply: /reply ${user.id} your text`;

      let delivered = false;
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(adminId, adminMsg, { parse_mode: 'Markdown' });
          delivered = true;
        } catch {}
      }

      return sendStatus(
        ctx,
        delivered
          ? '✅ Message sent! We will reply soon.'
          : '⚠️ Message received, but admin is unavailable.',
        mainMenu()
      );
    }

    return next();
  });
}

module.exports = { registerTextHandlers };
