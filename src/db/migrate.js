require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        username VARCHAR(255),
        first_name VARCHAR(255),
        dribbble_url VARCHAR(500),
        credits INTEGER DEFAULT 0,
        subscription VARCHAR(20) DEFAULT 'free',
        subscription_expires_at TIMESTAMPTZ,
        is_banned BOOLEAN DEFAULT false,
        tasks_created_today INTEGER DEFAULT 0,
        last_task_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        creator_id BIGINT REFERENCES users(id),
        dribbble_url VARCHAR(500) NOT NULL,
        task_type VARCHAR(20) NOT NULL CHECK (task_type IN ('like', 'comment', 'follow')),
        comment_text VARCHAR(500),
        credits_reward INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
        max_completions INTEGER DEFAULT 50,
        current_completions INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
      );

      CREATE TABLE IF NOT EXISTS task_completions (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id),
        user_id BIGINT REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
        completed_at TIMESTAMPTZ DEFAULT NOW(),
        verified_at TIMESTAMPTZ,
        UNIQUE(task_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(id),
        plan VARCHAR(20) NOT NULL,
        amount INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'telegram_stars'
      );

      CREATE TABLE IF NOT EXISTS admin_log (
        id SERIAL PRIMARY KEY,
        admin_id BIGINT,
        action VARCHAR(100),
        target_user_id BIGINT,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
      CREATE INDEX IF NOT EXISTS idx_completions_user ON task_completions(user_id);
      CREATE INDEX IF NOT EXISTS idx_completions_task ON task_completions(task_id);
    `);

    await client.query('COMMIT');
    console.log('✅ Database migrated successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
