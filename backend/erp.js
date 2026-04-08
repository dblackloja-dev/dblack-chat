// Conexão direta com o banco do ERP D'Black
const { Pool } = require('pg');
require('dotenv').config();

const erpPool = new Pool({
  connectionString: process.env.ERP_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const erpQuery = async (text, params = []) => (await erpPool.query(text, params)).rows;
const erpQueryOne = async (text, params = []) => ((await erpPool.query(text, params)).rows)[0] || null;
const erpRun = async (text, params = []) => erpPool.query(text, params);

// Busca produtos por SKU, nome ou EAN
async function searchProducts(term) {
  const like = `%${term}%`;
  return erpQuery(
    `SELECT p.id, p.sku, p.name, p.brand, p.category, p.size, p.color,
            p.price, p.cost, p.ean, p.ref, p.photo,
            COALESCE(SUM(s.quantity), 0) AS total_stock
     FROM products p
     LEFT JOIN stock s ON s.product_id = p.id
     WHERE p.active = true
       AND (p.sku ILIKE $1 OR p.name ILIKE $1 OR p.ean ILIKE $1 OR p.ref ILIKE $1)
     GROUP BY p.id
     ORDER BY p.name
     LIMIT 20`,
    [like]
  );
}

// Busca estoque por loja
async function getProductStock(productId) {
  return erpQuery(
    `SELECT s.stock_id, st.name AS store_name, s.quantity
     FROM stock s
     JOIN stores st ON st.id = s.stock_id
     WHERE s.product_id = $1`,
    [productId]
  );
}

// Busca lojas
async function getStores() {
  return erpQuery("SELECT id, name FROM stores ORDER BY name");
}

// Busca cliente por telefone
async function findCustomerByPhone(phone) {
  // Tenta variações do número
  const clean = phone.replace(/\D/g, '');
  const variations = [clean, clean.slice(-11), clean.slice(-10), clean.slice(-9)];
  for (const v of variations) {
    const customer = await erpQueryOne(
      "SELECT * FROM customers WHERE REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $1",
      [`%${v}%`]
    );
    if (customer) return customer;
  }
  return null;
}

// Garante que o caixa da loja está aberto (abre com R$ 0 se estiver fechado)
async function ensureCashOpen(storeId) {
  const state = await erpQueryOne("SELECT * FROM cash_state WHERE store_id = $1", [storeId]);
  if (!state) {
    // Cria registro de caixa e abre
    await erpRun(
      "INSERT INTO cash_state (store_id, is_open, initial_value, opened_at) VALUES ($1, true, 0, NOW())",
      [storeId]
    );
    console.log(`💰 Caixa ${storeId} criado e aberto automaticamente (R$ 0)`);
  } else if (!state.is_open) {
    await erpRun(
      "UPDATE cash_state SET is_open = true, initial_value = 0, opened_at = NOW() WHERE store_id = $1",
      [storeId]
    );
    console.log(`💰 Caixa ${storeId} aberto automaticamente (R$ 0)`);
  }
}

// Gera número de cupom no formato do ERP
function generateCupom() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `CNF-${h}${m}${s}`;
}

// Cria venda no ERP
async function createSale({ store_id, customer_id, customer_name, customer_phone, seller_name, seller_id, items, payment_method, discount, discount_type }) {
  const saleId = require('crypto').randomUUID();
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  let discountValue = 0;
  let discountLabel = '';
  if (discount_type === 'percent') {
    discountValue = subtotal * (discount / 100);
    discountLabel = `${discount}%`;
  } else {
    discountValue = discount || 0;
    discountLabel = discountValue > 0 ? `R$ ${discountValue.toFixed(2)}` : '';
  }
  const total = subtotal - discountValue;

  // Abre o caixa automaticamente se estiver fechado
  await ensureCashOpen(store_id);

  // Formata data como o ERP espera (YYYY-MM-DD)
  const today = new Date().toISOString().split('T')[0];

  // Monta payments no formato do ERP
  const payLabels = { pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Crédito', debito: 'Débito', crediario: 'Crediário' };
  const payments = JSON.stringify([{ method: payLabels[payment_method] || payment_method, value: total }]);

  const cupom = generateCupom();

  // Cria a venda (usando colunas reais do ERP)
  await erpRun(
    `INSERT INTO sales (id, store_id, date, customer, customer_id, customer_whatsapp, seller, seller_id, items, subtotal, discount, discount_label, total, payment, payments, status, cupom, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'Concluída', $16, NOW())`,
    [saleId, store_id, today, customer_name || 'Cliente WhatsApp', customer_id || '', customer_phone || '', seller_name, seller_id || '', JSON.stringify(items), subtotal, discountValue, discountLabel, total, payLabels[payment_method] || payment_method, payments, cupom]
  );

  // Deduz estoque
  for (const item of items) {
    await erpRun(
      "UPDATE stock SET quantity = quantity - $1 WHERE stock_id = $2 AND product_id = $3",
      [item.quantity, store_id, item.product_id]
    );
  }

  return { id: saleId, cupom, subtotal, discount: discountValue, total, items, payment_method, created_at: new Date() };
}

// Busca usuário do ERP para login
async function findUser(login) {
  return erpQueryOne(
    "SELECT * FROM users WHERE (LOWER(name) = LOWER($1) OR LOWER(email) = LOWER($1)) AND active = true",
    [login]
  );
}

// Lista usuários ativos do ERP
async function listUsers() {
  return erpQuery("SELECT id, name, email, role, store_id, active, avatar FROM users WHERE active = true ORDER BY name");
}

module.exports = { searchProducts, getProductStock, getStores, findCustomerByPhone, createSale, ensureCashOpen, findUser, listUsers, erpQuery, erpQueryOne };
