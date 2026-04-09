// WhatsApp via Evolution API — substitui o Baileys
const EventEmitter = require('events');
require('dotenv').config();

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'https://evolution-api-production-fd89.up.railway.app';
const EVOLUTION_KEY = process.env.EVOLUTION_KEY || 'c5796614004d61049c43a173bfbb0f18dafda837c6b3447354b6958bca68175c';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'dblack-chat';

class WhatsAppEvolution extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.qrCode = null;
    this.pairingCode = null;

    // Proteções anti-restrição
    this.msgCount = { hour: 0, day: 0, hourReset: Date.now(), dayReset: Date.now() };
    this.MSG_LIMIT_HOUR = 30;   // máximo 30 msgs por hora
    this.MSG_LIMIT_DAY = 200;   // máximo 200 msgs por dia
  }

  // Verifica se pode enviar (rate limit)
  canSend() {
    const now = Date.now();
    if (now - this.msgCount.hourReset > 3600000) { this.msgCount.hour = 0; this.msgCount.hourReset = now; }
    if (now - this.msgCount.dayReset > 86400000) { this.msgCount.day = 0; this.msgCount.dayReset = now; }
    if (this.msgCount.hour >= this.MSG_LIMIT_HOUR) { console.log('⚠️ Limite de msgs/hora atingido'); return false; }
    if (this.msgCount.day >= this.MSG_LIMIT_DAY) { console.log('⚠️ Limite de msgs/dia atingido'); return false; }
    return true;
  }

  // Registra envio
  trackSend() {
    this.msgCount.hour++;
    this.msgCount.day++;
    console.log(`📊 Msgs: ${this.msgCount.hour}/h | ${this.msgCount.day}/dia`);
  }

  // Delay humanizado (2-5 segundos)
  async humanDelay() {
    const delay = 2000 + Math.random() * 3000;
    await new Promise(r => setTimeout(r, delay));
  }

  // Simula "digitando..." antes de enviar
  async sendPresence(phone, type = 'composing') {
    try {
      const number = phone.replace(/\D/g, '');
      await this.api('POST', 'chat/sendPresence', { number, presence: type });
    } catch {}
  }

  // Marca mensagem como lida (read receipt)
  async markAsRead(msgId, phone) {
    try {
      await this.api('POST', 'chat/markMessageAsRead', {
        readMessages: [{ remoteJid: phone.includes('@') ? phone : phone + '@s.whatsapp.net', id: msgId }],
      });
      console.log('👁️ Marcado como lido:', msgId);
    } catch (e) { console.error('Erro ao marcar como lido:', e.message); }
  }

  async api(method, endpoint, body) {
    const url = `${EVOLUTION_URL}/${endpoint}/${INSTANCE}`;
    const opts = {
      method,
      headers: { 'apikey': EVOLUTION_KEY, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
  }

  async connect() {
    try {
      const status = await this.api('GET', 'instance/connectionState');
      const state = status?.instance?.state;
      this.connected = state === 'open';
      if (this.connected) {
        console.log('✅ WhatsApp (Evolution) conectado!');
        this.emit('connected');
      } else {
        console.log('📱 WhatsApp (Evolution) estado:', state);
        // Se está connecting, tenta de novo em 10s
        if (state === 'connecting') {
          setTimeout(() => this.connect(), 10000);
        }
      }
      return status;
    } catch (e) {
      console.error('Erro ao verificar conexão Evolution:', e.message);
      return null;
    }
  }

  async getQRCode() {
    try {
      const result = await this.api('GET', 'instance/connect');
      if (result?.base64) {
        this.qrCode = result.base64;
        return result.base64;
      }
      if (result?.pairingCode) {
        this.pairingCode = result.pairingCode;
        return null;
      }
      return null;
    } catch (e) {
      console.error('Erro QR:', e.message);
      return null;
    }
  }

  async startPairing(phone) {
    try {
      this.pairingCode = null;
      this.qrCode = null;
      // Evolution v2: GET /instance/connect retorna QR
      const result = await this.api('GET', 'instance/connect');
      if (result?.base64) {
        this.qrCode = result.base64;
        this.emit('qr', result.base64);
        console.log('📱 QR Code gerado pela Evolution');
      }
      if (result?.pairingCode) {
        this.pairingCode = result.pairingCode;
        this.emit('pairing_code', result.pairingCode);
        console.log('🔢 Código de pareamento:', result.pairingCode);
        return result.pairingCode;
      }
      return null;
    } catch (e) {
      console.error('Erro ao parear:', e.message);
      return null;
    }
  }

  async sendMessage(phone, text) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido. Tente novamente mais tarde.');
    const number = phone.replace(/\D/g, '');
    // Simula comportamento humano: digitando... + delay
    await this.sendPresence(phone, 'composing');
    await this.humanDelay();
    this.trackSend();
    return this.api('POST', 'message/sendText', { number, text });
  }

  async sendImage(phone, imageBuffer, caption = '') {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    const number = phone.replace(/\D/g, '');
    const base64 = imageBuffer.toString('base64');
    await this.sendPresence(phone, 'composing');
    await this.humanDelay();
    this.trackSend();
    return this.api('POST', 'message/sendMedia', {
      number, mediatype: 'image', mimetype: 'image/jpeg', caption, media: base64, fileName: 'imagem.jpg',
    });
  }

  async sendAudio(phone, audioBuffer) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    const number = phone.replace(/\D/g, '');
    const base64 = audioBuffer.toString('base64');
    await this.sendPresence(phone, 'recording');
    await this.humanDelay();
    this.trackSend();
    return this.api('POST', 'message/sendWhatsAppAudio', { number, audio: base64 });
  }

  async sendDocument(phone, buffer, fileName, mimetype) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    const number = phone.replace(/\D/g, '');
    const base64 = buffer.toString('base64');
    await this.sendPresence(phone, 'composing');
    await this.humanDelay();
    this.trackSend();
    return this.api('POST', 'message/sendMedia', {
      number, mediatype: 'document', mimetype: mimetype || 'application/octet-stream', media: base64, fileName,
    });
  }

  // Processa webhook da Evolution
  async processWebhook(body) {
    const event = (body.event || '').toLowerCase().replace(/_/g, '.');
    console.log('📩 Webhook Evolution:', event);

    if (event === 'connection.update') {
      const state = body.data?.state || body.data?.instance?.state;
      this.connected = state === 'open';
      if (this.connected) {
        this.emit('connected');
        console.log('✅ WhatsApp (Evolution) conectado!');
      } else {
        console.log('📱 WhatsApp estado:', state);
        this.emit('disconnected');
      }
    }

    if (event === 'qrcode.updated') {
      if (body.data?.qrcode?.base64) {
        this.qrCode = body.data.qrcode.base64;
        this.emit('qr', body.data.qrcode.base64);
      }
      if (body.data?.qrcode?.pairingCode) {
        this.pairingCode = body.data.qrcode.pairingCode;
        this.emit('pairing_code', body.data.qrcode.pairingCode);
      }
    }

    // Status de entrega das mensagens (enviado/entregue/lido)
    if (event === 'messages.update') {
      const updates = Array.isArray(body.data) ? body.data : [body.data];
      for (const upd of updates) {
        const msgId = upd?.key?.id || upd?.keyId;
        const status = upd?.update?.status || upd?.status;
        if (msgId && status != null) {
          // Evolution: 1=enviado, 2=entregue(servidor), 3=entregue(dispositivo), 4=lido
          // Nosso ack: 1=enviado, 2=entregue, 3=lido
          const ack = status >= 4 ? 3 : status >= 3 ? 2 : status >= 2 ? 2 : 1;
          this.emit('message_ack', { id: msgId, ack });
          console.log(`✓ Status msg ${msgId}: ${['','enviado','entregue','lido'][ack]}`);
        }
      }
      return;
    }

    if (event === 'messages.upsert') {
      const msg = body.data;
      if (!msg || msg.key?.fromMe) return;
      const jid = msg.key?.remoteJidAlt || msg.key?.remoteJid || '';
      if (jid === 'status@broadcast') return;
      if (jid.endsWith('@g.us')) return;
      if (jid.endsWith('@lid') && !msg.key?.remoteJidAlt) return;

      const phone = jid.replace('@s.whatsapp.net', '').replace('@lid', '');
      if (!phone || phone.length < 8) return;
      console.log('📨 Mensagem de:', phone, '| Nome:', msg.pushName);

      const pushName = msg.pushName || '';
      let content = '';
      let mediaType = null;
      let mediaUrl = null;

      const msgContent = msg.message;
      if (msgContent?.conversation) {
        content = msgContent.conversation;
      } else if (msgContent?.extendedTextMessage?.text) {
        content = msgContent.extendedTextMessage.text;
      } else if (msgContent?.imageMessage) {
        content = msgContent.imageMessage.caption || '📷 Imagem';
        mediaType = 'image';
        // Baixa mídia pela API da Evolution
        mediaUrl = await this.downloadMedia(msg.key?.id);
      } else if (msgContent?.videoMessage) {
        content = msgContent.videoMessage.caption || '🎥 Vídeo';
        mediaType = 'video';
      } else if (msgContent?.audioMessage) {
        content = '🎵 Áudio';
        mediaType = 'audio';
        mediaUrl = await this.downloadMedia(msg.key?.id);
      } else if (msgContent?.documentMessage) {
        const fileName = msgContent.documentMessage.fileName || 'Documento';
        content = '📄 ' + fileName;
        mediaType = 'document';
        try {
          mediaUrl = await this.downloadMedia(msg.key?.id);
          console.log('📄 Documento baixado:', fileName, mediaUrl ? 'OK' : 'FALHOU');
        } catch (e) {
          console.error('Erro ao baixar documento:', e.message);
        }
      } else if (msgContent?.stickerMessage) {
        content = '🏷️ Figurinha';
        mediaType = 'sticker';
      } else if (msgContent?.contactMessage) {
        content = '👤 Contato';
        mediaType = 'contact';
      } else if (msgContent?.locationMessage) {
        content = '📍 Localização';
        mediaType = 'location';
      } else {
        content = '[Mensagem não suportada]';
      }

      this.emit('message', {
        id: msg.key?.id || Date.now().toString(),
        phone,
        pushName,
        content,
        mediaType,
        mediaUrl,
        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
      });
    }
  }

  // Baixa mídia pela API da Evolution e salva no banco
  async downloadMedia(messageId) {
    if (!messageId) return null;
    try {
      // Tenta o formato da Evolution v2
      const result = await this.api('POST', 'chat/getBase64FromMediaMessage', {
        message: { key: { id: messageId } },
      });

      const base64 = result?.base64 || result?.data;
      if (base64) {
        const { queryRun } = require('./database');
        const mediaId = 'evo_' + messageId;
        const mime = result.mimetype || result.mimeType || 'application/octet-stream';
        await queryRun(
          "INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
          [mediaId, mime, base64]
        );
        console.log('📥 Mídia baixada:', mediaId, mime, Math.round(base64.length/1024) + 'KB');
        return `/media/${mediaId}`;
      }
      console.log('⚠️ Mídia sem base64:', messageId, JSON.stringify(result).slice(0, 200));
      return null;
    } catch (e) {
      console.error('Erro ao baixar mídia:', e.message);
      return null;
    }
  }

  // Busca foto de perfil do contato
  async getProfilePic(phone) {
    try {
      const number = phone.replace(/\D/g, '');
      const result = await this.api('POST', 'chat/fetchProfilePictureUrl', { number });
      return result?.profilePictureUrl || result?.url || null;
    } catch { return null; }
  }

  getStatus() {
    return {
      connected: this.connected,
      hasQR: !!this.qrCode,
      pairingCode: this.pairingCode,
    };
  }
}

module.exports = WhatsAppEvolution;
