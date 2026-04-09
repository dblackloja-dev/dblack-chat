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
    const number = phone.replace(/\D/g, '');
    return this.api('POST', 'message/sendText', {
      number,
      text,
    });
  }

  async sendImage(phone, imageBuffer, caption = '') {
    const number = phone.replace(/\D/g, '');
    const base64 = imageBuffer.toString('base64');
    return this.api('POST', 'message/sendMedia', {
      number,
      mediatype: 'image',
      mimetype: 'image/jpeg',
      caption,
      media: base64,
      fileName: 'imagem.jpg',
    });
  }

  async sendAudio(phone, audioBuffer) {
    const number = phone.replace(/\D/g, '');
    const base64 = audioBuffer.toString('base64');
    return this.api('POST', 'message/sendWhatsAppAudio', {
      number,
      audio: base64,
    });
  }

  async sendDocument(phone, buffer, fileName, mimetype) {
    const number = phone.replace(/\D/g, '');
    const base64 = buffer.toString('base64');
    return this.api('POST', 'message/sendMedia', {
      number,
      mediatype: 'document',
      mimetype: mimetype || 'application/octet-stream',
      media: base64,
      fileName,
    });
  }

  // Processa webhook da Evolution
  processWebhook(body) {
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
        // Evolution pode mandar a URL da imagem no campo url ou base64 no campo media
        mediaUrl = msgContent.imageMessage.url || msg.media || null;
      } else if (msgContent?.videoMessage) {
        content = msgContent.videoMessage.caption || '🎥 Vídeo';
        mediaType = 'video';
      } else if (msgContent?.audioMessage) {
        content = '🎵 Áudio';
        mediaType = 'audio';
        if (msg.data?.media) mediaUrl = msg.data.media;
      } else if (msgContent?.documentMessage) {
        content = '📄 ' + (msgContent.documentMessage.fileName || 'Documento');
        mediaType = 'document';
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

  getStatus() {
    return {
      connected: this.connected,
      hasQR: !!this.qrCode,
      pairingCode: this.pairingCode,
    };
  }
}

module.exports = WhatsAppEvolution;
