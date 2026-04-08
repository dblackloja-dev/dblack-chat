const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const path = require('path');
const EventEmitter = require('events');

class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.qrCode = null;
    this.pairingCode = null;
    this.connected = false;
    this.connecting = false;
    this.authDir = path.join(__dirname, 'auth_info');
    this.phoneForPairing = null;
  }

  async connect(phoneNumber) {
    if (this.connecting) return;
    this.connecting = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      // Se já tem credenciais, não precisa de pairing
      const needsPairing = !state.creds.registered;

      this.socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined),
        },
        browser: Browsers.macOS('Chrome'),
        version: [2, 3000, 1033893291],
        printQRInTerminal: false,
        connectTimeoutMs: 60000,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      this.socket.ev.on('creds.update', saveCreds);

      // Solicita código de pareamento quando conectar ao servidor do WhatsApp
      let pairingRequested = false;
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Quando está conectando e precisa parear, solicita o código
        if (connection === 'connecting' && needsPairing && this.phoneForPairing && this.socket && !pairingRequested) {
          pairingRequested = true;
          // Pequeno delay para o socket estabilizar
          setTimeout(async () => {
            try {
              const code = await this.socket.requestPairingCode(this.phoneForPairing);
              this.pairingCode = code;
              this.emit('pairing_code', code);
              console.log('🔢 Código de pareamento:', code);
            } catch (err) {
              console.error('Erro ao gerar código de pareamento:', err.message);
              pairingRequested = false;
            }
          }, 3000);
        }

        // QR Code gerado (fallback caso não use pairing)
        if (qr) {
          this.qrCode = qr;
          this.connected = false;
          this.emit('qr', qr);
          console.log('📱 QR Code gerado');
        }

        if (connection === 'close') {
          this.connected = false;
          this.connecting = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log('❌ Conexão fechada. Código:', statusCode);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('🚪 WhatsApp deslogado.');
            this.qrCode = null;
            this.pairingCode = null;
            this.emit('disconnected');
          } else if (this.pairingCode || this.qrCode) {
            // Tem código/QR ativo, aguarda scan sem reconectar rápido
            console.log('⏳ Aguardando pareamento...');
            setTimeout(() => this.connect(this.phoneForPairing), 20000);
          } else {
            console.log('🔄 Reconectando em 10s...');
            setTimeout(() => this.connect(this.phoneForPairing), 10000);
          }
        }

        if (connection === 'open') {
          this.connected = true;
          this.connecting = false;
          this.qrCode = null;
          this.pairingCode = null;
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
      setTimeout(() => this.connect(this.phoneForPairing), 15000);
    }
  }

  // Inicia pareamento com número de telefone
  async startPairing(phone) {
    this.phoneForPairing = phone.replace(/\D/g, '');
    this.pairingCode = null;
    this.qrCode = null;

    // Limpa auth anterior
    const fs = require('fs');
    if (fs.existsSync(this.authDir)) {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    }

    this.connecting = false;
    await this.connect(this.phoneForPairing);
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
    return {
      connected: this.connected,
      hasQR: !!this.qrCode,
      pairingCode: this.pairingCode,
    };
  }
}

module.exports = WhatsAppClient;
