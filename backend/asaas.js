// Integração com Asaas — Cobranças PIX e Link de Pagamento
require('dotenv').config();

const BASE_URL = 'https://www.asaas.com/api/v3';
const API_KEY = process.env.ASAAS_API_KEY;

async function asaasRequest(method, path, body = null) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'access_token': API_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.errors?.[0]?.description || `Asaas erro ${res.status}`);
  return data;
}

// Busca cliente pelo telefone ou cria um novo
async function findOrCreateCustomer(name, phone, cpf) {
  const cleanPhone = phone.replace(/\D/g, '');
  const phoneSearch = cleanPhone.length >= 12 ? cleanPhone.slice(-11) : cleanPhone;
  const cleanCpf = cpf ? cpf.replace(/\D/g, '') : null;

  // Busca por CPF primeiro (mais confiável), depois por telefone
  if (cleanCpf) {
    const searchCpf = await asaasRequest('GET', `/customers?cpfCnpj=${cleanCpf}`);
    if (searchCpf.data?.length > 0) {
      // Atualiza nome/telefone se necessário
      return searchCpf.data[0];
    }
  }

  const search = await asaasRequest('GET', `/customers?mobilePhone=${phoneSearch}`);
  if (search.data?.length > 0) {
    const existing = search.data[0];
    // Se achou por telefone mas não tem CPF, atualiza
    if (cleanCpf && !existing.cpfCnpj) {
      await asaasRequest('PUT', `/customers/${existing.id}`, { cpfCnpj: cleanCpf });
      existing.cpfCnpj = cleanCpf;
    }
    return existing;
  }

  // Cria novo cliente
  return asaasRequest('POST', '/customers', {
    name: name || 'Cliente WhatsApp',
    mobilePhone: phoneSearch,
    ...(cleanCpf ? { cpfCnpj: cleanCpf } : {}),
  });
}

// Cria cobrança PIX (retorna QR code)
async function createPixCharge(customerId, value, description) {
  const charge = await asaasRequest('POST', '/payments', {
    customer: customerId,
    billingType: 'PIX',
    value,
    description,
    dueDate: new Date().toISOString().split('T')[0],
  });

  // Busca QR Code do PIX
  const pix = await asaasRequest('GET', `/payments/${charge.id}/pixQrCode`);

  return {
    chargeId: charge.id,
    status: charge.status,
    value: charge.value,
    pixCode: pix.payload, // copia-cola
    pixQrCodeBase64: pix.encodedImage, // imagem base64
    invoiceUrl: charge.invoiceUrl,
  };
}

// Cria cobrança com link de pagamento (cartão de crédito)
async function createCardCharge(customerId, value, description, maxInstallments = 6) {
  const charge = await asaasRequest('POST', '/payments', {
    customer: customerId,
    billingType: 'CREDIT_CARD',
    value,
    description,
    dueDate: new Date().toISOString().split('T')[0],
    maxInstallmentCount: maxInstallments,
  });

  return {
    chargeId: charge.id,
    status: charge.status,
    value: charge.value,
    invoiceUrl: charge.invoiceUrl, // link de pagamento
  };
}

// Consulta status de uma cobrança
async function getChargeStatus(chargeId) {
  const charge = await asaasRequest('GET', `/payments/${chargeId}`);
  return {
    id: charge.id,
    status: charge.status, // PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED...
    value: charge.value,
    billingType: charge.billingType,
    confirmedDate: charge.confirmedDate,
  };
}

module.exports = { findOrCreateCustomer, createPixCharge, createCardCharge, getChargeStatus };
