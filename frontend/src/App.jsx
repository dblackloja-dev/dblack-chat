import { useState, useEffect, useRef, useCallback } from 'react';
import api from './api';
import SalesPanel from './SalesPanel';
import Dashboard from './modules/Dashboard';
import Contacts from './modules/Contacts';
import QuickRepliesModule from './modules/QuickReplies';
import Reports from './modules/Reports';
import Settings from './modules/Settings';
import AIAgents from './modules/AIAgents';
import AIMetrics from './modules/AIMetrics';

// ─── CORES WHATSAPP WEB (TEMA CLARO) ───
const W = {
  bgApp: '#eae6df',      // fundo geral
  bgPanel: '#ffffff',    // fundo painel lateral
  bgChat: '#efeae2',     // fundo área de chat
  bgHeader: '#f0f2f5',   // header
  bgInput: '#ffffff',    // campo de input
  bgMsg: '#ffffff',      // bolha mensagem recebida
  bgMsgMe: '#d9fdd3',    // bolha mensagem enviada (verde claro)
  bgHover: '#f5f6f6',    // hover na lista
  bgActive: '#f0f2f5',   // conversa selecionada
  border: '#e9edef',     // bordas
  borderLight: '#d1d7db',
  txt: '#111b21',        // texto principal
  txt2: '#667781',       // texto secundário
  green: '#00a884',      // verde WhatsApp
  greenLight: '#25d366', // verde claro
  blue: '#53bdeb',       // azul check
  red: '#ea0038',        // vermelho
  gold: '#c77d00',       // dourado D'Black (mais escuro pra tema claro)
  search: '#f0f2f5',     // fundo busca
  teal: '#008069',       // teal WhatsApp
};

const fmt = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const now = new Date();
  const isToday = dt.toDateString() === now.toDateString();
  if (isToday) return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const fmtPhone = (p) => {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  return p;
};

// ─── ÍCONES SVG ───
const Icons = {
  send: <svg viewBox="0 0 24 24" width="24" height="24" fill="#667781"><path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/></svg>,
  search: <svg viewBox="0 0 24 24" width="20" height="20" fill="#667781"><path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.386 5.207 5.207 0 1 0-5.207 5.208 5.183 5.183 0 0 0 3.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.808 0a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>,
  back: <svg viewBox="0 0 24 24" width="24" height="24" fill={W.txt2}><path d="M12 4l1.4 1.4L7.8 11H20v2H7.8l5.6 5.6L12 20l-8-8 8-8z"/></svg>,
  menu: <svg viewBox="0 0 24 24" width="24" height="24" fill={W.txt2}><path d="M12 7a2 2 0 1 0-.001-4.001A2 2 0 0 0 12 7zm0 2a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 9zm0 6a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 15z"/></svg>,
  check: <svg viewBox="0 0 16 15" width="16" height="15" fill={W.blue}><path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.358-.325a.32.32 0 0 0-.484.032l-.378.48a.418.418 0 0 0 .036.54l1.32 1.267a.32.32 0 0 0 .484-.034l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.032L1.892 7.77a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .006.514l3.255 3.185a.32.32 0 0 0 .484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"/></svg>,
  attach: <svg viewBox="0 0 24 24" width="24" height="24" fill={W.txt2}><path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 0 0 3.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.501.501 1.134.809 1.751.853.605.043 1.198-.17 1.638-.611l5.845-5.845c.195-.195.195-.512 0-.707a.5.5 0 0 0-.707 0l-5.845 5.845a.909.909 0 0 1-.667.252 1.462 1.462 0 0 1-1.048-.567c-.574-.574-.61-1.277-.112-1.773l7.916-7.916c.987-.987 2.694-.884 3.811.234.545.544.896 1.234.951 1.896.063.712-.185 1.397-.697 1.909l-9.548 9.548a3.585 3.585 0 0 1-2.559 1.06A3.59 3.59 0 0 1 4.17 18.12a3.585 3.585 0 0 1-1.06-2.559v-.003c0-.97.379-1.881 1.06-2.563l7.589-7.588a.5.5 0 0 0-.707-.707l-7.59 7.588a4.57 4.57 0 0 0-1.346 3.26z"/></svg>,
};

// ─── NOTIFICAÇÃO SONORA ───
const playNotif = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 800; gain.gain.value = 0.12;
    osc.start(); osc.stop(ctx.currentTime + 0.12);
    setTimeout(() => { const o2 = ctx.createOscillator(); o2.connect(gain); o2.frequency.value = 1000; o2.start(); o2.stop(ctx.currentTime + 0.12); }, 150);
  } catch {}
};

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [tab, setTab] = useState('atendendo');
  const [waStatus, setWaStatus] = useState({ connected: false, qr: null });
  const [users, setUsers] = useState([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [spyConv, setSpyConv] = useState(null);
  const [spyMsgs, setSpyMsgs] = useState([]);
  const [showSales, setShowSales] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentModule, setCurrentModule] = useState('chat');
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768 ? true : false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [mobileView, setMobileView] = useState('list'); // 'list' ou 'chat' (só no mobile)
  const [customerInfo, setCustomerInfo] = useState(null);
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);
  const fileInputRef = useRef(null);

  // Detecta mobile
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ─── NOTIFICAÇÃO PUSH ───
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const sendPushNotif = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/manifest.json', tag: 'dblack-chat' });
    }
  };

  // ─── TAGS ───
  const tagOptions = [
    { tag: 'urgente', color: '#ea0038' },
    { tag: 'compra', color: '#00a884' },
    { tag: 'troca', color: '#ff9800' },
    { tag: 'suporte', color: '#2196f3' },
    { tag: 'vip', color: '#9c27b0' },
  ];
  const [convTags, setConvTags] = useState([]);
  const [showTagMenu, setShowTagMenu] = useState(false);

  const loadTags = async (convId) => {
    try { setConvTags(await api.getConvTags(convId)); } catch { setConvTags([]); }
  };

  const addTag = async (tag, color) => {
    if (!activeConv) return;
    try {
      await api.addConvTag(activeConv.id, { tag, color });
      loadTags(activeConv.id);
      setShowTagMenu(false);
    } catch {}
  };

  const removeTag = async (tagId) => {
    if (!activeConv) return;
    try { await api.removeConvTag(activeConv.id, tagId); loadTags(activeConv.id); } catch {}
  };

  // ─── BUSCA DE MENSAGENS ───
  const [msgSearch, setMsgSearch] = useState('');
  const [msgSearchResults, setMsgSearchResults] = useState([]);
  const [showMsgSearch, setShowMsgSearch] = useState(false);

  const doMsgSearch = async (q) => {
    setMsgSearch(q);
    if (q.length < 2) { setMsgSearchResults([]); return; }
    try { setMsgSearchResults(await api.searchMessages(q)); } catch { setMsgSearchResults([]); }
  };

  // ─── HISTÓRICO DO CLIENTE ───
  const [convHistory, setConvHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = async (phone) => {
    try { setConvHistory(await api.getConvHistory(phone)); setShowHistory(true); } catch {}
  };

  // ─── RESPOSTAS RÁPIDAS ───
  const quickReplies = [
    { label: '👋 Saudação', text: 'Olá! Tudo bem? Como posso te ajudar?' },
    { label: '⏰ Horário', text: '⏰ Nosso horário de atendimento:\nSeg a Sex: 9h às 18h\nSábado: 9h às 13h' },
    { label: '📍 Endereço', text: '📍 Nossas lojas:\n\n🏪 D\'Black Divino-MG\n🏪 D\'Black São João-MG\n🏪 D\'Black Matriz - Ribeirão de São Domingos-MG' },
    { label: '💳 Pagamento', text: '💳 Formas de pagamento:\n\n✅ PIX\n✅ Cartão de Crédito (até 6x)\n✅ Cartão de Débito\n✅ Dinheiro\n✅ Crediário (clientes cadastrados)' },
    { label: '📦 Frete', text: '📦 Enviamos para todo o Brasil!\nFrete calculado no momento da compra.\nEntrega expressa disponível para a região.' },
    { label: '🔄 Troca', text: '🔄 Política de troca:\nVocê tem até 7 dias para trocar.\nProduto deve estar com etiqueta e sem uso.\nTraga na loja mais próxima ou entre em contato.' },
    { label: '✅ Obrigado', text: 'Muito obrigado pela preferência! 🖤\nQualquer dúvida, estamos à disposição.\nSiga @d_blackloja no Instagram! 📱' },
    { label: '⏳ Aguarde', text: 'Um momento, por favor! Já estou verificando para você. ⏳' },
  ];

  // ─── ADMIN: parear WhatsApp ───
  const [pairPhone, setPairPhone] = useState('');
  const [pairing, setPairing] = useState(false);
  const doPair = async () => {
    if (!pairPhone.trim() || pairing) return;
    setPairing(true);
    try {
      const result = await api.pairWhatsApp(pairPhone.trim());
      if (result.pairingCode) setWaStatus(prev => ({ ...prev, pairingCode: result.pairingCode }));
    } catch (e) { console.error('Erro ao parear:', e); }
    setPairing(false);
  };

  // Usuários vêm do ERP (somente leitura)

  // ─── SESSION ───
  useEffect(() => {
    api.me().then(u => { if (u?.id) setUser(u); }).catch(() => {}).finally(() => setChecking(false));
  }, []);

  const doLogin = async () => {
    try {
      setLoginError('');
      const data = await api.login(loginEmail, loginPass);
      setUser(data);
    } catch (e) { setLoginError(e.message || 'Erro ao fazer login'); }
  };
  const doLogout = () => { api.logout(); setUser(null); };

  // ─── LOAD DATA ───
  const loadConversations = useCallback(async () => {
    try { setConversations(await api.getConversations()); } catch {}
  }, []);

  const loadMessages = useCallback(async (convId) => {
    try { setMessages(await api.getMessages(convId)); } catch {}
  }, []);

  // ─── WEBSOCKET ───
  useEffect(() => {
    if (!user) return;
    loadConversations();
    api.getWhatsAppStatus().then(setWaStatus).catch(() => {});
    if (user.role === 'admin') api.getUsers().then(setUsers).catch(() => {});

    const token = api.getToken();
    const WS_HOST = window.location.hostname === 'localhost'
      ? `ws://${window.location.host}`
      : 'wss://dblack-chat-production.up.railway.app';
    const wsUrl = `${WS_HOST}/ws?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const { event, data } = JSON.parse(evt.data);
        if (event === 'new_message') {
          setConversations(prev => {
            const exists = prev.find(c => c.id === data.conversation.id);
            if (exists) return prev.map(c => c.id === data.conversation.id ? { ...c, ...data.conversation } : c);
            return [data.conversation, ...prev];
          });
          setActiveConv(cur => {
            if (cur?.id === data.conversation.id) setMessages(prev => prev.find(m => m.id === data.message.id) ? prev : [...prev, data.message]);
            return cur;
          });
          setSpyConv(cur => {
            if (cur?.id === data.conversation.id) setSpyMsgs(prev => prev.find(m => m.id === data.message.id) ? prev : [...prev, data.message]);
            return cur;
          });
          if (!data.message.from_me) {
            playNotif();
            if (document.hidden) sendPushNotif(data.message.sender || 'Nova mensagem', data.message.content?.slice(0, 100) || 'Nova mensagem');
          }
        }
        if (event === 'conversation_updated') {
          setConversations(prev => prev.map(c => c.id === data.id ? { ...c, ...data } : c));
          setActiveConv(cur => cur?.id === data.id ? { ...cur, ...data } : cur);
        }
        if (event === 'qr') setWaStatus(prev => ({ ...prev, qr: data.qr, connected: false }));
        if (event === 'pairing_code') setWaStatus(prev => ({ ...prev, pairingCode: data.code }));
        if (event === 'wa_status') setWaStatus(prev => ({ ...prev, connected: data.connected, qr: data.connected ? null : prev.qr, pairingCode: data.connected ? null : prev.pairingCode }));
      } catch {}
    };
    ws.onclose = () => { setTimeout(() => { if (user) loadConversations(); }, 3000); };
    const interval = setInterval(loadConversations, 15000);
    return () => { ws.close(); clearInterval(interval); };
  }, [user?.id]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ─── ACTIONS ───
  const openConversation = async (conv) => {
    setActiveConv(conv); setSpyConv(null); setShowSales(false); setShowAdmin(false); setShowHistory(false); setShowMsgSearch(false);
    if (isMobile) setMobileView('chat');
    await loadMessages(conv.id);
    loadTags(conv.id);
    if (conv.phone) {
      api.getCustomerDetails(conv.phone).then(c => {
        if (c && !c.not_found) setCustomerInfo(c);
        else setCustomerInfo(null);
      }).catch(() => setCustomerInfo(null));
    }
  };

  const goBackToList = () => { setMobileView('list'); setActiveConv(null); setSpyConv(null); setShowSales(false); setShowCustomerPanel(false); };
  const spyConversation = async (conv) => { setSpyConv(conv); setActiveConv(null); if (isMobile) setMobileView('chat'); try { setSpyMsgs(await api.getMessages(conv.id)); } catch {} };
  const acceptConversation = async (convId) => { try { const conv = await api.acceptConversation(convId); setConversations(prev => prev.map(c => c.id === convId ? conv : c)); setSpyConv(null); setActiveConv(conv); if (isMobile) setMobileView('chat'); await loadMessages(convId); setTab('atendendo'); } catch {} };
  const finishConversation = async (convId) => { if (!confirm('Finalizar este atendimento?')) return; try { await api.finishConversation(convId); if (activeConv?.id === convId) { setActiveConv(null); setMessages([]); } await loadConversations(); } catch {} };
  const transferConversation = async (convId) => { if (!confirm('Devolver para a fila?')) return; try { await api.transferConversation(convId); if (activeConv?.id === convId) { setActiveConv(null); setMessages([]); } await loadConversations(); } catch {} };
  const sendMessage = async () => { if (!msgInput.trim() || !activeConv) return; const text = msgInput.trim(); setMsgInput(''); try { await api.sendMessage({ conversation_id: activeConv.id, content: text }); } catch { setMsgInput(text); } };
  const sendQuickReply = async (text) => { if (!activeConv) return; setShowQuickReplies(false); try { await api.sendMessage({ conversation_id: activeConv.id, content: text }); } catch {} };
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv) return;
    const caption = prompt('Legenda da imagem (opcional):') || '';
    try { await api.sendImage(activeConv.id, file, caption); } catch (err) { alert('Erro ao enviar imagem: ' + err.message); }
    e.target.value = '';
  };

  // ─── GRAVAÇÃO DE ÁUDIO ───
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  const startRecording = async () => {
    if (!activeConv) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/ogg' });
        if (blob.size > 1000) {
          try { await api.sendAudio(activeConv.id, blob); } catch (err) { alert('Erro ao enviar áudio: ' + err.message); }
        }
      };
      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { alert('Não foi possível acessar o microfone'); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      setRecording(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ─── FILTROS ───
  const aguardando = conversations.filter(c => c.status === 'aguardando');
  const atendendo = conversations.filter(c => c.status === 'atendendo');
  const myAtendendo = atendendo.filter(c => c.agent_id === user?.id);
  const finalizados = conversations.filter(c => c.status === 'finalizado');

  const filteredConvs = (list) => {
    if (!searchTerm) return list;
    const s = searchTerm.toLowerCase();
    return list.filter(c => (c.customer_push_name || '').toLowerCase().includes(s) || (c.phone || '').includes(s) || (c.last_message || '').toLowerCase().includes(s));
  };

  // ─── CHECKING ───
  if (checking) return <div style={{ minHeight: '100vh', background: W.bgApp, display: 'flex', alignItems: 'center', justifyContent: 'center', color: W.txt2, fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif' }}>Carregando...</div>;

  // ─── LOGIN ───
  if (!user) return (
    <div style={{ minHeight: '100vh', background: W.teal, display: 'flex', flexDirection: 'column', fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif' }}>
      <div style={{ height: 222, background: W.teal }} />
      <div style={{ flex: 1, background: '#dadbd5', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', marginTop: -100 }}>
        <div style={{ width: 380, background: '#fff', borderRadius: 4, padding: 28, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 28, fontWeight: 300, color: '#41525d', marginBottom: 4 }}>D'Black Chat</div>
            <div style={{ fontSize: 13, color: '#667781' }}>Faça login para atender</div>
          </div>
          <input style={loginInput} placeholder="Nome ou e-mail" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()} />
          <input style={loginInput} type="password" placeholder="Senha" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()} />
          {loginError && <div style={{ color: W.red, fontSize: 13, marginBottom: 10 }}>{loginError}</div>}
          <button style={{ width: '100%', padding: '12px', borderRadius: 4, border: 'none', background: W.teal, color: '#fff', fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }} onClick={doLogin}>Entrar</button>
        </div>
      </div>
    </div>
  );

  // ─── SIDEBAR NAV ───
  const SI = {
    dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    chat: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>,
    contacts: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    quickReplies: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="13" y2="13"/></svg>,
    aiAgents: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
    reports: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  };
  const navItems = [
    { id: 'dashboard', icon: SI.dashboard, label: 'Dashboard' },
    { id: 'chat', icon: SI.chat, label: 'Conversas' },
    { id: 'contacts', icon: SI.contacts, label: 'Contatos' },
    { id: 'quick-replies', icon: SI.quickReplies, label: 'Respostas Rápidas' },
  ];
  const adminItems = [
    { id: 'ai-agents', icon: SI.aiAgents, label: 'Agentes de IA' },
    { id: 'ai-metrics', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>, label: 'Métricas IA' },
    { id: 'reports', icon: SI.reports, label: 'Relatórios' },
    { id: 'settings', icon: SI.settings, label: 'Configurações' },
  ];

  // ─── MAIN ───
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: W.bgApp, fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif', color: W.txt, overflow: 'hidden' }}>

      {/* ═══ SIDEBAR NAVEGAÇÃO ═══ */}
      <div style={{
        width: isMobile ? (sidebarOpen ? 260 : 0) : (sidebarOpen ? 200 : 56),
        background: '#1f2c33', display: 'flex', flexDirection: 'column', transition: 'width .2s', flexShrink: 0, overflow: 'hidden',
        position: isMobile ? 'fixed' : 'relative', top: 0, left: 0, bottom: 0, zIndex: isMobile ? 100 : 1,
      }}>
      {/* Overlay pra fechar sidebar no mobile */}
      {isMobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', top: 0, left: 260, right: 0, bottom: 0, background: 'rgba(0,0,0,.4)', zIndex: 99 }} />}
        {/* Toggle */}
        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', color: '#aebac1', cursor: 'pointer', padding: '16px 16px 8px', textAlign: sidebarOpen ? 'right' : 'center', fontSize: 16 }}>
          {sidebarOpen ? '◀' : '▶'}
        </button>

        {/* Logo */}
        {sidebarOpen && <div style={{ padding: '4px 16px 16px', fontSize: 14, fontWeight: 700, color: '#e9edef', letterSpacing: 1 }}>D'BLACK</div>}

        {/* Nav items */}
        {navItems.map(item => (
          <button key={item.id} onClick={() => { setCurrentModule(item.id); if (isMobile) setSidebarOpen(false); setMobileView('list'); }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: sidebarOpen ? '12px 16px' : '12px 0', background: currentModule === item.id ? 'rgba(0,168,132,.15)' : 'transparent', border: 'none', borderLeft: currentModule === item.id ? '3px solid #00a884' : '3px solid transparent', color: currentModule === item.id ? '#00a884' : '#aebac1', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: currentModule === item.id ? 600 : 400, width: '100%', textAlign: 'left', justifyContent: sidebarOpen ? 'flex-start' : 'center' }}>
            <span style={{ flexShrink: 0, display: 'flex' }}>{item.icon}</span>
            {sidebarOpen && <span>{item.label}</span>}
          </button>
        ))}

        {/* Divider + Admin */}
        {user.role === 'admin' && <>
          <div style={{ borderTop: '1px solid #2a3942', margin: '12px 16px' }} />
          {sidebarOpen && <div style={{ padding: '4px 16px 8px', fontSize: 10, fontWeight: 700, color: '#667781', letterSpacing: 2 }}>ADMINISTRAÇÃO</div>}
          {adminItems.map(item => (
            <button key={item.id} onClick={() => { setCurrentModule(item.id); if (isMobile) setSidebarOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: sidebarOpen ? '12px 16px' : '12px 0', background: currentModule === item.id ? 'rgba(0,168,132,.15)' : 'transparent', border: 'none', borderLeft: currentModule === item.id ? '3px solid #00a884' : '3px solid transparent', color: currentModule === item.id ? '#00a884' : '#aebac1', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: currentModule === item.id ? 600 : 400, width: '100%', textAlign: 'left', justifyContent: sidebarOpen ? 'flex-start' : 'center' }}>
              <span style={{ flexShrink: 0, display: 'flex' }}>{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </>}

        {/* Logout */}
        <div style={{ flex: 1 }} />
        <button onClick={doLogout} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: sidebarOpen ? '12px 16px' : '12px 0', background: 'none', border: 'none', borderTop: '1px solid #2a3942', color: '#aebac1', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', width: '100%', justifyContent: sidebarOpen ? 'flex-start' : 'center' }}>
          <span style={{ display: 'flex' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
          {sidebarOpen && <span>Sair ({user.name})</span>}
        </button>
      </div>

      {/* ═══ MÓDULOS ═══ */}
      {currentModule === 'dashboard' && <div style={{ flex: 1, background: '#f0f2f5', overflow: 'auto', width: '100%', minWidth: 0 }}><Dashboard /></div>}
      {currentModule === 'contacts' && <div style={{ flex: 1, background: '#f0f2f5', overflow: 'hidden', width: '100%', minWidth: 0 }}><Contacts /></div>}
      {currentModule === 'quick-replies' && <div style={{ flex: 1, background: '#f0f2f5', overflow: 'auto', width: '100%', minWidth: 0 }}><QuickRepliesModule /></div>}
      {currentModule === 'ai-agents' && <div style={{ flex: 1, background: '#f0f2f5', overflow: 'auto', width: '100%', minWidth: 0 }}><AIAgents /></div>}
      {currentModule === 'ai-metrics' && <div style={{ flex: 1, background: '#f0f2f5', overflow: 'auto', width: '100%', minWidth: 0 }}><AIMetrics /></div>}
      {currentModule === 'reports' && <div style={{ flex: 1, background: '#f0f2f5', overflow: 'auto', width: '100%', minWidth: 0 }}><Reports /></div>}
      {currentModule === 'settings' && <div style={{ flex: 1, background: '#f0f2f5', overflow: 'auto', width: '100%', minWidth: 0 }}><Settings /></div>}

      {/* ═══ CHAT (módulo principal) ═══ */}
      {currentModule === 'chat' && <>

      {/* ═══ SIDEBAR CONVERSAS ═══ */}
      <div style={{
        width: isMobile ? '100%' : 400, minWidth: isMobile ? '100%' : 340, maxWidth: isMobile ? '100%' : 400,
        display: isMobile && mobileView === 'chat' ? 'none' : 'flex',
        flexDirection: 'column', borderRight: isMobile ? 'none' : `1px solid ${W.border}`,
        flexShrink: 0,
      }}>

        {/* Header sidebar */}
        <div style={{ height: 59, background: W.bgHeader, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8 }}>
          {isMobile && <button style={iconBtn} onClick={() => setSidebarOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>}
          <div style={{ ...avatarStyle(40), background: W.teal, fontSize: 15 }}>{user.avatar || user.name?.[0]}</div>
          <div style={{ flex: 1, fontWeight: 600, fontSize: isMobile ? 14 : 16 }}>{user.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: waStatus.connected ? W.green : W.red }} />
            <span style={{ fontSize: 11, color: waStatus.connected ? W.green : W.red }}>{waStatus.connected ? 'Online' : 'Offline'}</span>
          </div>
          {user.role === 'admin' && <button onClick={() => { setShowAdmin(!showAdmin); setActiveConv(null); setSpyConv(null); setShowSales(false); }} style={iconBtn} title="Conexões WhatsApp">📱</button>}
        </div>

        {/* Busca */}
        <div style={{ padding: '6px 12px', background: W.bgPanel }}>
          <div style={{ display: 'flex', alignItems: 'center', background: W.search, borderRadius: 8, padding: '0 12px', height: 35, border: `1px solid ${W.border}` }}>
            <span style={{ marginRight: 12 }}>{Icons.search}</span>
            <input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: W.txt, fontSize: 14, fontFamily: 'inherit' }}
              placeholder="Pesquisar ou começar uma nova conversa" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', background: W.bgPanel, borderBottom: `1px solid ${W.border}` }}>
          {[
            { id: 'atendendo', label: 'Atendendo', count: myAtendendo.length },
            { id: 'aguardando', label: 'Fila', count: aguardando.length },
            { id: 'finalizados', label: 'Finalizados', count: finalizados.length },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '14px 4px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? `3px solid ${W.green}` : '3px solid transparent',
              color: tab === t.id ? W.green : W.txt2, fontSize: 13, fontWeight: 400, cursor: 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all .15s',
            }}>
              {t.label}
              {t.count > 0 && <span style={{ background: W.green, color: '#fff', borderRadius: 12, padding: '1px 7px', fontSize: 11, fontWeight: 500 }}>{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Lista de conversas */}
        <div style={{ flex: 1, overflowY: 'auto', background: W.bgPanel }}>
          {tab === 'atendendo' && filteredConvs(myAtendendo).map(conv => <ConvItem key={conv.id} conv={conv} active={activeConv?.id === conv.id} onClick={() => openConversation(conv)} />)}
          {tab === 'aguardando' && filteredConvs(aguardando).map(conv => (
            <div key={conv.id} style={{ cursor: 'pointer' }}>
              <ConvItem conv={conv} active={spyConv?.id === conv.id} onClick={() => spyConversation(conv)} />
              <div style={{ display: 'flex', gap: 6, padding: '0 16px 10px', marginTop: -4 }}>
                <button onClick={(e) => { e.stopPropagation(); acceptConversation(conv.id); }} style={{ ...smallBtn, background: W.green, color: '#fff', border: 'none' }}>Aceitar</button>
                <button onClick={(e) => { e.stopPropagation(); spyConversation(conv); }} style={smallBtn}>👁️ Espiar</button>
              </div>
            </div>
          ))}
          {tab === 'finalizados' && filteredConvs(finalizados).slice(0, 50).map(conv => <ConvItem key={conv.id} conv={conv} active={activeConv?.id === conv.id} onClick={() => openConversation(conv)} finished />)}
          {((tab === 'atendendo' && myAtendendo.length === 0) || (tab === 'aguardando' && aguardando.length === 0) || (tab === 'finalizados' && finalizados.length === 0)) &&
            <div style={{ padding: 40, textAlign: 'center', fontSize: 14, color: W.txt2 }}>Nenhuma conversa</div>
          }
        </div>
      </div>

      {/* ═══ ÁREA PRINCIPAL ═══ */}
      <div style={{ flex: 1, display: isMobile && mobileView === 'list' ? 'none' : 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden', width: isMobile ? '100%' : 'auto' }}>

        {/* ADMIN PANEL */}
        {showAdmin && user.role === 'admin' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: W.bgChat }}>
            <h2 style={{ fontSize: 18, fontWeight: 400, color: W.txt, marginBottom: 20 }}>Administração</h2>
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 400, marginBottom: 12, color: W.txt }}>📱 WhatsApp</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: waStatus.connected ? W.green : W.red }} />
                <span style={{ fontSize: 14, color: waStatus.connected ? W.green : W.red }}>{waStatus.connected ? 'Conectado' : 'Desconectado'}</span>
              </div>
              {waStatus.pairingCode && <div style={{ textAlign: 'center', marginBottom: 12, padding: 20, background: 'rgba(0,168,132,.06)', border: '1px solid rgba(0,168,132,.2)', borderRadius: 8 }}>
                <p style={{ fontSize: 13, color: W.txt2, marginBottom: 8 }}>Digite este código no WhatsApp:</p>
                <p style={{ fontSize: 11, color: W.txt2, marginBottom: 12 }}>Menu → Dispositivos conectados → Conectar com número</p>
                <div style={{ fontSize: 36, fontWeight: 300, letterSpacing: 8, color: W.green }}>{waStatus.pairingCode}</div>
              </div>}
              {waStatus.qr && !waStatus.pairingCode && <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <p style={{ fontSize: 13, color: W.txt2, marginBottom: 8 }}>Escaneie o QR Code:</p>
                <img src={waStatus.qr} alt="QR" style={{ width: 264, height: 264, borderRadius: 8 }} />
              </div>}
              {!waStatus.connected && <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, color: W.txt2, marginBottom: 8 }}>Número do WhatsApp da loja:</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={adminInput} placeholder="5533999999999" value={pairPhone} onChange={e => setPairPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && doPair()} />
                  <button style={{ ...smallBtn, background: W.green, color: '#fff', border: 'none', padding: '10px 16px', whiteSpace: 'nowrap', opacity: pairing ? 0.6 : 1 }} onClick={doPair} disabled={pairing}>{pairing ? '⏳...' : '🔗 Parear'}</button>
                </div>
              </div>}
            </div>
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 400, marginBottom: 8, color: W.txt }}>👥 Atendentes</h3>
              <p style={{ fontSize: 12, color: W.txt2, marginBottom: 12 }}>Sincronizados do ERP</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Nome','E-mail','Cargo','Loja'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 12, color: W.txt2, borderBottom: `1px solid ${W.border}` }}>{h}</th>)}</tr></thead>
                <tbody>{users.map(u => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${W.border}` }}>
                    <td style={tdS}>{u.name}</td>
                    <td style={{ ...tdS, color: W.txt2 }}>{u.email || '-'}</td>
                    <td style={tdS}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: u.role === 'admin' ? 'rgba(0,168,132,.1)' : 'rgba(134,150,160,.1)', color: u.role === 'admin' ? W.green : W.txt2 }}>{u.role}</span></td>
                    <td style={{ ...tdS, color: W.txt2 }}>{u.store_id || 'todas'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* PAINEL DE VENDAS */}
        {showSales && activeConv && !showAdmin && (
          <SalesPanel customerPhone={activeConv.phone} customerName={activeConv.customer_push_name || activeConv.customer_name} onClose={() => setShowSales(false)} />
        )}

        {/* SPY MODE */}
        {spyConv && !showAdmin && !showSales && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 59, background: W.bgHeader, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8 }}>
              {isMobile && <button style={iconBtn} onClick={goBackToList}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg></button>}
              <div style={{ ...avatarStyle(40), background: '#6B7175' }}>{(spyConv.customer_push_name || spyConv.phone)?.[0]?.toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{spyConv.customer_push_name || fmtPhone(spyConv.phone)}</div>
                <div style={{ fontSize: 13, color: W.txt2 }}>👁️ Espiando</div>
              </div>
              <button style={{ ...smallBtn, background: W.green, color: '#fff', border: 'none', padding: '8px 16px' }} onClick={() => acceptConversation(spyConv.id)}>Aceitar</button>
              <button style={iconBtn} onClick={() => setSpyConv(null)}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '8px 12px' : '8px 60px', background: W.bgChat }}>
              {spyMsgs.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            </div>
            <div style={{ padding: '10px 16px', background: 'rgba(0,168,132,.04)', textAlign: 'center', fontSize: 13, color: W.green }}>
              Aceite o atendimento para responder
            </div>
          </div>
        )}

        {/* CHAT ATIVO */}
        {activeConv && !showAdmin && !spyConv && !showSales && (
          <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0, overflow: 'hidden', width: '100%' }}>
            {/* Coluna do chat */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
              {/* Chat header */}
              <div style={{ height: 56, background: W.bgHeader, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6, flexShrink: 0, overflow: 'hidden', width: '100%' }}>
                {isMobile && <button style={iconBtn} onClick={goBackToList}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg></button>}
                <div style={{ ...avatarStyle(36), background: W.teal, fontSize: 14 }}>{(activeConv.customer_push_name || activeConv.phone)?.[0]?.toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer', overflow: 'hidden' }} onClick={() => setShowCustomerPanel(!showCustomerPanel)}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeConv.customer_push_name || fmtPhone(activeConv.phone)}</div>
                  <div style={{ fontSize: 11, color: W.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtPhone(activeConv.phone)}</div>
                </div>
                {activeConv.status === 'atendendo' && <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  <button style={{ ...smallBtn, padding: '4px 6px', fontSize: 11 }} onClick={() => { setShowSales(true); setShowAdmin(false); }} title="Vender">🛒</button>
                  <button style={{ ...smallBtn, padding: '4px 6px', fontSize: 11 }} onClick={() => setShowCustomerPanel(!showCustomerPanel)} title="Cliente">👤</button>
                  <button style={{ ...smallBtn, padding: '4px 6px', fontSize: 11 }} onClick={() => setShowTagMenu(!showTagMenu)} title="Tags">🏷️</button>
                  <button style={{ ...smallBtn, padding: '4px 6px', fontSize: 11 }} onClick={() => setShowMsgSearch(!showMsgSearch)} title="Buscar">🔍</button>
                  <button style={{ ...smallBtn, padding: '4px 6px', fontSize: 11 }} onClick={() => loadHistory(activeConv.phone)} title="Histórico">📋</button>
                  <button style={{ ...smallBtn, padding: '4px 6px', fontSize: 11 }} onClick={() => transferConversation(activeConv.id)} title="Devolver">↩️</button>
                  <button style={{ ...smallBtn, padding: '4px 6px', fontSize: 11, color: W.red }} onClick={() => finishConversation(activeConv.id)} title="Finalizar">✓</button>
                </div>}
              </div>

              {/* Tags da conversa */}
              {convTags.length > 0 && <div style={{ display: 'flex', gap: 4, padding: '4px 12px', background: W.bgHeader, flexWrap: 'wrap', flexShrink: 0 }}>
                {convTags.map(t => <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: t.color + '20', color: t.color }}>{t.tag} <span style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => removeTag(t.id)}>✕</span></span>)}
              </div>}

              {/* Menu de tags */}
              {showTagMenu && <div style={{ display: 'flex', gap: 4, padding: '6px 12px', background: W.bgHeader, borderBottom: `1px solid ${W.border}`, flexWrap: 'wrap', flexShrink: 0 }}>
                {tagOptions.map(t => <button key={t.tag} onClick={() => addTag(t.tag, t.color)} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, border: `1px solid ${t.color}`, background: t.color + '15', color: t.color, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>+ {t.tag}</button>)}
                <button onClick={() => setShowTagMenu(false)} style={{ ...smallBtn, padding: '3px 8px', fontSize: 11 }}>✕</button>
              </div>}

              {/* Busca de mensagens */}
              {showMsgSearch && <div style={{ padding: '6px 12px', background: W.bgHeader, borderBottom: `1px solid ${W.border}`, flexShrink: 0 }}>
                <input style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: `1px solid ${W.border}`, background: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} placeholder="Buscar nas mensagens..." value={msgSearch} onChange={e => doMsgSearch(e.target.value)} autoFocus />
                {msgSearchResults.length > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 4 }}>{msgSearchResults.map(m => <div key={m.id} style={{ padding: '4px 8px', fontSize: 12, borderBottom: `1px solid ${W.border}`, color: W.txt2 }}><strong>{m.sender}</strong>: {m.content?.slice(0, 80)}</div>)}</div>}
              </div>}

              {/* Histórico */}
              {showHistory && <div style={{ padding: '6px 12px', background: W.bgHeader, borderBottom: `1px solid ${W.border}`, maxHeight: 180, overflowY: 'auto', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 600 }}>Histórico ({convHistory.length})</span><button onClick={() => setShowHistory(false)} style={{ ...smallBtn, padding: '2px 6px', fontSize: 10 }}>✕</button></div>
                {convHistory.map(c => <div key={c.id} onClick={() => { openConversation(c); setShowHistory(false); }} style={{ padding: '4px 8px', fontSize: 12, borderBottom: `1px solid ${W.border}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: c.status === 'finalizado' ? W.txt2 : W.green, flexShrink: 0 }}>{c.status}</span><span style={{ color: W.txt2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_message?.slice(0, 40)}</span><span style={{ color: W.txt2, fontSize: 10, flexShrink: 0 }}>{c.started_at ? new Date(c.started_at).toLocaleDateString('pt-BR') : ''}</span></div>)}
              </div>}

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '8px 12px' : '8px 60px', background: W.bgChat }}>
                {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
                <div ref={messagesEndRef} />
              </div>

              {/* Respostas rápidas */}
              {showQuickReplies && activeConv.status === 'atendendo' && activeConv.agent_id === user.id && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 16px', background: W.bgHeader, borderTop: `1px solid ${W.border}` }}>
                  {quickReplies.map((qr, i) => (
                    <button key={i} onClick={() => sendQuickReply(qr.text)}
                      style={{ padding: '5px 10px', borderRadius: 16, border: `1px solid ${W.border}`, background: '#fff', color: W.txt, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                      {qr.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              {activeConv.status === 'atendendo' && activeConv.agent_id === user.id && (
                recording ? (
                  /* Barra de gravação */
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: W.bgHeader }}>
                    <button style={{ ...iconBtn, color: W.red }} onClick={cancelRecording} title="Cancelar">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: W.bgInput, borderRadius: 8, padding: '8px 16px', border: `1px solid ${W.red}` }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: W.red, animation: 'pulse 1s infinite' }} />
                      <span style={{ color: W.red, fontWeight: 600, fontSize: 14 }}>{fmtTime(recordingTime)}</span>
                      <span style={{ flex: 1, color: W.txt2, fontSize: 13 }}>Gravando áudio...</span>
                    </div>
                    <button style={{ ...iconBtn, width: 42, height: 42, borderRadius: '50%', background: W.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={stopRecording} title="Enviar">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/></svg>
                    </button>
                  </div>
                ) : (
                  /* Input normal */
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: W.bgHeader }}>
                    <button style={iconBtn} onClick={() => setShowQuickReplies(!showQuickReplies)} title="Respostas rápidas">⚡</button>
                    <button style={iconBtn} onClick={() => fileInputRef.current?.click()} title="Enviar imagem">📷</button>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: W.bgInput, borderRadius: 8, padding: '0 12px', border: `1px solid ${W.border}` }}>
                      <input
                        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: W.txt, fontSize: 15, fontFamily: 'inherit', padding: '10px 0', lineHeight: '20px' }}
                        placeholder="Digite uma mensagem"
                        value={msgInput}
                        onChange={e => setMsgInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                        autoFocus
                      />
                    </div>
                    {msgInput.trim() ? (
                      <button style={{ ...iconBtn, width: 42, height: 42, borderRadius: '50%', background: W.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={sendMessage}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/></svg>
                      </button>
                    ) : (
                      <button style={{ ...iconBtn, width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={startRecording} title="Gravar áudio">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                      </button>
                    )}
                  </div>
                )
              )}
              {activeConv.status === 'finalizado' && (
                <div style={{ padding: '12px 16px', background: 'rgba(234,0,56,.04)', textAlign: 'center', fontSize: 13, color: W.txt2 }}>
                  Finalizado{activeConv.finished_by ? ` por ${activeConv.finished_by}` : ''} {activeConv.finished_at ? `em ${fmt(activeConv.finished_at)}` : ''}
                </div>
              )}
            </div>

            {/* Painel do cliente */}
            {showCustomerPanel && (
              <div style={{
                width: isMobile ? '100%' : 320,
                borderLeft: isMobile ? 'none' : `1px solid ${W.border}`,
                background: W.bgPanel, overflowY: 'auto', flexShrink: 0,
                position: isMobile ? 'absolute' : 'relative', top: 0, right: 0, bottom: 0, zIndex: 10,
              }}>
                <div style={{ padding: '16px', borderBottom: `1px solid ${W.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Dados do cliente</span>
                  <button style={iconBtn} onClick={() => setShowCustomerPanel(false)}>✕</button>
                </div>

                {/* Avatar e nome */}
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <div style={{ ...avatarStyle(80), background: W.teal, fontSize: 32, margin: '0 auto 12px' }}>
                    {(activeConv.customer_push_name || activeConv.phone)?.[0]?.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{activeConv.customer_push_name || 'Cliente'}</div>
                  <div style={{ fontSize: 13, color: W.txt2 }}>{fmtPhone(activeConv.phone)}</div>
                </div>

                {/* Dados do ERP */}
                {customerInfo ? (
                  <div style={{ padding: '0 16px 16px' }}>
                    <div style={{ background: W.bgHeader, borderRadius: 8, padding: 12, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: W.txt2, marginBottom: 4 }}>CADASTRO NO ERP</div>
                      <InfoRow label="Nome" value={customerInfo.name} />
                      {customerInfo.cpf && <InfoRow label="CPF" value={customerInfo.cpf} />}
                      {customerInfo.email && <InfoRow label="Email" value={customerInfo.email} />}
                      {customerInfo.whatsapp && <InfoRow label="WhatsApp" value={customerInfo.whatsapp} />}
                      {customerInfo.tags && <InfoRow label="Tags" value={customerInfo.tags} />}
                      {customerInfo.points !== undefined && <InfoRow label="Pontos" value={customerInfo.points} />}
                      {customerInfo.total_purchases !== undefined && <InfoRow label="Compras" value={customerInfo.total_purchases} />}
                      {customerInfo.last_visit && <InfoRow label="Última visita" value={new Date(customerInfo.last_visit).toLocaleDateString('pt-BR')} />}
                    </div>

                    {/* Últimas compras */}
                    {customerInfo.recent_sales?.length > 0 && (
                      <div style={{ background: W.bgHeader, borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 12, color: W.txt2, marginBottom: 8 }}>ÚLTIMAS COMPRAS</div>
                        {customerInfo.recent_sales.map((s, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < customerInfo.recent_sales.length - 1 ? `1px solid ${W.border}` : 'none', fontSize: 13 }}>
                            <span style={{ color: W.txt2 }}>{s.date ? new Date(s.date).toLocaleDateString('pt-BR') : '-'}</span>
                            <span style={{ fontWeight: 600, color: W.green }}>R$ {parseFloat(s.total).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '0 16px', textAlign: 'center', color: W.txt2, fontSize: 13 }}>
                    Cliente não encontrado no ERP
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* EMPTY STATE */}
        {!activeConv && !spyConv && !showAdmin && !showSales && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: W.bgChat }}>
            <div style={{ width: 320, height: 320, opacity: 0.06, fontSize: 280, textAlign: 'center', lineHeight: '320px' }}>💬</div>
            <div style={{ fontSize: 32, fontWeight: 300, color: '#41525d', marginTop: -200 }}>D'Black Chat</div>
            <div style={{ fontSize: 14, color: W.txt2, textAlign: 'center', maxWidth: 460, lineHeight: 1.6 }}>
              Envie e receba mensagens dos clientes pelo WhatsApp.<br />Selecione uma conversa para começar.
            </div>
            {aguardando.length > 0 && <div style={{ fontSize: 14, color: W.green, fontWeight: 500, marginTop: 8 }}>{aguardando.length} conversa(s) na fila</div>}
          </div>
        )}
      </div>

      </>}
    </div>
  );
}

// ─── COMPONENTES ───
function ConvItem({ conv, active, onClick, finished }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', cursor: 'pointer', gap: 12,
        background: active ? W.bgActive : hover ? W.bgHover : 'transparent',
        borderBottom: `1px solid ${W.border}`, transition: 'background .1s' }}>
      <div style={{ ...avatarStyle(49), background: finished ? '#6B7175' : W.teal, fontSize: 17 }}>
        {(conv.customer_push_name || conv.phone)?.[0]?.toUpperCase() || '?'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: W.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.customer_push_name || fmtPhone(conv.phone)}</span>
          <span style={{ fontSize: 12, color: conv.unread_count > 0 ? W.green : W.txt2, flexShrink: 0, marginLeft: 8 }}>{fmt(conv.last_message_at)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {conv.status === 'atendendo' && <span style={{ flexShrink: 0 }}>{Icons.check}</span>}
          <span style={{ fontSize: 14, color: W.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.last_message}</span>
          {!finished && conv.unread_count > 0 && <span style={{ background: W.green, color: '#fff', borderRadius: 12, padding: '1px 7px', fontSize: 12, fontWeight: 500, flexShrink: 0, marginLeft: 'auto' }}>{conv.unread_count}</span>}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isMe = msg.from_me;
  return (
    <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
      <div style={{
        maxWidth: '80%', padding: '6px 7px 8px 9px', borderRadius: isMe ? '7.5px 7.5px 0 7.5px' : '7.5px 7.5px 7.5px 0',
        background: isMe ? W.bgMsgMe : W.bgMsg,
        boxShadow: '0 1px .5px rgba(11,20,26,.13)',
        position: 'relative', overflow: 'hidden', wordBreak: 'break-word',
      }}>
        {!isMe && <div style={{ fontSize: 12.8, fontWeight: 700, color: '#1fa855', marginBottom: 2 }}>{msg.sender}</div>}
        {msg.media_type === 'audio' && (msg.content?.startsWith('/media') || msg.content?.startsWith('/uploads') || msg.media_url) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 240 }}>
            <AudioPlayer src={msg.media_url || msg.content} />
          </div>
        ) : msg.media_type === 'image' && (msg.content?.startsWith('/media/') || msg.content?.startsWith('/uploads/images/')) ? (
          <div>
            <img src={msg.content.split('|')[0]} alt="" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 6, marginBottom: 4 }} />
            {msg.content.includes('|') && <div style={{ fontSize: 13, color: '#111b21' }}>{msg.content.split('|')[1]}</div>}
          </div>
        ) : (
          <div style={{ fontSize: 14.2, lineHeight: 1.45, wordBreak: 'break-word', overflowWrap: 'anywhere', color: '#111b21', whiteSpace: 'pre-wrap' }}>{msg.content}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: '#667781' }}>{fmt(msg.timestamp)}</span>
          {isMe && Icons.check}
        </div>
      </div>
    </div>
  );
}

function AudioPlayer({ src }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); }
    else { audioRef.current.play().catch(() => {}); }
    setPlaying(!playing);
  };

  const fmtSec = (s) => {
    if (!s || isNaN(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 200 }}>
      <audio ref={audioRef} src={src} preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onTimeUpdate={(e) => setProgress(e.target.duration ? (e.target.currentTime / e.target.duration) * 100 : 0)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <button onClick={toggle} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#00a884', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21"/></svg>
        )}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ height: 4, background: '#c5c5c5', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#00a884', borderRadius: 2, width: `${progress}%`, transition: 'width .1s' }} />
        </div>
      </div>
      <span style={{ fontSize: 11, color: '#667781', flexShrink: 0 }}>{fmtSec(playing ? (duration * progress / 100) : duration)}</span>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: W.txt2 }}>{label}</span>
      <span style={{ fontWeight: 600, color: W.txt, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    </div>
  );
}

// ─── ESTILOS ───
const avatarStyle = (size) => ({ width: size, height: size, borderRadius: '50%', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 400, flexShrink: 0 });
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: '50%', color: W.txt2, fontSize: 16, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const smallBtn = { padding: '5px 12px', borderRadius: 4, border: `1px solid ${W.border}`, background: 'transparent', color: W.txt2, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 400 };
const loginInput = { width: '100%', padding: '12px 14px', borderRadius: 4, border: '1px solid #dfe5e7', background: '#fff', color: '#3b4a54', fontSize: 15, fontFamily: 'inherit', outline: 'none', marginBottom: 12, boxSizing: 'border-box' };
const adminInput = { flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${W.borderLight}`, background: '#fff', color: W.txt, fontSize: 14, fontFamily: 'inherit', outline: 'none' };
const cardStyle = { background: '#ffffff', borderRadius: 8, padding: 20, marginBottom: 16, border: `1px solid ${W.border}` };
const tdS = { padding: '8px 10px', fontSize: 13 };
