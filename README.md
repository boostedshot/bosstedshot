# 🏀 DribbbleBoost — Telegram Bot

Платформа взаимного продвижения для Dribbble. Пользователи создают задания (лайк, комментарий, подписка), другие выполняют их и получают кредиты.

## Структура проекта

```
dribbble-bot/
├── src/
│   ├── index.js              # Точка входа бота
│   ├── db/
│   │   ├── index.js          # Все SQL-запросы
│   │   └── migrate.js        # Создание таблиц БД
│   ├── bot/
│   │   ├── index.js          # /start, профиль, меню
│   │   ├── tasks.js          # Лента и создание заданий
│   │   ├── subscriptions.js  # Тарифы и оплата
│   │   └── textHandlers.js   # Обработка ввода URL
│   └── services/
│       ├── dribbble.js       # Парсер Dribbble
│       └── subscriptions.js  # Тарифы, лимиты, кредиты
└── admin/
    └── server.js             # Веб-панель администратора
```

## Быстрый старт

### 1. Установка зависимостей
```bash
npm install
```

### 2. Настройка окружения
```bash
cp .env.example .env
# Редактируйте .env под ваши данные
```

### 3. Создание бота в Telegram
1. Напишите [@BotFather](https://t.me/BotFather) → `/newbot`
2. Получите `BOT_TOKEN` и вставьте в `.env`

### 4. База данных (PostgreSQL)
```bash
# Создать БД
createdb dribbble_bot

# Запустить миграции
npm run migrate
```

### 5. Запуск

**Бот:**
```bash
npm run dev      # разработка (с автоперезапуском)
npm start        # продакшен
```

**Админ-панель:**
```bash
npm run admin    # http://localhost:3001/admin
```

## Переменные окружения

| Переменная | Описание |
|---|---|
| `BOT_TOKEN` | Токен Telegram бота |
| `DATABASE_URL` | Строка подключения PostgreSQL |
| `ADMIN_SECRET` | Пароль для входа в админ-панель |
| `SESSION_SECRET` | Секрет для сессий Express |
| `ADMIN_IDS` | Telegram ID администраторов (через запятую) |
| `ADMIN_PORT` | Порт админ-панели (по умолчанию 3001) |

## Тарифные планы

| План | Цена | Заданий/день | Типы | Кредиты/мес |
|---|---|---|---|---|
| Free | 0 | 1 | лайк | 50 |
| Basic | 299 ⭐ | 5 | лайк, комментарий | 300 |
| Pro | 799 ⭐ | 30 | все | 1000 |
| Agency | 1999 ⭐ | 100 | все | 5000 |

## Система кредитов

**Стоимость заданий:**
- Лайк: 20 кредитов
- Комментарий: 40 кредитов  
- Подписка: 30 кредитов

**Награда за выполнение:**
- Лайк: 5 кредитов
- Комментарий: 10 кредитов
- Подписка: 8 кредитов

## Деплой

### Render.com / Railway
1. Создайте PostgreSQL базу данных
2. Деплойте репозиторий
3. Установите переменные окружения
4. Добавьте build command: `npm install && npm run migrate`
5. Start command: `npm start`

### VPS (Ubuntu)
```bash
# Установить Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установить PM2
npm install -g pm2

# Запустить бота
pm2 start src/index.js --name dribbble-bot
pm2 start admin/server.js --name dribbble-admin

# Сохранить процессы
pm2 save
pm2 startup
```

## Следующие шаги (после MVP)

- [ ] Реальная оплата через Telegram Stars (`ctx.replyWithInvoice`)
- [ ] Верификация через Dribbble API (или OAuth)
- [ ] Push-уведомления о новых заданиях
- [ ] Реферальная система
- [ ] Несколько аккаунтов Dribbble (Agency план)
- [ ] Аналитика для пользователей
- [ ] Anti-fraud система (проверка IP, fingerprint)
