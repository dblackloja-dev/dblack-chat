// WhatsApp via API oficial do Meta (Cloud API) — substitui a Evolution/Baileys
// Mesma interface do whatsapp-evolution.js: o server.js e a Lê não percebem a troca.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config();

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TOKEN = process.env.META_WA_TOKEN;
const PHONE_ID = process.env.META_WA_PHONE_ID;

if (!TOKEN || !PHONE_ID) {
  console.error('❌ ERRO: META_WA_TOKEN e META_WA_PHONE_ID devem estar no .env para usar WA_PROVIDER=meta!');
}

class WhatsAppMeta extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.qrCode = null;        // não existe na API oficial — mantido pela interface
    this.pairingCode = null;   // idem

    // Último id de mensagem recebida por contato — necessário pro indicador "digitando..."
    this._lastIncoming = new Map();

    // Contador de mensagens (só monitoramento)
    this.msgCount = { hour: 0, day: 0, hourReset: Date.now(), dayReset: Date.now() };
  }

  canSend() {
    const now = Date.now();
    if (now - this.msgCount.hourReset > 3600000) { this.msgCount.hour = 0; this.msgCount.hourReset = now; }
    if (now - this.msgCount.dayReset > 86400000) { this.msgCount.day = 0; this.msgCount.dayReset = now; }
    return true;
  }

  trackSend() {
    this.msgCount.hour++;
    this.msgCount.day++;
  }

  // Delay humanizado — mantido pra Lê continuar com ritmo de gente
  async humanDelay(isMedia = false) {
    const now = Date.now();
    const timeSinceLast = now - (this.lastSendTime || 0);
    let delay;
    if (timeSinceLast < 10000 && isMedia) {
      delay = 300 + Math.random() * 500;
    } else if (timeSinceLast < 10000) {
      delay = 1000 + Math.random() * 1000;
    } else {
      delay = 2000 + Math.random() * 2000;
    }
    this.lastSendTime = now;
    await new Promise(r => setTimeout(r, delay));
  }

  // Normaliza destinatário: Cloud API usa só dígitos (wa_id)
  _digits(phone) {
    if (String(phone).endsWith('@lid')) {
      // Conversas antigas da Evolution identificadas por LID não têm número real —
      // não há como enviar pela API oficial. Cliente precisa mandar mensagem de novo.
      throw new Error('Contato antigo sem número real (LID). Peça para o cliente enviar uma nova mensagem.');
    }
    return String(phone).replace(/@.*$/, '').replace(/\D/g, '');
  }

  async graph(method, pathPart, body) {
    const res = await fetch(`${GRAPH_URL}/${pathPart}`, {
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (json?.error) {
      const err = new Error(json.error.message || 'Erro na API do Meta');
      err.code = json.error.code;
      throw err;
    }
    return json;
  }

  async _sendPayload(payload) {
    const result = await this.graph('POST', `${PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...payload,
    });
    result._waId = result?.messages?.[0]?.id || null;
    return result;
  }

  async connect() {
    try {
      const info = await this.graph('GET', `${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`);
      this.connected = true;
      console.log(`✅ WhatsApp (Meta Cloud API) conectado! Número: ${info.display_phone_number} | Nome: ${info.verified_name} | Qualidade: ${info.quality_rating}`);
      this.emit('connected');
      return info;
    } catch (e) {
      this.connected = false;
      console.error('❌ Erro ao conectar na Cloud API:', e.message);
      // Token expirado/inválido é o erro mais comum (código 190)
      if (e.code === 190) console.error('🔑 Token inválido ou expirado — gere um novo em developers.facebook.com');
      setTimeout(() => this.connect(), 60000);
      return null;
    }
  }

  // Health check genérico (server.js usa a cada 60s)
  async checkHealth() {
    try {
      await this.graph('GET', `${PHONE_ID}?fields=id`);
      return true;
    } catch (e) {
      return e.code === 190 ? false : this.connected; // erro de rede não derruba o status
    }
  }

  // API oficial não usa QR nem pairing — mantidos pela interface do painel
  async getQRCode() { return null; }
  async startPairing() {
    console.log('ℹ️ API oficial do Meta não usa pareamento — conexão é por token.');
    await this.connect();
    return null;
  }

  // Indicador "digitando..." — Cloud API exige o id da última msg recebida do contato
  async sendPresence(phone, _type = 'composing') {
    try {
      const msgId = this._lastIncoming.get(this._digits(phone));
      if (!msgId) return;
      await this.graph('POST', `${PHONE_ID}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: msgId,
        typing_indicator: { type: 'text' },
      });
    } catch {}
  }

  async markAsRead(msgId, _phone) {
    try {
      await this.graph('POST', `${PHONE_ID}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: msgId,
      });
      console.log('👁️ Marcado como lido:', msgId);
    } catch (e) { console.error('Erro ao marcar como lido:', e.message); }
  }

  async sendMessage(phone, text, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    if (isBot) {
      await this.sendPresence(phone);
      await this.humanDelay();
    }
    this.trackSend();
    return this._sendPayload({ to: this._digits(phone), type: 'text', text: { body: text, preview_url: true } });
  }

  // Sobe mídia pra Cloud API e retorna o media id
  async _uploadMedia(buffer, mime, fileName) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([buffer], { type: mime }), fileName);
    const result = await this.graph('POST', `${PHONE_ID}/media`, form);
    if (!result?.id) throw new Error('Upload de mídia falhou');
    return result.id;
  }

  async sendImage(phone, imageBuffer, caption = '', { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    if (isBot) {
      await this.sendPresence(phone);
      await this.humanDelay(true);
    }
    this.trackSend();
    const mediaId = await this._uploadMedia(imageBuffer, 'image/jpeg', 'imagem.jpg');
    return this._sendPayload({ to: this._digits(phone), type: 'image', image: { id: mediaId, ...(caption ? { caption } : {}) } });
  }

  // Converte vídeo pra MP4 H.264 + AAC (único formato que a Cloud API aceita bem).
  // Reduz pra no máx 720p pra caber no limite de 16MB e acelerar. Precisa de ffmpeg no sistema.
  async _toMp4(buffer) {
    const ffmpeg = require('fluent-ffmpeg');
    const tmpIn = path.join(os.tmpdir(), `wa_video_${Date.now()}_${Math.round(Math.random() * 1e6)}`);
    const tmpOut = tmpIn + '.mp4';
    try {
      fs.writeFileSync(tmpIn, buffer);
      await new Promise((resolve, reject) => {
        ffmpeg(tmpIn)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', "scale='min(720,iw)':-2", '-crf', '28'])
          .format('mp4')
          .on('end', resolve)
          .on('error', reject)
          .save(tmpOut);
      });
      return fs.readFileSync(tmpOut);
    } finally {
      try { fs.unlinkSync(tmpIn); } catch {}
      try { fs.unlinkSync(tmpOut); } catch {}
    }
  }

  async sendVideo(phone, videoBuffer, caption = '', { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    if (isBot) {
      await this.sendPresence(phone);
      await this.humanDelay(true);
    }
    this.trackSend();
    let outBuffer = videoBuffer;
    try {
      outBuffer = await this._toMp4(videoBuffer);
      console.log('🎥 Vídeo convertido pra mp4:', Math.round(outBuffer.length / 1024) + 'KB');
    } catch (e) {
      console.error('⚠️ Conversão de vídeo falhou, enviando original:', e.message);
      outBuffer = videoBuffer;
    }
    const mediaId = await this._uploadMedia(outBuffer, 'video/mp4', 'video.mp4');
    return this._sendPayload({ to: this._digits(phone), type: 'video', video: { id: mediaId, ...(caption ? { caption } : {}) } });
  }

  async sendDocument(phone, buffer, fileName, mimetype, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    if (isBot) {
      await this.sendPresence(phone);
      await this.humanDelay(true);
    }
    this.trackSend();
    const mediaId = await this._uploadMedia(buffer, mimetype || 'application/octet-stream', fileName || 'documento');
    return this._sendPayload({ to: this._digits(phone), type: 'document', document: { id: mediaId, filename: fileName || 'documento' } });
  }

  // Converte áudio pra OGG/Opus (formato de nota de voz do WhatsApp) via ffmpeg
  async _toOggOpus(buffer) {
    const ffmpeg = require('fluent-ffmpeg');
    const tmpIn = path.join(os.tmpdir(), `wa_audio_${Date.now()}_${Math.round(Math.random() * 1e6)}`);
    const tmpOut = tmpIn + '.ogg';
    try {
      fs.writeFileSync(tmpIn, buffer);
      await new Promise((resolve, reject) => {
        ffmpeg(tmpIn)
          .audioCodec('libopus')
          .audioChannels(1)
          .audioFrequency(48000)
          .format('ogg')
          .on('end', resolve)
          .on('error', reject)
          .save(tmpOut);
      });
      return fs.readFileSync(tmpOut);
    } finally {
      try { fs.unlinkSync(tmpIn); } catch {}
      try { fs.unlinkSync(tmpOut); } catch {}
    }
  }

  async sendAudio(phone, audioBuffer, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    if (isBot) {
      await this.sendPresence(phone);
      await this.humanDelay(true);
    }
    this.trackSend();
    let oggBuffer;
    try {
      oggBuffer = await this._toOggOpus(audioBuffer);
    } catch (e) {
      console.error('⚠️ Conversão de áudio falhou, enviando original:', e.message);
      oggBuffer = audioBuffer;
    }
    const mediaId = await this._uploadMedia(oggBuffer, 'audio/ogg', 'audio.ogg');
    return this._sendPayload({ to: this._digits(phone), type: 'audio', audio: { id: mediaId } });
  }

  // Botões interativos nativos (máx 3, título de botão máx 20 chars)
  async sendButtons(phone, title, description, buttons, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    if (isBot) {
      await this.sendPresence(phone);
      await this.humanDelay();
    }
    this.trackSend();
    return this._sendPayload({
      to: this._digits(phone),
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(title ? { header: { type: 'text', text: String(title).slice(0, 60) } } : {}),
        body: { text: String(description || title).slice(0, 1024) },
        action: {
          buttons: buttons.slice(0, 3).map(b => ({
            type: 'reply',
            reply: { id: String(b.id).slice(0, 256), title: String(b.text).slice(0, 20) },
          })),
        },
      },
    });
  }

  // Template aprovado — necessário pra iniciar conversa fora da janela de 24h
  async sendTemplate(phone, templateName, languageCode = 'pt_BR', components = []) {
    this.trackSend();
    return this._sendPayload({
      to: this._digits(phone),
      type: 'template',
      template: { name: templateName, language: { code: languageCode }, ...(components.length ? { components } : {}) },
    });
  }

  // Cloud API não expõe foto de perfil dos contatos
  async getProfilePic(_phone) { return null; }

  // Baixa mídia recebida: GET /{media_id} → URL temporária → download com token
  async downloadMedia(mediaId) {
    if (!mediaId) return null;
    try {
      const meta = await this.graph('GET', mediaId);
      if (!meta?.url) return null;
      const res = await fetch(meta.url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
      const buffer = Buffer.from(await res.arrayBuffer());
      const { queryRun } = require('./database');
      const id = 'meta_' + mediaId;
      const mime = meta.mime_type || 'application/octet-stream';
      await queryRun(
        "INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [id, mime, buffer.toString('base64')]
      );
      console.log('📥 Mídia baixada (Meta):', id, mime, Math.round(buffer.length / 1024) + 'KB');
      return `/media/${id}`;
    } catch (e) {
      console.error('Erro ao baixar mídia (Meta):', e.message);
      return null;
    }
  }

  // Processa webhook da Cloud API
  // Formato: { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {...} }] }] }
  async processWebhook(body) {
    if (body?.object !== 'whatsapp_business_account') return;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value || {};

        // Status de entrega: sent/delivered/read/failed
        for (const st of value.statuses || []) {
          const ackMap = { sent: 1, delivered: 2, read: 3 };
          if (st.status === 'failed') {
            const reason = st.errors?.[0]?.title || st.errors?.[0]?.message || 'desconhecido';
            console.error(`❌ Falha ao entregar msg ${st.id} para ${st.recipient_id}: ${reason}`);
            continue;
          }
          const ack = ackMap[st.status];
          if (ack) {
            this.emit('message_ack', { id: st.id, ack });
            console.log(`✓ Status msg ${st.id}: ${st.status}`);
          }
        }

        // Mensagens recebidas
        const contacts = value.contacts || [];
        for (const msg of value.messages || []) {
          if (!this.connected) { this.connected = true; this.emit('connected'); }
          const phone = msg.from;
          if (!phone) continue;
          const pushName = contacts.find(c => c.wa_id === phone)?.profile?.name || '';

          let content = '';
          let mediaType = null;
          let mediaUrl = null;

          switch (msg.type) {
            case 'text':
              content = msg.text?.body || '';
              break;
            case 'image':
              content = msg.image?.caption || '📷 Imagem';
              mediaType = 'image';
              mediaUrl = await this.downloadMedia(msg.image?.id);
              break;
            case 'video':
              content = msg.video?.caption || '🎥 Vídeo';
              mediaType = 'video';
              mediaUrl = await this.downloadMedia(msg.video?.id);
              break;
            case 'audio':
              content = '🎵 Áudio';
              mediaType = 'audio';
              mediaUrl = await this.downloadMedia(msg.audio?.id);
              break;
            case 'document': {
              const fileName = msg.document?.filename || 'Documento';
              content = '📄 ' + fileName;
              mediaType = 'document';
              mediaUrl = await this.downloadMedia(msg.document?.id);
              break;
            }
            case 'sticker':
              content = '🏷️ Figurinha';
              mediaType = 'sticker';
              break;
            case 'contacts':
              content = '👤 Contato';
              mediaType = 'contact';
              break;
            case 'location':
              content = '📍 Localização';
              mediaType = 'location';
              break;
            case 'interactive':
              content = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '🔘 Resposta interativa';
              break;
            case 'button':
              content = msg.button?.text || '🔘 Resposta de botão';
              break;
            case 'reaction':
              continue; // reação não é mensagem
            case 'unsupported':
              content = '[Mensagem não suportada]';
              break;
            default:
              console.log('⚠️ Tipo de msg não suportado (Meta):', msg.type, '| De:', phone);
              content = `[${msg.type}]`;
          }

          this._lastIncoming.set(phone, msg.id);
          console.log('📨 Mensagem de:', phone, '| Nome:', pushName, '| Tipo:', msg.type);
          this.emit('message', {
            id: msg.id,
            phone,
            realPhone: phone,
            pushName,
            content,
            mediaType,
            mediaUrl,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000 || Date.now()),
          });
        }
      }
    }
  }

  getStatus() {
    return {
      connected: this.connected,
      hasQR: false,
      pairingCode: null,
      provider: 'meta',
    };
  }
}

module.exports = WhatsAppMeta;
