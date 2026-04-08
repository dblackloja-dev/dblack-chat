const { Pool } = require('pg');
require('dotenv').config();

const connString = process.env.DATABASE_URL || process.env.NEON_URL || process.env.DB_URL;
const pool = new Pool({
  connectionString: connString,
  ssl: connString && !connString.includes('localhost') ? { rejectUnauthorized: false } : false,
});

const queryAll = async (text, params = []) => (await pool.query(text, params)).rows;
const queryOne = async (text, params = []) => ((await pool.query(text, params)).rows)[0] || null;
const queryRun = async (text, params = []) => pool.query(text, params);

async function initDB() {
  await pool.query(`
    -- Usuários do chat (admin e atendentes)
    CREATE TABLE IF NOT EXISTS chat_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'atendente',
      active BOOLEAN DEFAULT true,
      avatar TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Conversas (cada cliente que manda msg cria uma conversa)
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      customer_push_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'aguardando',
      agent_id TEXT,
      agent_name TEXT,
      unread_count INTEGER DEFAULT 0,
      last_message TEXT DEFAULT '',
      last_message_at TIMESTAMP DEFAULT NOW(),
      started_at TIMESTAMP DEFAULT NOW(),
      accepted_at TIMESTAMP,
      finished_at TIMESTAMP,
      finished_by TEXT
    );

    -- Mensagens individuais
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      from_me BOOLEAN DEFAULT false,
      sender TEXT DEFAULT '',
      content TEXT NOT NULL,
      media_type TEXT,
      media_url TEXT,
      timestamp TIMESTAMP DEFAULT NOW()
    );
  `);

  // Cria admin padrão se não existir
  const admin = await queryOne("SELECT id FROM chat_users WHERE role = 'admin' LIMIT 1");
  if (!admin) {
    const id = 'adm_' + Date.now().toString(36);
    await queryRun(
      "INSERT INTO chat_users (id, name, email, password, role, avatar) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, 'Denilson', 'admin@dblack.com', 'admin123', 'admin', 'DN']
    );
    console.log('👤 Admin padrão criado: admin@dblack.com / admin123');
  }

  console.log('✅ D\'Black Chat — Banco inicializado!');
}

module.exports = { queryAll, queryOne, queryRun, initDB, pool };
