const PLANS = {
  free: {
    name: 'Free',
    emoji: '🆓',
    price: 0,
    priceFmt: 'Бесплатно',
    taskTypes: ['like'],
    dailyTaskLimit: 1,
    monthlyCredits: 50,
    description: '1 задание/день, только лайки, 50 кредитов/мес',
  },
  basic: {
    name: 'Basic',
    emoji: '📦',
    price: 299,
    priceFmt: '299 ⭐',
    taskTypes: ['like', 'comment'],
    dailyTaskLimit: 5,
    monthlyCredits: 300,
    description: '5 заданий/день, лайки и комментарии, 300 кредитов/мес',
  },
  pro: {
    name: 'Pro',
    emoji: '💎',
    price: 799,
    priceFmt: '799 ⭐',
    taskTypes: ['like', 'comment', 'follow'],
    dailyTaskLimit: 30,
    monthlyCredits: 1000,
    description: '30 заданий/день, все типы, 1000 кредитов/мес',
  },
  agency: {
    name: 'Agency',
    emoji: '🚀',
    price: 1999,
    priceFmt: '1999 ⭐',
    taskTypes: ['like', 'comment', 'follow'],
    dailyTaskLimit: 100,
    monthlyCredits: 5000,
    description: '100 заданий/день, все типы, 5000 кредитов/мес',
  },
  max: {
    name: 'Max',
    emoji: '👑',
    price: 0,
    priceFmt: 'Специальный',
    taskTypes: ['like', 'comment', 'follow'],
    dailyTaskLimit: 999999,
    monthlyCredits: 999999,
    description: 'Без ограничений — все типы, неограниченные задания и кредиты',
  },
};

const TASK_COSTS = {
  like: 20,
  comment: 40,
  follow: 30,
};

const CREDITS_REWARD = {
  like: 5,
  comment: 10,
  follow: 8,
};

const TASK_TYPE_LABELS = {
  like: '❤️ Лайк',
  comment: '💬 Комментарий',
  follow: '👤 Подписка',
};

function isSubscriptionActive(user) {
  if (user.subscription === 'free') return true;
  if (!user.subscription_expires_at) return false;
  return new Date(user.subscription_expires_at) > new Date();
}

function canCreateTask(user, taskType) {
  const active = isSubscriptionActive(user);
  const plan = active ? (PLANS[user.subscription] || PLANS.free) : PLANS.free;

  if (!plan.taskTypes.includes(taskType)) {
    return { allowed: false, reason: `Тип "${TASK_TYPE_LABELS[taskType]}" недоступен на тарифе ${plan.name}. Улучшите тариф.` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const lastDate = user.last_task_date
    ? new Date(user.last_task_date).toISOString().slice(0, 10)
    : null;
  const todayCount = lastDate === today ? (user.tasks_created_today || 0) : 0;

  if (todayCount >= plan.dailyTaskLimit) {
    return {
      allowed: false,
      reason: `Достигнут дневной лимит (${plan.dailyTaskLimit} заданий/день на тарифе ${plan.name})`,
    };
  }

  const cost = TASK_COSTS[taskType];
  if (user.credits < cost) {
    return {
      allowed: false,
      reason: `Недостаточно кредитов. Нужно ${cost}, у вас ${user.credits}`,
    };
  }

  return { allowed: true, cost };
}

module.exports = { PLANS, TASK_COSTS, CREDITS_REWARD, TASK_TYPE_LABELS, isSubscriptionActive, canCreateTask };
