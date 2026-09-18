// Banner bonito pro restream do Instagram: desenha as peças EM CENA no mesmo
// visual dos cards da sala (vidro escuro, dourado, foto) e serve como PNG
// transparente. O servidor de streaming (dblack-live) baixa a cada 3s e
// carimba no vídeo que vai pro Instagram.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { queryOne } = require('../database');
const reservations = require('./reservations');

const W = 676, H = 360;
const GOLD = '#e6c15c';
const CARD_H = 128, CARD_GAP = 12, CTA_H = 52;

let cache = { buffer: null, at: 0 };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

async function itemPhoto(mediaId) {
  if (!mediaId) return null;
  try {
    const file = await queryOne('SELECT mime_type, data FROM media_files WHERE id = $1', [mediaId]);
    if (!file) return null;
    return await loadImage(Buffer.from(file.data, 'base64'));
  } catch { return null; }
}

async function render() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H); // fundo transparente

  const v = await reservations.vitrine();
  const items = (v?.items || []).filter(i => !i.soldOut).slice(0, 2);
  if (!v || items.length === 0) return canvas.encode('png'); // invisível

  // CTA embaixo (pill dourada, estilo botão QUERO da sala)
  const ctaY = H - CTA_H;
  roundRect(ctx, 60, ctaY, W - 120, CTA_H, CTA_H / 2);
  const grad = ctx.createLinearGradient(0, ctaY, 0, ctaY + CTA_H);
  grad.addColorStop(0, '#f0d27a'); grad.addColorStop(1, '#d4af37');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.fillStyle = '#181510';
  ctx.font = 'bold 24px "DejaVu Sans"';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('TOCA NO LINK E GARANTA A SUA', W / 2, ctaY + CTA_H / 2 + 1);

  // Cards de baixo pra cima
  for (let k = 0; k < items.length; k++) {
    const i = items[items.length - 1 - k];
    const y = ctaY - CARD_GAP - CARD_H - k * (CARD_H + CARD_GAP);

    roundRect(ctx, 0, y, W, CARD_H, 22);
    ctx.fillStyle = 'rgba(10,12,11,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,55,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Foto (ou caixinha com o código)
    const ph = { x: 12, y: y + 10, w: 84, h: CARD_H - 20 };
    ctx.save();
    roundRect(ctx, ph.x, ph.y, ph.w, ph.h, 12);
    ctx.clip();
    const img = await itemPhoto(i.photoMediaId);
    if (img) {
      const scale = Math.max(ph.w / img.width, ph.h / img.height);
      ctx.drawImage(img, ph.x + (ph.w - img.width * scale) / 2, ph.y + (ph.h - img.height * scale) / 2, img.width * scale, img.height * scale);
    } else {
      ctx.fillStyle = 'rgba(212,175,55,0.14)';
      ctx.fillRect(ph.x, ph.y, ph.w, ph.h);
      ctx.fillStyle = GOLD;
      ctx.font = 'bold 26px "DejaVu Sans"';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(i.code, ph.x + ph.w / 2, ph.y + ph.h / 2);
    }
    ctx.restore();

    // Textos
    const tx = ph.x + ph.w + 16;
    const maxW = W - tx - 16;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "DejaVu Sans"';
    ctx.fillText(fitText(ctx, `${i.code} · ${i.name}`, maxW), tx, y + 44);
    ctx.fillStyle = GOLD;
    ctx.font = 'bold 32px "DejaVu Sans"';
    const cents = i.priceCents % 100;
    ctx.fillText(`R$ ${Math.floor(i.priceCents / 100)},${String(cents).padStart(2, '0')}`, tx, y + 86);
    if (i.sizes) {
      const disp = Object.entries(i.sizes).filter(([, q]) => q > 0).map(([s]) => s).join('  ');
      if (disp) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '20px "DejaVu Sans"';
        ctx.fillText(fitText(ctx, `Tamanhos: ${disp}`, maxW), tx, y + 114);
      }
    }
  }

  return canvas.encode('png');
}

// PNG com cache de 3s (o dblack-live busca a cada 3s)
async function bannerPng() {
  if (cache.buffer && Date.now() - cache.at < 3000) return cache.buffer;
  const buffer = await render();
  cache = { buffer, at: Date.now() };
  return buffer;
}

module.exports = { bannerPng };
