const { Pool } = require('pg');
require('dotenv').config();

const connString = process.env.DATABASE_URL || process.env.NEON_URL || process.env.DB_URL;
const pool = new Pool({
  connectionString: connString,
  ssl: connString && !connString.includes('localhost') ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Retry automático em caso de erro de conexão
async function queryWithRetry(text, params = [], retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      if (i === retries || !e.message.includes('Connection terminated')) throw e;
      console.log(`⚠️ Query retry ${i + 1}/${retries}:`, e.message);
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

const queryAll = async (text, params = []) => (await queryWithRetry(text, params)).rows;
const queryOne = async (text, params = []) => ((await queryWithRetry(text, params)).rows)[0] || null;
const queryRun = async (text, params = []) => queryWithRetry(text, params);

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

    -- Respostas rápidas editáveis
    CREATE TABLE IF NOT EXISTS quick_replies (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      category TEXT DEFAULT 'geral',
      sort_order INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Configurações do sistema
    CREATE TABLE IF NOT EXISTS chat_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Configuração dos agentes de IA
    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled BOOLEAN DEFAULT false,
      personality TEXT DEFAULT '',
      instructions TEXT DEFAULT '',
      knowledge_base TEXT DEFAULT '',
      auto_reply BOOLEAN DEFAULT false,
      max_wait_seconds INTEGER DEFAULT 60,
      created_at TIMESTAMP DEFAULT NOW()
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

    -- Tags de conversas
    CREATE TABLE IF NOT EXISTS conversation_tags (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      color TEXT DEFAULT '#00a884',
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Métricas da IA
    CREATE TABLE IF NOT EXISTS ai_metrics (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      resolved_by_ai BOOLEAN DEFAULT false,
      transferred BOOLEAN DEFAULT false,
      messages_by_ai INTEGER DEFAULT 0,
      response_time_ms INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Conexões WhatsApp (multi-número)
    CREATE TABLE IF NOT EXISTS wa_connections (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      name TEXT DEFAULT '',
      active BOOLEAN DEFAULT true,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Adiciona colunas novas se não existirem
  try { await queryRun("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT ''"); } catch {}
  try { await queryRun("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to TEXT"); } catch {}
  try { await queryRun("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_handled BOOLEAN DEFAULT false"); } catch {}

  // Insere respostas rápidas padrão se tabela vazia
  const qrCount = await queryOne("SELECT COUNT(*) as c FROM quick_replies");
  if (parseInt(qrCount.c) === 0) {
    const defaults = [
      ['qr1', '👋 Saudação', 'Olá! Tudo bem? Como posso te ajudar?', 'atendimento', 1],
      ['qr2', '⏰ Horário', '⏰ Nosso horário de atendimento:\nSeg a Sex: 9h às 18h\nSábado: 9h às 13h', 'info', 2],
      ['qr3', '📍 Endereço', '📍 Nossas lojas:\n🏪 D\'Black Divino-MG\n🏪 D\'Black São João-MG\n🏪 D\'Black Matriz - Ribeirão de São Domingos-MG', 'info', 3],
      ['qr4', '💳 Pagamento', '💳 Formas de pagamento:\n✅ PIX\n✅ Cartão de Crédito (até 6x)\n✅ Cartão de Débito\n✅ Dinheiro\n✅ Crediário', 'info', 4],
      ['qr5', '📦 Frete', '📦 Enviamos para todo o Brasil!\nFrete calculado no momento da compra.', 'info', 5],
      ['qr6', '🔄 Troca', '🔄 Política de troca:\nVocê tem até 7 dias para trocar.\nProduto deve estar com etiqueta e sem uso.', 'info', 6],
      ['qr7', '✅ Obrigado', 'Muito obrigado pela preferência! 🖤\nQualquer dúvida, estamos à disposição.\nSiga @d_blackloja no Instagram! 📱', 'atendimento', 7],
      ['qr8', '⏳ Aguarde', 'Um momento, por favor! Já estou verificando para você. ⏳', 'atendimento', 8],
    ];
    for (const [id, label, text, cat, order] of defaults) {
      await queryRun("INSERT INTO quick_replies (id, label, text, category, sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, label, text, cat, order]);
    }
    console.log('📝 Respostas rápidas padrão criadas');
  }

  // Insere configurações padrão se tabela vazia
  const settingsCount = await queryOne("SELECT COUNT(*) as c FROM chat_settings");
  if (parseInt(settingsCount.c) === 0) {
    const greeting = `Olá! 👋 Seja bem-vindo(a) à *D'Black Store*! 🖤\n\nAgradecemos sua mensagem! Um de nossos atendentes vai te responder em breve.\n\n⏰ *Horário de atendimento:*\nSeg a Sex: 9h às 18h\nSábado: 9h às 13h\n\nEnquanto isso, confira nossas novidades no Instagram: @d_blackloja 📱`;
    await queryRun("INSERT INTO chat_settings (key, value) VALUES ('greeting_enabled', 'true') ON CONFLICT DO NOTHING");
    await queryRun("INSERT INTO chat_settings (key, value) VALUES ('greeting_text', $1) ON CONFLICT DO NOTHING", [greeting]);
    await queryRun("INSERT INTO chat_settings (key, value) VALUES ('company_name', 'D''Black Store') ON CONFLICT DO NOTHING");
    await queryRun("INSERT INTO chat_settings (key, value) VALUES ('company_instagram', '@d_blackloja') ON CONFLICT DO NOTHING");
    await queryRun("INSERT INTO chat_settings (key, value) VALUES ('business_hours', 'Seg a Sex: 9h às 18h | Sábado: 9h às 13h') ON CONFLICT DO NOTHING");
    console.log('⚙️ Configurações padrão criadas');
  }

  console.log('✅ D\'Black Chat — Banco inicializado!');
}

module.exports = { queryAll, queryOne, queryRun, initDB, pool };
