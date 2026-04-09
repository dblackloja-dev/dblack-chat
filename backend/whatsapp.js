const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
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

      this.socket.ev.on('creds.update', async () => {
        await saveCreds();
        // Faz backup dos arquivos de auth no banco
        this.backupAuthToDB().catch(() => {});
      });

      // Solicita código de pareamento quando conectar ao servidor do WhatsApp
      let pairingRequested = false;
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Quando está conectando e precisa parear, solicita o código
        if (connection === 'connecting' && needsPairing && this.phoneForPairing && this.socket && !pairingRequested) {
          pairingRequested = true;
          // Delay para o socket estabilizar (maior em produção)
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
          }, 5000);
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
          const reason = lastDisconnect?.error?.message || 'desconhecido';
          console.log(`❌ Conexão fechada. Código: ${statusCode} | Motivo: ${reason}`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('🚪 WhatsApp deslogado. Precisa parear novamente.');
            this.qrCode = null;
            this.pairingCode = null;
            this.emit('disconnected');
          } else if (statusCode === DisconnectReason.restartRequired) {
            console.log('🔄 Restart necessário, reconectando imediatamente...');
            this.connect(this.phoneForPairing);
          } else if (this.pairingCode || this.qrCode) {
            console.log('⏳ Aguardando pareamento...');
            setTimeout(() => this.connect(this.phoneForPairing), 20000);
          } else {
            // Backoff progressivo: 5s, 10s, 20s
            const delay = Math.min(5000 * Math.pow(2, this.retryCount || 0), 60000);
            this.retryCount = (this.retryCount || 0) + 1;
            console.log(`🔄 Reconectando em ${delay / 1000}s (tentativa ${this.retryCount})...`);
            setTimeout(() => this.connect(this.phoneForPairing), delay);
          }
        }

        if (connection === 'open') {
          this.connected = true;
          this.connecting = false;
          this.retryCount = 0;
          this.qrCode = null;
          this.pairingCode = null;
          console.log('✅ WhatsApp conectado!');
          this.emit('connected');
          // Backup das credenciais no banco
          this.backupAuthToDB().catch(() => {});
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
            mediaType = 'image';
            content = msg.message.imageMessage.caption || '📷 Imagem';
            try {
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              const { queryRun } = require('./database');
              const mediaId = 'img_' + msg.key.id;
              const base64 = buffer.toString('base64');
              await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [mediaId, 'image/jpeg', base64]);
              content = `/media/${mediaId}`;
              if (msg.message.imageMessage.caption) content += `|${msg.message.imageMessage.caption}`;
              // Salva também em arquivo local pra IA analisar
              const imgDir = path.join(__dirname, 'uploads', 'images');
              if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
              fs.writeFileSync(path.join(imgDir, `${msg.key.id}.jpg`), buffer);
            } catch (e) {
              console.error('Erro ao baixar imagem:', e.message);
              content = msg.message.imageMessage.caption || '📷 Imagem';
            }
          } else if (msg.message?.videoMessage) {
            content = msg.message.videoMessage.caption || '🎥 Vídeo';
            mediaType = 'video';
          } else if (msg.message?.audioMessage) {
            mediaType = 'audio';
            try {
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              const { queryRun } = require('./database');
              const mediaId = 'aud_' + msg.key.id;
              const base64 = buffer.toString('base64');
              await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [mediaId, 'audio/ogg', base64]);
              content = `/media/${mediaId}`;
            } catch (e) {
              console.error('Erro ao baixar áudio:', e.message);
              content = '🎵 Áudio (erro ao baixar)';
            }
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
    if (fs.existsSync(this.authDir)) {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    }
    console.log('🗑️ Credenciais anteriores removidas');

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

  // Salva todos os arquivos de auth no banco como backup
  async backupAuthToDB() {
    try {
      const { queryRun } = require('./database');
      await queryRun("CREATE TABLE IF NOT EXISTS wa_auth (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      if (!fs.existsSync(this.authDir)) return;
      const files = fs.readdirSync(this.authDir);
      for (const file of files) {
        const content = fs.readFileSync(path.join(this.authDir, file), 'utf8');
        await queryRun(
          "INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
          [file, content]
        );
      }
      console.log(`💾 Auth backup: ${files.length} arquivos salvos no banco`);
    } catch (e) {
      console.error('Erro ao fazer backup auth:', e.message);
    }
  }

  // Restaura arquivos de auth do banco
  async restoreAuthFromDB() {
    try {
      const { queryAll, queryRun } = require('./database');
      await queryRun("CREATE TABLE IF NOT EXISTS wa_auth (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      const rows = await queryAll("SELECT key, value FROM wa_auth");
      if (rows.length === 0) return false;
      if (!fs.existsSync(this.authDir)) fs.mkdirSync(this.authDir, { recursive: true });
      for (const row of rows) {
        fs.writeFileSync(path.join(this.authDir, row.key), row.value, 'utf8');
      }
      console.log(`📥 Auth restaurado do banco: ${rows.length} arquivos`);
      return true;
    } catch (e) {
      console.error('Erro ao restaurar auth:', e.message);
      return false;
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

module.exports = WhatsAppClient;
