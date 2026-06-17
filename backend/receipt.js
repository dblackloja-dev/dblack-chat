// Geração de cupom/recibo — módulo compartilhado (server.js e ai-agent.js)
const { createCanvas } = require('@napi-rs/canvas');

const PAY_LABELS = { pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Cartão Crédito', debito: 'Cartão Débito', crediario: 'Crediário' };

// Gera cupom não fiscal como imagem PNG
function generateReceiptImage(sale, sellerName, customerName) {
  const W = 420;
  const pad = 24;
  const lh = 24;
  const F = 'DejaVu Sans, Arial, sans-serif';

  const itemCount = sale.items.length;
  const taxaEntrega = parseFloat(sale.taxa_entrega) || 0;
  const tipoEntrega = sale.tipo_entrega || 'retirada';
  const H = 280 + (itemCount * 52) + (sale.discount > 0 ? 28 : 0) + (taxaEntrega > 0 ? 28 : 0) + 24;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  let y = pad;
  const cx = W / 2;
  const r = W - pad;

  const line = () => {
    ctx.strokeStyle = '#CCCCCC';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(r, y); ctx.stroke();
    ctx.setLineDash([]);
    y += 12;
  };

  ctx.fillStyle = '#000';
  ctx.font = `bold 20px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText("D'BLACK STORE", cx, y); y += lh;
  ctx.font = `11px ${F}`;
  ctx.fillStyle = '#666';
  ctx.fillText('CUPOM NÃO FISCAL', cx, y); y += 8;
  line();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#333';
  ctx.font = `12px ${F}`;
  const now = new Date();
  const dataStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`Data: ${dataStr}`, pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(`Vendedor: ${sellerName}`, r, y); y += 18;
  if (customerName) {
    ctx.textAlign = 'left';
    ctx.fillText(`Cliente: ${customerName}`, pad, y); y += 18;
  }
  if (sale.cupom) {
    ctx.textAlign = 'left';
    ctx.fillText(`Cupom: ${sale.cupom}`, pad, y); y += 18;
  }
  line();

  for (const item of sale.items) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000';
    ctx.font = `bold 12px ${F}`;
    ctx.fillText(`${item.quantity}x ${item.name}`, pad, y);
    ctx.textAlign = 'right';
    ctx.font = `bold 12px ${F}`;
    ctx.fillText(`R$ ${(item.price * item.quantity).toFixed(2)}`, r, y); y += 18;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#888';
    ctx.font = `10px ${F}`;
    ctx.fillText(`SKU: ${item.sku || '-'}  |  R$ ${item.price.toFixed(2)} cada`, pad + 8, y); y += 22;
  }
  line();

  ctx.fillStyle = '#333';
  ctx.font = `13px ${F}`;
  ctx.textAlign = 'left';
  ctx.fillText('Subtotal:', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(`R$ ${sale.subtotal.toFixed(2)}`, r, y); y += lh;

  if (sale.discount > 0) {
    ctx.fillStyle = '#CC0000';
    ctx.font = `13px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText('Desconto:', pad, y);
    ctx.textAlign = 'right';
    ctx.fillText(`- R$ ${sale.discount.toFixed(2)}`, r, y); y += lh;
  }

  if (taxaEntrega > 0) {
    ctx.fillStyle = '#333';
    ctx.font = `13px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText('Entrega:', pad, y);
    ctx.textAlign = 'right';
    ctx.fillText(`R$ ${taxaEntrega.toFixed(2)}`, r, y); y += lh;
  }

  ctx.fillStyle = '#000';
  ctx.font = `bold 18px ${F}`;
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL:', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(`R$ ${sale.total.toFixed(2)}`, r, y); y += lh + 4;

  ctx.font = `12px ${F}`;
  ctx.fillStyle = '#333';
  ctx.textAlign = 'left';
  const entregaLabel = tipoEntrega === 'entrega' ? '🚚 Entrega' : '🏪 Retirada na loja';
  ctx.fillText(`Pagamento: ${PAY_LABELS[sale.payment_method] || sale.payment_method}  |  ${entregaLabel}`, pad, y); y += 8;
  line();

  y += 4;
  ctx.fillStyle = '#000';
  ctx.font = `bold 12px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText('Obrigado pela preferencia!', cx, y); y += 18;
  ctx.font = `10px ${F}`;
  ctx.fillStyle = '#666';
  ctx.fillText("D'Black Store — @d_blackloja", cx, y);

  return canvas.toBuffer('image/png');
}

// Gera cupom não fiscal como texto formatado para WhatsApp
function generateReceiptText(sale, sellerName, customerName) {
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let text = `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `    🖤 *D'BLACK STORE*\n`;
  text += `     CUPOM NÃO FISCAL\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📅 ${data}\n`;
  text += `👤 Vendedor: ${sellerName}\n`;
  if (customerName) text += `🙋 Cliente: ${customerName}\n`;
  if (sale.cupom) text += `🧾 Cupom: ${sale.cupom}\n`;
  text += `────────────────────\n`;
  text += `*ITENS:*\n\n`;

  for (const item of sale.items) {
    text += `▸ ${item.quantity}x ${item.name}\n`;
    text += `   SKU: ${item.sku || '-'} | R$ ${item.price.toFixed(2)} cada\n`;
    text += `   *Subtotal: R$ ${(item.price * item.quantity).toFixed(2)}*\n\n`;
  }

  const taxaEntrega = parseFloat(sale.taxa_entrega) || 0;
  const tipoEntrega = sale.tipo_entrega || 'retirada';

  text += `────────────────────\n`;
  text += `Subtotal: R$ ${sale.subtotal.toFixed(2)}\n`;
  if (sale.discount > 0) {
    text += `Desconto: - R$ ${sale.discount.toFixed(2)}\n`;
  }
  if (taxaEntrega > 0) {
    text += `🚚 Entrega: R$ ${taxaEntrega.toFixed(2)}\n`;
  }
  text += `\n💰 *TOTAL: R$ ${sale.total.toFixed(2)}*\n`;
  text += `💳 Pagamento: ${PAY_LABELS[sale.payment_method] || sale.payment_method}\n`;
  const entregaLabel = tipoEntrega === 'entrega' ? '🚚 Entrega' : '🏪 Retirada na loja';
  text += `📦 ${entregaLabel}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `  Obrigado pela preferência! 🛍️\n`;
  text += `  *D'Black Store* — @d_blackloja`;

  return text;
}

module.exports = { generateReceiptImage, generateReceiptText };
