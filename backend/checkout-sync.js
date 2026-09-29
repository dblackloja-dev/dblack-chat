// Espelho do catálogo do D'Black Checkout na Vitrine da Lê.
// O cadastro de peças passa a ser feito UMA vez só, no admin do checkout:
// este módulo copia os produtos de lá para promo_items/promo_stock/promo_photos
// (ids com prefixo ck_) e o restante do código da Lê funciona sem mudanças.
// A baixa de estoque na venda da Lê é devolvida ao checkout pelo server.js
// (reportSale) — o checkout é a única fonte de verdade do estoque.
const { queryAll, queryOne, queryRun } = require('./database');

const CHECKOUT_URL = (process.env.CHECKOUT_URL || '').replace(/\/$/, '');
const CHECKOUT_TOKEN = process.env.CHECKOUT_TOKEN || '';
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const CATEGORY = 'Loja';

function enabled() { return Boolean(CHECKOUT_URL && CHECKOUT_TOKEN); }

async function fetchJson(path) {
  const res = await fetch(`${CHECKOUT_URL}${path}`, {
    headers: { 'x-integration-token': CHECKOUT_TOKEN },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchPhotoBase64(photoId) {
  const res = await fetch(`${CHECKOUT_URL}/api/photos/${photoId}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`foto ${photoId} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

let running = false;
async function syncNow() {
  if (!enabled() || running) return;
  running = true;
  try {
    const catalog = await fetchJson('/api/integration/catalog');
    const keepIds = catalog.map(p => `ck_${p.id}`);
    let changes = 0;

    for (const p of catalog) {
      const itemId = `ck_${p.id}`;
      const obs = (p.description || '').trim() || null;
      const existing = await queryOne(
        "SELECT id, display_name, promo_price, promo_price_card, obs, active FROM promo_items WHERE id = $1", [itemId]);
      if (!existing) {
        await queryRun(
          "INSERT INTO promo_items (id, ref, category, display_name, active, promo_price, promo_price_card, obs) VALUES ($1, NULL, $2, $3, true, $4, $5, $6)",
          [itemId, CATEGORY, p.name, p.price_pix, p.price_card, obs]);
        changes++;
      } else if (existing.display_name !== p.name || parseFloat(existing.promo_price) !== p.price_pix
        || parseFloat(existing.promo_price_card) !== p.price_card || (existing.obs || null) !== obs || !existing.active) {
        await queryRun(
          "UPDATE promo_items SET display_name = $2, promo_price = $3, promo_price_card = $4, obs = $5, active = true WHERE id = $1",
          [itemId, p.name, p.price_pix, p.price_card, obs]);
        changes++;
      }

      // Grade cor+tamanho: limite = estoque atual do checkout, vendido zera
      // (a venda da Lê marca stock_sold localmente só até o próximo sync)
      const wanted = new Set();
      for (const v of p.variants || []) {
        const color = (v.color || '').trim();
        const size = (v.size || '').trim();
        wanted.add(`${color.toLowerCase()}|${size.toLowerCase()}`);
        await queryRun(
          `INSERT INTO promo_stock (id, promo_item_id, color, size, stock_limit, stock_sold) VALUES ($1, $2, $3, $4, $5, 0)
           ON CONFLICT (promo_item_id, color, size) DO UPDATE SET stock_limit = $5, stock_sold = 0`,
          [`${itemId}_${color}_${size}`.toLowerCase(), itemId, color, size, Math.max(0, parseInt(v.stock) || 0)]);
      }
      const stockRows = await queryAll("SELECT id, color, size FROM promo_stock WHERE promo_item_id = $1", [itemId]);
      for (const row of stockRows) {
        if (!wanted.has(`${(row.color || '').trim().toLowerCase()}|${(row.size || '').trim().toLowerCase()}`)) {
          await queryRun("DELETE FROM promo_stock WHERE id = $1", [row.id]);
          changes++;
        }
      }

      // Fotos: baixa só as que ainda não temos; remove as que sumiram no checkout
      const wantedPhotoIds = new Set((p.photos || []).map(f => `ck_${f.id}`));
      const havePhotos = await queryAll("SELECT id FROM promo_photos WHERE promo_item_id = $1", [itemId]);
      for (const row of havePhotos) {
        if (row.id.startsWith('ck_') && !wantedPhotoIds.has(row.id)) {
          await queryRun("DELETE FROM promo_photos WHERE id = $1", [row.id]);
          changes++;
        }
      }
      const haveIds = new Set(havePhotos.map(r => r.id));
      for (const f of p.photos || []) {
        const photoId = `ck_${f.id}`;
        if (haveIds.has(photoId)) continue;
        try {
          const data = await fetchPhotoBase64(f.id);
          await queryRun(
            "INSERT INTO promo_photos (id, promo_item_id, color, mime_type, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
            [photoId, itemId, (f.color || '').trim(), f.mime_type || 'image/jpeg', data]);
          changes++;
        } catch (e) {
          console.error(`⚠️ Sync checkout: foto ${f.id} falhou:`, e.message);
        }
      }
    }

    // Produtos que saíram do ar no checkout somem da vitrine (cascade limpa fotos/grade)
    const gone = await queryAll(
      keepIds.length
        ? "SELECT id FROM promo_items WHERE id LIKE 'ck\\_%' AND NOT (id = ANY($1))"
        : "SELECT id FROM promo_items WHERE id LIKE 'ck\\_%'",
      keepIds.length ? [keepIds] : []);
    for (const row of gone) {
      await queryRun("DELETE FROM promo_items WHERE id = $1", [row.id]);
      changes++;
    }

    if (changes > 0) console.log(`🛒 Sync checkout→vitrine: ${catalog.length} peça(s), ${changes} mudança(s)`);
  } catch (e) {
    console.error('⚠️ Sync checkout→vitrine falhou:', e.message);
  } finally {
    running = false;
  }
}

// Devolve pro checkout a baixa de estoque de uma venda da Lê (idempotente por saleId)
async function reportSale(saleId, items) {
  if (!enabled()) return false;
  const ckItems = (items || [])
    .filter(i => typeof i.promo_item_id === 'string' && i.promo_item_id.startsWith('ck_'))
    .map(i => ({
      product_id: parseInt(i.promo_item_id.slice(3)),
      color: i.color || '',
      size: i.size || '',
      qty: i.quantity || 1,
    }));
  if (ckItems.length === 0) return false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${CHECKOUT_URL}/api/integration/sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-integration-token': CHECKOUT_TOKEN },
        body: JSON.stringify({ sale_id: `le_${saleId}`, origin: 'le-whatsapp', items: ckItems }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return true;
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error(`⚠️ Baixa no checkout (tentativa ${attempt}/3) falhou:`, e.message);
      if (attempt === 3) return false;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  return false;
}

function isMirroredId(id) { return typeof id === 'string' && id.startsWith('ck_'); }

function start() {
  if (!enabled()) { console.log('🛒 Sync checkout→vitrine desativado (CHECKOUT_URL/CHECKOUT_TOKEN ausentes)'); return; }
  syncNow();
  setInterval(syncNow, SYNC_INTERVAL_MS);
  console.log('🛒 Sync checkout→vitrine ligado (a cada 2 min)');
}

module.exports = { start, syncNow, reportSale, isMirroredId, enabled };
