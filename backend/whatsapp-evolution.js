// WhatsApp via Evolution API — substitui o Baileys
const EventEmitter = require('events');
require('dotenv').config();

// Variáveis obrigatórias — NUNCA hardcodar chaves no código
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'dblack-chat';

if (!EVOLUTION_URL || !EVOLUTION_KEY) {
  console.error('❌ ERRO: EVOLUTION_URL e EVOLUTION_KEY devem estar no .env!');
}

class WhatsAppEvolution extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.qrCode = null;
    this.pairingCode = null;

    // Cache LID → número real (evita chamadas repetidas à API)
    this.lidCache = new Map();

    // Contador de mensagens (só para monitoramento, sem bloqueio)
    this.msgCount = { hour: 0, day: 0, hourReset: Date.now(), dayReset: Date.now() };
  }

  // Verifica se pode enviar (sempre permite — sem rate limit)
  canSend() {
    const now = Date.now();
    if (now - this.msgCount.hourReset > 3600000) { this.msgCount.hour = 0; this.msgCount.hourReset = now; }
    if (now - this.msgCount.dayReset > 86400000) { this.msgCount.day = 0; this.msgCount.dayReset = now; }
    return true;
  }

  // Registra envio (só monitoramento)
  trackSend() {
    this.msgCount.hour++;
    this.msgCount.day++;
  }

  // Delay humanizado — inteligente: curto se enviou recente (ex: várias fotos), normal se não
  async humanDelay(isMedia = false) {
    const now = Date.now();
    const timeSinceLast = now - (this.lastSendTime || 0);
    let delay;
    if (timeSinceLast < 10000 && isMedia) {
      // Enviou algo há menos de 10s e é mídia = envio em lote, delay curto (300-800ms)
      delay = 300 + Math.random() * 500;
    } else if (timeSinceLast < 10000) {
      // Enviou texto recente = delay médio (1-2s)
      delay = 1000 + Math.random() * 1000;
    } else {
      // Primeira msg ou faz tempo = delay normal (2-4s)
      delay = 2000 + Math.random() * 2000;
    }
    this.lastSendTime = now;
    await new Promise(r => setTimeout(r, delay));
  }

  // Retorna os campos corretos para envio
  // LID e números normais usam o campo 'number' — o patch na Evolution cuida da validação
  _sendTarget(phone) {
    if (phone.endsWith('@lid')) {
      return { number: phone };
    }
    return { number: phone.replace(/\D/g, '') };
  }

  // Simula "digitando..." antes de enviar
  async sendPresence(phone, type = 'composing') {
    try {
      await this.api('POST', 'chat/sendPresence', { ...this._sendTarget(phone), presence: type, delay: 1000 });
    } catch {}
  }

  // Marca mensagem como lida (read receipt)
  async markAsRead(msgId, phone) {
    try {
      const remoteJid = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
      await this.api('POST', 'chat/markMessageAsRead', {
        readMessages: [{ remoteJid, id: msgId }],
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
        // Retenta até conectar (close pode virar open depois que a Evolution carrega)
        if (state === 'connecting' || state === 'close') {
          setTimeout(() => this.connect(), 10000);
        }
      }
      return status;
    } catch (e) {
      console.error('Erro ao verificar conexão Evolution:', e.message);
      // Retenta em caso de erro de rede (Evolution ainda subindo)
      setTimeout(() => this.connect(), 15000);
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

  // Envia botões interativos (máx 3 botões)
  async sendButtons(phone, title, description, buttons, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    if (isBot) {
      await this.sendPresence(phone, 'composing');
      await this.humanDelay();
    }
    this.trackSend();
    const result = await this.api('POST', 'message/sendButtons', {
      ...this._sendTarget(phone),
      title,
      description,
      buttons: buttons.map(b => ({ type: 'reply', buttonText: { displayText: b.text }, buttonId: b.id })),
    });
    result._waId = result?.key?.id || null;
    return result;
  }

  // isBot: true = IA/saudação automática (usa delay + digitando pra parecer humano)
  //        false = atendente humano (envia instantâneo, sem delay)
  async sendMessage(phone, text, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido. Tente novamente mais tarde.');
    if (isBot) {
      await this.sendPresence(phone, 'composing');
      await this.humanDelay();
    }
    this.trackSend();
    const result = await this.api('POST', 'message/sendText', { ...this._sendTarget(phone), text });
    result._waId = result?.key?.id || null;
    return result;
  }

  async sendImage(phone, imageBuffer, caption = '', { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    const base64 = imageBuffer.toString('base64');
    if (isBot) {
      await this.sendPresence(phone, 'composing');
      await this.humanDelay(true);
    }
    this.trackSend();
    const result = await this.api('POST', 'message/sendMedia', {
      ...this._sendTarget(phone), mediatype: 'image', mimetype: 'image/jpeg', caption, media: base64, fileName: 'imagem.jpg',
    });
    result._waId = result?.key?.id || null;
    return result;
  }

  async sendAudio(phone, audioBuffer, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    const base64 = audioBuffer.toString('base64');
    if (isBot) {
      await this.sendPresence(phone, 'recording');
      await this.humanDelay(true);
    }
    this.trackSend();
    const result = await this.api('POST', 'message/sendWhatsAppAudio', { ...this._sendTarget(phone), audio: base64, encoding: true });
    result._waId = result?.key?.id || null;
    return result;
  }

  async sendVideo(phone, videoBuffer, caption = '', { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    const base64 = videoBuffer.toString('base64');
    if (isBot) {
      await this.sendPresence(phone, 'composing');
      await this.humanDelay(true);
    }
    this.trackSend();
    const result = await this.api('POST', 'message/sendMedia', {
      ...this._sendTarget(phone), mediatype: 'video', mimetype: 'video/mp4', caption, media: base64, fileName: 'video.mp4',
    });
    result._waId = result?.key?.id || null;
    return result;
  }

  async sendDocument(phone, buffer, fileName, mimetype, { isBot = false } = {}) {
    if (!this.canSend()) throw new Error('Limite de mensagens atingido.');
    const base64 = buffer.toString('base64');
    if (isBot) {
      await this.sendPresence(phone, 'composing');
      await this.humanDelay(true);
    }
    this.trackSend();
    const result = await this.api('POST', 'message/sendMedia', {
      ...this._sendTarget(phone), mediatype: 'document', mimetype: mimetype || 'application/octet-stream', media: base64, fileName,
    });
    result._waId = result?.key?.id || null;
    return result;
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
    // Evolution v2 pode enviar como: messages.update, message.update
    if (event === 'messages.update' || event === 'message.update') {
      const updates = Array.isArray(body.data) ? body.data : [body.data];
      for (const upd of updates) {
        const msgId = upd?.key?.id || upd?.keyId || upd?.id;
        const rawStatus = upd?.update?.status || upd?.status || upd?.update?.messageStubType;
        if (msgId && rawStatus != null) {
          // Evolution v2 pode enviar status como texto OU número
          // Textos: SERVER_ACK, DELIVERY_ACK, READ, PLAYED
          // Números: 1=pendente, 2=enviado, 3=entregue, 4=lido, 5=reproduzido
          const statusMap = { 'SERVER_ACK': 1, 'DELIVERY_ACK': 2, 'READ': 3, 'PLAYED': 3 };
          let ack;
          if (typeof rawStatus === 'string') {
            ack = statusMap[rawStatus] || 1;
          } else {
            if (rawStatus >= 4) ack = 3;
            else if (rawStatus >= 3) ack = 2;
            else ack = 1;
          }
          this.emit('message_ack', { id: msgId, ack });
          console.log(`✓ Status msg ${msgId}: ${['','enviado','entregue','lido'][ack]} (raw: ${rawStatus})`);
        }
      }
      return;
    }

    // Evento de envio confirmado — marca como enviado (ack=1)
    if (event === 'send.message') {
      const msgId = body.data?.key?.id;
      if (msgId) {
        this.emit('message_ack', { id: msgId, ack: 1 });
        console.log(`✓ Msg enviada confirmada: ${msgId}`);
      }
      return;
    }

    if (event === 'messages.upsert') {
      // Se recebeu mensagem, está conectado (corrige estado se necessário)
      if (!this.connected) {
        this.connected = true;
        console.log('✅ WhatsApp conectado (detectado via mensagem recebida)');
        this.emit('connected');
      }
      const msg = body.data;
      if (!msg || msg.key?.fromMe) return;
      const jid = msg.key?.remoteJidAlt || msg.key?.remoteJid || '';
      if (jid === 'status@broadcast') return;
      if (jid.endsWith('@g.us')) return;

      // Resolve identificador do contato
      // Evolution v1 usa LID (@lid) como identificador principal
      // Usamos o LID completo (com @lid) como "phone" pra manter conversas separadas
      // O envio de mensagem também funciona com LID na Evolution
      let phone = '';
      let realPhone = '';
      const remoteJid = msg.key?.remoteJid || '';
      const remoteJidAlt = msg.key?.remoteJidAlt || '';
      if (jid.endsWith('@lid')) {
        phone = jid; // Usa o JID completo (ex: 36232444825602@lid)
        // Tenta extrair número real do JID alternativo
        const altJid = remoteJidAlt.endsWith('@s.whatsapp.net') ? remoteJidAlt : (remoteJid.endsWith('@s.whatsapp.net') ? remoteJid : '');
        if (altJid) realPhone = altJid.replace('@s.whatsapp.net', '');
      } else {
        phone = jid.replace('@s.whatsapp.net', '');
      }
      if (!phone || phone.length < 8) return;
      console.log('📨 Mensagem de:', phone, '| Nome:', msg.pushName, realPhone ? `| Tel real: ${realPhone}` : '| Sem tel real', `| JID: ${remoteJid} | JIDAlt: ${remoteJidAlt}`);

      const pushName = msg.pushName || '';
      let content = '';
      let mediaType = null;
      let mediaUrl = null;

      // Desembrulha mensagens efêmeras (chats com mensagens temporárias ativadas)
      let msgContent = msg.message;
      if (msgContent?.ephemeralMessage?.message) {
        msgContent = msgContent.ephemeralMessage.message;
      }

      if (msgContent?.conversation) {
        content = msgContent.conversation;
      } else if (msgContent?.extendedTextMessage?.text) {
        content = msgContent.extendedTextMessage.text;
      } else if (msgContent?.imageMessage) {
        content = msgContent.imageMessage.caption || '📷 Imagem';
        mediaType = 'image';
        // Baixa mídia pela API da Evolution (precisa do remoteJid)
        mediaUrl = await this.downloadMedia(msg.key?.id, msg.key?.remoteJid);
      } else if (msgContent?.videoMessage) {
        content = msgContent.videoMessage.caption || '🎥 Vídeo';
        mediaType = 'video';
        mediaUrl = await this.downloadMedia(msg.key?.id, msg.key?.remoteJid);
      } else if (msgContent?.audioMessage) {
        content = '🎵 Áudio';
        mediaType = 'audio';
        mediaUrl = await this.downloadMedia(msg.key?.id, msg.key?.remoteJid);
      } else if (msgContent?.documentMessage) {
        const fileName = msgContent.documentMessage.fileName || 'Documento';
        content = '📄 ' + fileName;
        mediaType = 'document';
        try {
          mediaUrl = await this.downloadMedia(msg.key?.id, msg.key?.remoteJid);
          console.log('📄 Documento baixado:', fileName, mediaUrl ? 'OK' : 'FALHOU');
        } catch (e) {
          console.error('Erro ao baixar documento:', e.message);
        }
      } else if (msgContent?.stickerMessage) {
        content = '🏷️ Figurinha';
        mediaType = 'sticker';
      } else if (msgContent?.contactMessage || msgContent?.contactsArrayMessage) {
        content = '👤 Contato';
        mediaType = 'contact';
      } else if (msgContent?.locationMessage || msgContent?.liveLocationMessage) {
        content = '📍 Localização';
        mediaType = 'location';
      } else if (msgContent?.reactionMessage) {
        // Reação a mensagem — ignora (não é mensagem real)
        return;
      } else if (msgContent?.protocolMessage || msgContent?.senderKeyDistributionMessage) {
        // Mensagem de protocolo interno — ignora
        return;
      } else if (msgContent?.viewOnceMessage || msgContent?.viewOnceMessageV2) {
        // "Visualização única" — tenta extrair o conteúdo interno
        const inner = msgContent.viewOnceMessage?.message || msgContent.viewOnceMessageV2?.message;
        if (inner?.imageMessage) {
          content = inner.imageMessage.caption || '📷 Foto (visualização única)';
          mediaType = 'image';
          mediaUrl = await this.downloadMedia(msg.key?.id, msg.key?.remoteJid);
        } else if (inner?.videoMessage) {
          content = '🎥 Vídeo (visualização única)';
          mediaType = 'video';
        } else if (inner?.audioMessage) {
          content = '🎵 Áudio (visualização única)';
          mediaType = 'audio';
        } else {
          content = '👁️ Mensagem de visualização única';
        }
      } else if (msgContent?.listResponseMessage) {
        content = msgContent.listResponseMessage.title || msgContent.listResponseMessage.singleSelectReply?.selectedRowId || '📋 Resposta de lista';
      } else if (msgContent?.buttonsResponseMessage) {
        content = msgContent.buttonsResponseMessage.selectedDisplayText || '🔘 Resposta de botão';
      } else if (msgContent?.templateButtonReplyMessage) {
        content = msgContent.templateButtonReplyMessage.selectedDisplayText || '🔘 Resposta de botão';
      } else if (msgContent?.editedMessage) {
        content = msgContent.editedMessage?.message?.conversation || msgContent.editedMessage?.message?.extendedTextMessage?.text || '✏️ Mensagem editada';
      } else if (msgContent?.pollCreationMessage || msgContent?.pollCreationMessageV3) {
        content = '📊 Enquete';
      } else if (msgContent?.pollUpdateMessage) {
        // Voto em enquete — ignora
        return;
      } else {
        // Tipo desconhecido — loga para adicionar suporte depois
        const tipos = msgContent ? Object.keys(msgContent).filter(k => k !== 'messageContextInfo') : [];
        console.log('⚠️ Tipo de msg não suportado:', tipos.join(', '), '| De:', phone);
        content = tipos.length > 0 ? `[${tipos[0].replace('Message', '')}]` : '[Mensagem]';
      }

      this.emit('message', {
        id: msg.key?.id || Date.now().toString(),
        phone,
        realPhone,
        pushName,
        content,
        mediaType,
        mediaUrl,
        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
      });
    }
  }

  // Baixa mídia pela API da Evolution e salva no banco
  async downloadMedia(messageId, remoteJid) {
    if (!messageId) return null;
    try {
      // Aguarda a Evolution persistir a mensagem antes de baixar
      await new Promise(r => setTimeout(r, 2000));
      // Evolution v2: precisa do remoteJid no key para encontrar a mensagem
      const key = { id: messageId };
      if (remoteJid) key.remoteJid = remoteJid;
      let result = await this.api('POST', 'chat/getBase64FromMediaMessage', {
        message: { key },
      });
      // Retry uma vez se não encontrou (pode demorar mais pra persistir)
      if (!result?.base64 && !result?.data) {
        await new Promise(r => setTimeout(r, 3000));
        result = await this.api('POST', 'chat/getBase64FromMediaMessage', {
          message: { key },
        });
      }

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

  // Resolve LID para número real via Evolution API v2
  async resolvePhoneFromLid(lid) {
    if (!lid || !lid.endsWith('@lid')) return null;

    // Checa cache primeiro
    if (this.lidCache.has(lid)) return this.lidCache.get(lid);

    // Evolution API v2 com LID: findContacts e findChats retornam o próprio LID
    // como remoteJid — não tem mapeamento LID→número real disponível via API.
    // O número real só aparece se o webhook enviar remoteJidAlt com @s.whatsapp.net.

    // Marca no cache como null para não tentar de novo em cada mensagem
    this.lidCache.set(lid, null);
    return null;
  }

  // Busca foto de perfil do contato
  async getProfilePic(phone) {
    try {
      const result = await this.api('POST', 'chat/fetchProfilePictureUrl', this._sendTarget(phone));
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
