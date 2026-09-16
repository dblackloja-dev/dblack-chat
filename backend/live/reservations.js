// Reservas de peças da live do Instagram (live commerce)
// Regras:
// - No máximo UMA live ativa (live_sessions.status = 'active'); sem live ativa → unknown_code.
// - Catálogo da live em live_items (código → produto do ERP, preço de live, estoque por tamanho).
// - sizes jsonb: {"P": 3, "M": 5} = estoque por tamanho; {} = peça única (1 unidade, sem tamanho).
// - Reserva vale RESERVATION_MINUTES (env, padrão 15). Expirada → estoque volta e a fila é chamada.
// - Estoque zerado → entra em live_waitlist e retorna sold_out.
// - Job a cada 60s expira reservas vencidas e promove o primeiro da fila (com DM).
const { queryAll, queryOne, queryRun, pool } = require('../database');

const RESERVATION_MINUTES = parseInt(process.env.RESERVATION_MINUTES || '15', 10);
const CHECKOUT_BASE = process.env.LIVE_CHECKOUT_URL || 'https://dblack.com.br/live';

// Notificador injetado pelo server.js (broadcast WebSocket 'live:update' pro painel do moderador)
let notify = () => {};
let expiryTimer = null;

async function initTables() {
  await queryRun(`
    CREATE TABLE IF NOT EXISTS live_sessions (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',   -- draft | active | closed
      starts_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS live_items (
      id SERIAL PRIMARY KEY,
      session_id INT REFERENCES live_sessions(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                       -- A1, A2...
      erp_product_id TEXT,
      name TEXT NOT NULL,
      live_price_cents INT NOT NULL,
      sizes JSONB NOT NULL DEFAULT '{}',
      UNIQUE (session_id, code)
    );

    CREATE TABLE IF NOT EXISTS live_reservations (
      id SERIAL PRIMARY KEY,
      token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      session_id INT REFERENCES live_sessions(id),
      item_id INT REFERENCES live_items(id),
      size TEXT,
      ig_user_id TEXT,
      ig_username TEXT,
      comment_id TEXT UNIQUE,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'reserved',  -- reserved | paid | expired | cancelled
      expires_at TIMESTAMPTZ NOT NULL,
      paid_at TIMESTAMPTZ,
      order_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_live_res_status_exp ON live_reservations (status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_live_res_item ON live_reservations (item_id, size);

    CREATE TABLE IF NOT EXISTS live_waitlist (
      id SERIAL PRIMARY KEY,
      item_id INT REFERENCES live_items(id),
      size TEXT,
      ig_user_id TEXT,
      ig_username TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_live_wait_item ON live_waitlist (item_id, size, created_at);
  `);
  console.log('🎥 Tabelas de live commerce prontas');
}

function init({ onUpdate } = {}) {
  if (onUpdate) notify = onUpdate;
  if (!expiryTimer) {
    expiryTimer = setInterval(() => expireStale().catch(e => console.error('[live] expireStale:', e.message)), 60000);
  }
}

// Unidades disponíveis de (item, size): estoque do jsonb menos reservas vivas (reservada não vencida ou paga)
async function availableUnits(client, item, size) {
  const sizes = item.sizes || {};
  const hasSizes = Object.keys(sizes).length > 0;
  const capacity = hasSizes ? parseInt(sizes[size] ?? 0, 10) : 1;
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM live_reservations
     WHERE item_id = $1 AND size IS NOT DISTINCT FROM $2
       AND (status = 'paid' OR (status = 'reserved' AND expires_at > NOW()))`,
    [item.id, size]
  );
  return capacity - rows[0].c;
}

async function reserve({ code, size, igUserId, igUsername, commentId, mediaId, source }) {
  const session = await queryOne("SELECT * FROM live_sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1");
  if (!session) return { status: 'unknown_code' };

  const item = await queryOne("SELECT * FROM live_items WHERE session_id = $1 AND UPPER(code) = $2", [session.id, code]);
  if (!item) return { status: 'unknown_code' };

  const sizes = item.sizes || {};
  const hasSizes = Object.keys(sizes).length > 0;
  if (hasSizes && (!size || !(size in sizes))) return { status: 'needs_size' };
  const finalSize = hasSizes ? size : null;

  // Idempotência: a Meta pode reenviar o mesmo comentário — devolve a reserva já criada
  if (commentId) {
    const existing = await queryOne("SELECT * FROM live_reservations WHERE comment_id = $1", [commentId]);
    if (existing) {
      return { status: 'reserved', token: existing.token, minutes: RESERVATION_MINUTES, expiresAt: existing.expires_at };
    }
  }

  // Transação com lock na peça — dois "QUERO" simultâneos não levam a mesma última unidade
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: lockRows } = await client.query('SELECT * FROM live_items WHERE id = $1 FOR UPDATE', [item.id]);
    const lockedItem = lockRows[0];

    const avail = await availableUnits(client, lockedItem, finalSize);
    if (avail <= 0) {
      await client.query(
        `INSERT INTO live_waitlist (item_id, size, ig_user_id, ig_username) VALUES ($1,$2,$3,$4)`,
        [item.id, finalSize, igUserId, igUsername]
      );
      await client.query('COMMIT');
      notify({ sessionId: session.id, itemId: item.id, event: 'waitlist' });
      return { status: 'sold_out' };
    }

    const { rows } = await client.query(
      `INSERT INTO live_reservations (session_id, item_id, size, ig_user_id, ig_username, comment_id, source, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved', NOW() + ($8 || ' minutes')::interval)
       ON CONFLICT (comment_id) DO NOTHING
       RETURNING *`,
      [session.id, item.id, finalSize, igUserId, igUsername, commentId || null, source, String(RESERVATION_MINUTES)]
    );
    await client.query('COMMIT');

    if (!rows[0]) { // comment_id repetido chegou em paralelo
      const existing = await queryOne("SELECT * FROM live_reservations WHERE comment_id = $1", [commentId]);
      return { status: 'reserved', token: existing.token, minutes: RESERVATION_MINUTES, expiresAt: existing.expires_at };
    }

    notify({ sessionId: session.id, itemId: item.id, event: 'reserved' });
    return { status: 'reserved', token: rows[0].token, minutes: RESERVATION_MINUTES, expiresAt: rows[0].expires_at };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function getByToken(token) {
  try {
    return await queryOne(
      `SELECT r.token, r.size, r.status, r.expires_at, r.ig_username, r.paid_at, r.order_id,
              i.code, i.name, i.live_price_cents, i.erp_product_id,
              s.id AS session_id, s.title AS session_title
       FROM live_reservations r
       JOIN live_items i ON i.id = r.item_id
       JOIN live_sessions s ON s.id = r.session_id
       WHERE r.token = $1::uuid`,
      [token]
    );
  } catch { return null; } // token que não é uuid válido
}

async function markPaid(token, orderId) {
  let row;
  try {
    row = await queryOne(
      `UPDATE live_reservations SET status = 'paid', paid_at = NOW(), order_id = $2
       WHERE token = $1::uuid AND status IN ('reserved', 'expired')
       RETURNING *`,
      [token, orderId || null]
    );
  } catch { return null; }
  if (row) notify({ sessionId: row.session_id, itemId: row.item_id, event: 'paid' });
  return row;
}

// Job (60s): expira reservas vencidas; pra cada vaga liberada, promove o primeiro da fila e avisa por DM
async function expireStale() {
  const expired = await queryAll(
    `UPDATE live_reservations SET status = 'expired'
     WHERE status = 'reserved' AND expires_at < NOW()
     RETURNING *`
  );
  if (expired.length === 0) return;
  console.log(`[live] ${expired.length} reserva(s) expirada(s)`);

  // require tardio pra evitar ciclo (webhook.js → reservations.js)
  const { sendDirectMessage } = require('../instagram/api');

  for (const res of expired) {
    notify({ sessionId: res.session_id, itemId: res.item_id, event: 'expired' });
    try {
      const next = await queryOne(
        `DELETE FROM live_waitlist WHERE id = (
           SELECT id FROM live_waitlist WHERE item_id = $1 AND size IS NOT DISTINCT FROM $2
           ORDER BY created_at ASC LIMIT 1
         ) RETURNING *`,
        [res.item_id, res.size]
      );
      if (!next || !next.ig_user_id) continue;

      const item = await queryOne("SELECT * FROM live_items WHERE id = $1", [res.item_id]);
      const promoted = await reserve({
        code: item.code.toUpperCase(), size: res.size,
        igUserId: next.ig_user_id, igUsername: next.ig_username,
        commentId: null, mediaId: null, source: 'waitlist',
      });
      if (promoted.status !== 'reserved') continue;

      await sendDirectMessage(
        next.ig_user_id,
        `Boa notícia! 🖤 Liberou a ${item.code}${res.size ? ' ' + res.size : ''} que você queria na live.\n` +
        `Reservei pra você por ${promoted.minutes} min. Paga no Pix aqui: ${CHECKOUT_BASE}/${promoted.token}`
      ).catch(e => console.warn('[live] DM da fila falhou:', e.details || e.message));
    } catch (e) {
      console.error('[live] promoção da fila falhou:', e.message);
    }
  }
}

// Painel do moderador: peças da sessão com contagens + fila
async function board(sessionId) {
  const session = await queryOne("SELECT * FROM live_sessions WHERE id = $1", [sessionId]);
  if (!session) return null;
  const items = await queryAll(
    `SELECT i.*,
       COALESCE(r.reserved, 0)::int AS reserved,
       COALESCE(r.paid, 0)::int AS paid,
       COALESCE(r.expired, 0)::int AS expired,
       COALESCE(w.waitlist, 0)::int AS waitlist
     FROM live_items i
     LEFT JOIN (
       SELECT item_id,
         COUNT(*) FILTER (WHERE status = 'reserved' AND expires_at > NOW()) AS reserved,
         COUNT(*) FILTER (WHERE status = 'paid') AS paid,
         COUNT(*) FILTER (WHERE status = 'expired') AS expired
       FROM live_reservations GROUP BY item_id
     ) r ON r.item_id = i.id
     LEFT JOIN (
       SELECT item_id, COUNT(*) AS waitlist FROM live_waitlist GROUP BY item_id
     ) w ON w.item_id = i.id
     WHERE i.session_id = $1
     ORDER BY i.code`,
    [sessionId]
  );
  const reservations = await queryAll(
    `SELECT r.*, i.code, i.name FROM live_reservations r
     JOIN live_items i ON i.id = r.item_id
     WHERE r.session_id = $1 ORDER BY r.created_at DESC LIMIT 200`,
    [sessionId]
  );
  return { session, items, reservations };
}

module.exports = { initTables, init, reserve, getByToken, markPaid, expireStale, board };
