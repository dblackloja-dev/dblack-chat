const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const path = require('path');
const EventEmitter = require('events');

class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.qrCode = null;
    this.connected = false;
    this.connecting = false;
    this.authDir = path.join(__dirname, 'auth_info');
  }

  async connect() {
    if (this.connecting) return;
    this.connecting = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined),
        },
        browser: ['D\'Black Chat', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      // Salva credenciais quando atualizar
      this.socket.ev.on('creds.update', saveCreds);

      // Evento de conexão
      this.socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.connected = false;
          this.emit('qr', qr);
          console.log('📱 QR Code gerado — escaneie com o WhatsApp');
        }

        if (connection === 'close') {
          this.connected = false;
          this.connecting = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log('❌ Conexão fechada. Código:', statusCode);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('🚪 WhatsApp deslogado. Escaneie o QR novamente.');
            this.qrCode = null;
            this.emit('disconnected');
          } else if (statusCode === 405 || statusCode === DisconnectReason.connectionReplaced) {
            // 405 = aguardando scan do QR, não reconectar imediatamente
            console.log('⏳ Aguardando escaneamento do QR Code...');
            if (!this.qrCode) {
              setTimeout(() => this.connect(), 15000);
            }
          } else {
            console.log('🔄 Reconectando em 10s...');
            setTimeout(() => this.connect(), 10000);
          }
        }

        if (connection === 'open') {
          this.connected = true;
          this.connecting = false;
          this.qrCode = null;
          console.log('✅ WhatsApp conectado!');
          this.emit('connected');
        }
      });

      // Recebe mensagens
      this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (msg.key.fromMe) continue;
          if (msg.key.remoteJid === 'status@broadcast') continue;
          if (msg.key.remoteJid?.endsWith('@g.us')) continue;

          const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '');
          const pushName = msg.pushName || '';

          let content = '';
          let mediaType = null;

          if (msg.message?.conversation) {
            content = msg.message.conversation;
          } else if (msg.message?.extendedTextMessage?.text) {
            content = msg.message.extendedTextMessage.text;
          } else if (msg.message?.imageMessage) {
            content = msg.message.imageMessage.caption || '📷 Imagem';
            mediaType = 'image';
          } else if (msg.message?.videoMessage) {
            content = msg.message.videoMessage.caption || '🎥 Vídeo';
            mediaType = 'video';
          } else if (msg.message?.audioMessage) {
            content = '🎵 Áudio';
            mediaType = 'audio';
          } else if (msg.message?.documentMessage) {
            content = '📄 ' + (msg.message.documentMessage.fileName || 'Documento');
            mediaType = 'document';
          } else if (msg.message?.stickerMessage) {
            content = '🏷️ Figurinha';
            mediaType = 'sticker';
          } else if (msg.message?.contactMessage) {
            content = '👤 Contato';
            mediaType = 'contact';
          } else if (msg.message?.locationMessage) {
            content = '📍 Localização';
            mediaType = 'location';
          } else {
            content = '[Mensagem não suportada]';
          }

          this.emit('message', {
            id: msg.key.id,
            phone,
            pushName,
            content,
            mediaType,
            timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
          });
        }
      });

    } catch (err) {
      console.error('Erro ao conectar WhatsApp:', err);
      this.connecting = false;
      setTimeout(() => this.connect(), 10000);
    }
  }

  async sendMessage(phone, text) {
    if (!this.connected || !this.socket) throw new Error('WhatsApp não conectado');
    const jid = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
    await this.socket.sendMessage(jid, { text });
  }

  async sendImage(phone, imageBuffer, caption = '') {
    if (!this.connected || !this.socket) throw new Error('WhatsApp não conectado');
    const jid = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
    await this.socket.sendMessage(jid, { image: imageBuffer, caption });
  }

  getStatus() {
    return { connected: this.connected, hasQR: !!this.qrCode };
  }
}

module.exports = WhatsAppClient;
