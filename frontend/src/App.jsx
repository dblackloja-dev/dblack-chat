import { useState, useEffect, useRef, useCallback } from 'react';
import api from './api';
import SalesPanel from './SalesPanel';

// ─── CORES E ESTILOS ───
const C = { bg:"#0A0A0C", s1:"#111114", s2:"#18181C", s3:"#1F1F24", brd:"rgba(255,215,64,0.08)", brdH:"rgba(255,215,64,0.2)", gold:"#FFD740", goldD:"#FF8F00", txt:"#EEEEF0", dim:"rgba(255,255,255,0.75)", grn:"#00E676", red:"#FF5252", blu:"#40C4FF", pur:"#E040FB", wa:"#25D366" };

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

// ─── NOTIFICAÇÃO SONORA ───
const playNotif = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 800; gain.gain.value = 0.15;
    osc.start(); osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => { const o2 = ctx.createOscillator(); o2.connect(gain); o2.frequency.value = 1000; o2.start(); o2.stop(ctx.currentTime + 0.15); }, 180);
  } catch {}
};

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // Dados
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [tab, setTab] = useState('atendendo'); // atendendo, aguardando, finalizados
  const [waStatus, setWaStatus] = useState({ connected: false, qr: null });
  const [users, setUsers] = useState([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [spyConv, setSpyConv] = useState(null); // conversa sendo espiada
  const [spyMsgs, setSpyMsgs] = useState([]);
  const [showSales, setShowSales] = useState(false); // painel de vendas

  // Refs
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);

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
    try {
      const convs = await api.getConversations();
      setConversations(convs);
    } catch {}
  }, []);

  const loadMessages = useCallback(async (convId) => {
    try {
      const msgs = await api.getMessages(convId);
      setMessages(msgs);
    } catch {}
  }, []);

  // ─── WEBSOCKET ───
  useEffect(() => {
    if (!user) return;
    loadConversations();
    api.getWhatsAppStatus().then(setWaStatus).catch(() => {});
    if (user.role === 'admin') api.getUsers().then(setUsers).catch(() => {});

    // Conecta WebSocket
    const token = api.getToken();
    // Em produção, conecta direto no backend Railway; em dev, usa proxy local
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
            if (exists) {
              return prev.map(c => c.id === data.conversation.id ? { ...c, ...data.conversation } : c);
            }
            return [data.conversation, ...prev];
          });
          // Se a conversa ativa é esta, adiciona a mensagem
          setActiveConv(cur => {
            if (cur?.id === data.conversation.id) {
              setMessages(prev => {
                if (prev.find(m => m.id === data.message.id)) return prev;
                return [...prev, data.message];
              });
            }
            return cur;
          });
          // Se espiando esta conversa
          setSpyConv(cur => {
            if (cur?.id === data.conversation.id) {
              setSpyMsgs(prev => {
                if (prev.find(m => m.id === data.message.id)) return prev;
                return [...prev, data.message];
              });
            }
            return cur;
          });
          // Som de notificação para mensagens recebidas
          if (!data.message.from_me) playNotif();
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

    // Refresh a cada 15s como backup
    const interval = setInterval(loadConversations, 15000);

    return () => { ws.close(); clearInterval(interval); };
  }, [user?.id]);

  // Scroll automático nas mensagens
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ─── ACTIONS ───
  const openConversation = async (conv) => {
    setActiveConv(conv);
    setSpyConv(null);
    await loadMessages(conv.id);
  };

  const spyConversation = async (conv) => {
    setSpyConv(conv);
    setActiveConv(null);
    try { const msgs = await api.getMessages(conv.id); setSpyMsgs(msgs); } catch {}
  };

  const acceptConversation = async (convId) => {
    try {
      const conv = await api.acceptConversation(convId);
      setConversations(prev => prev.map(c => c.id === convId ? conv : c));
      setSpyConv(null);
      setActiveConv(conv);
      await loadMessages(convId);
      setTab('atendendo');
    } catch {}
  };

  const finishConversation = async (convId) => {
    if (!confirm('Finalizar este atendimento?')) return;
    try {
      await api.finishConversation(convId);
      if (activeConv?.id === convId) { setActiveConv(null); setMessages([]); }
      await loadConversations();
    } catch {}
  };

  const transferConversation = async (convId) => {
    if (!confirm('Devolver para a fila de espera?')) return;
    try {
      await api.transferConversation(convId);
      if (activeConv?.id === convId) { setActiveConv(null); setMessages([]); }
      await loadConversations();
    } catch {}
  };

  const sendMessage = async () => {
    if (!msgInput.trim() || !activeConv) return;
    const text = msgInput.trim();
    setMsgInput('');
    try {
      await api.sendMessage({ conversation_id: activeConv.id, content: text });
    } catch { setMsgInput(text); }
  };

  // ─── FILTROS ───
  const aguardando = conversations.filter(c => c.status === 'aguardando');
  const atendendo = conversations.filter(c => c.status === 'atendendo');
  const myAtendendo = atendendo.filter(c => c.agent_id === user?.id);
  const finalizados = conversations.filter(c => c.status === 'finalizado');

  // ─── ADMIN: parear WhatsApp ───
  const [pairPhone, setPairPhone] = useState('');
  const [pairing, setPairing] = useState(false);

  const doPair = async () => {
    if (!pairPhone.trim() || pairing) return;
    setPairing(true);
    try {
      const result = await api.pairWhatsApp(pairPhone.trim());
      if (result.pairingCode) {
        setWaStatus(prev => ({ ...prev, pairingCode: result.pairingCode }));
      }
    } catch (e) { console.error('Erro ao parear:', e); }
    setPairing(false);
  };

  // Usuários vêm do ERP (somente leitura)

  // ─── CHECKING ───
  if (checking) return <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontFamily: "'Outfit',sans-serif" }}>Carregando...</div>;

  // ─── LOGIN ───
  if (!user) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Outfit',sans-serif", color: C.txt }}>
      <div style={{ width: 360, maxWidth: '90%', textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: 6, background: `linear-gradient(135deg,${C.gold},#fff)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 4 }}>D'BLACK</div>
        <div style={{ fontSize: 11, letterSpacing: 4, color: C.wa, marginBottom: 32 }}>CHAT — ATENDIMENTO</div>
        <div style={{ background: C.s1, borderRadius: 16, padding: 28, border: `1px solid ${C.brd}` }}>
          <input style={inputStyle} placeholder="Nome ou e-mail" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()} />
          <input style={inputStyle} type="password" placeholder="Senha" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()} />
          {loginError && <div style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>{loginError}</div>}
          <button style={btnGold} onClick={doLogin}>Entrar</button>
        </div>
      </div>
    </div>
  );

  // ─── MAIN ───
  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, fontFamily: "'Outfit',sans-serif", color: C.txt, overflow: 'hidden' }}>

      {/* ═══ SIDEBAR ESQUERDA — Lista de Conversas ═══ */}
      <div style={{ width: 340, minWidth: 280, background: C.s1, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 2, color: C.gold, flex: 1 }}>D'BLACK CHAT</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: waStatus.connected ? C.grn : C.red }} />
            <span style={{ fontSize: 10, color: waStatus.connected ? C.grn : C.red }}>{waStatus.connected ? 'Online' : 'Offline'}</span>
          </div>
          {user.role === 'admin' && <button onClick={() => setShowAdmin(!showAdmin)} style={btnSmall}>⚙️</button>}
          <button onClick={doLogout} style={btnSmall}>Sair</button>
        </div>

        {/* User info */}
        <div style={{ padding: '8px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <div style={avatarStyle}>{user.avatar || user.name?.[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{user.name}</div>
            <div style={{ fontSize: 10, color: C.dim }}>{user.role === 'admin' ? 'Administrador' : 'Atendente'}</div>
          </div>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.brd}` }}>
          {[
            { id: 'atendendo', label: 'Atendendo', count: myAtendendo.length, color: C.grn },
            { id: 'aguardando', label: 'Aguardando', count: aguardando.length, color: C.gold },
            { id: 'finalizados', label: 'Finalizados', count: finalizados.length, color: C.dim },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '10px 4px', background: tab === t.id ? C.s2 : 'transparent', border: 'none', borderBottom: tab === t.id ? `2px solid ${t.color}` : '2px solid transparent',
              color: tab === t.id ? t.color : C.dim, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
            }}>
              {t.label}
              {t.count > 0 && <span style={{ background: t.color, color: C.bg, borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 800 }}>{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Lista de conversas */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'atendendo' && myAtendendo.map(conv => (
            <ConvItem key={conv.id} conv={conv} active={activeConv?.id === conv.id} onClick={() => openConversation(conv)} />
          ))}
          {tab === 'aguardando' && aguardando.map(conv => (
            <div key={conv.id} onClick={() => spyConversation(conv)} style={{ ...convItemStyle, borderLeft: spyConv?.id === conv.id ? `3px solid ${C.gold}` : '3px solid transparent', background: spyConv?.id === conv.id ? C.s2 : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ ...avatarStyle, background: `linear-gradient(135deg,${C.gold},${C.goldD})`, fontSize: 11 }}>{(conv.customer_push_name || conv.phone)?.[0]?.toUpperCase() || '?'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{conv.customer_push_name || fmtPhone(conv.phone)}</span>
                    <span style={{ fontSize: 10, color: C.dim }}>{fmt(conv.last_message_at)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.last_message}</div>
                </div>
                {conv.unread_count > 0 && <span style={{ background: C.wa, color: '#fff', borderRadius: 10, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>{conv.unread_count}</span>}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button onClick={(e) => { e.stopPropagation(); acceptConversation(conv.id); }} style={{ ...btnSmall, background: C.wa, color: '#fff', border: 'none', flex: 1 }}>Aceitar</button>
                <button onClick={(e) => { e.stopPropagation(); spyConversation(conv); }} style={{ ...btnSmall, flex: 1 }}>👁️ Espiar</button>
              </div>
            </div>
          ))}
          {tab === 'finalizados' && finalizados.slice(0, 50).map(conv => (
            <ConvItem key={conv.id} conv={conv} active={activeConv?.id === conv.id} onClick={() => openConversation(conv)} finished />
          ))}
          {((tab === 'atendendo' && myAtendendo.length === 0) || (tab === 'aguardando' && aguardando.length === 0) || (tab === 'finalizados' && finalizados.length === 0)) &&
            <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: C.dim }}>Nenhuma conversa {tab === 'atendendo' ? 'em atendimento' : tab === 'aguardando' ? 'aguardando' : 'finalizada'}</div>
          }
        </div>
      </div>

      {/* ═══ ÁREA PRINCIPAL — Chat ou Spy ou Admin ═══ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bg, minHeight: 0, overflow: 'hidden' }}>

        {/* ADMIN PANEL */}
        {showAdmin && user.role === 'admin' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gold, marginBottom: 16 }}>⚙️ Administração</h2>

            {/* WhatsApp Status */}
            <div style={cardStyle}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>📱 WhatsApp</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: waStatus.connected ? C.grn : C.red }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{waStatus.connected ? 'Conectado' : 'Desconectado'}</span>
              </div>

              {/* Código de pareamento */}
              {waStatus.pairingCode && <div style={{ textAlign: 'center', marginBottom: 10, padding: 20, background: 'rgba(37,211,102,.06)', border: '1px solid rgba(37,211,102,.2)', borderRadius: 12 }}>
                <p style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Digite este código no seu WhatsApp:</p>
                <p style={{ fontSize: 11, color: C.dim, marginBottom: 12 }}>WhatsApp → ⋮ Menu → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone</p>
                <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 8, color: C.wa }}>{waStatus.pairingCode}</div>
              </div>}

              {/* QR Code fallback */}
              {waStatus.qr && !waStatus.pairingCode && <div style={{ textAlign: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Escaneie o QR Code com seu WhatsApp:</p>
                <img src={waStatus.qr} alt="QR Code" style={{ width: 256, height: 256, borderRadius: 12, border: `2px solid ${C.brd}` }} />
              </div>}

              {/* Parear com número */}
              {!waStatus.connected && <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Informe o número do WhatsApp da loja para parear:</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{ ...inputStyle, flex: 1, marginBottom: 0 }} placeholder="5533999999999 (com DDI+DDD)" value={pairPhone} onChange={e => setPairPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && doPair()} />
                  <button style={{ ...btnGold, width: 'auto', opacity: pairing ? 0.6 : 1 }} onClick={doPair} disabled={pairing}>{pairing ? '⏳ Pareando...' : '🔗 Parear'}</button>
                </div>
              </div>}
            </div>

            {/* Users — do ERP */}
            <div style={cardStyle}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>👥 Atendentes</h3>
              <p style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>Usuários sincronizados do ERP. Para adicionar ou editar, use o painel do ERP.</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={thStyle}>Nome</th><th style={thStyle}>E-mail</th><th style={thStyle}>Cargo</th><th style={thStyle}>Loja</th>
                </tr></thead>
                <tbody>{users.map(u => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${C.brd}` }}>
                    <td style={tdStyle}>{u.name}</td>
                    <td style={{ ...tdStyle, fontSize: 11, color: C.dim }}>{u.email || '-'}</td>
                    <td style={tdStyle}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: u.role === 'admin' ? 'rgba(255,215,64,.1)' : 'rgba(0,230,118,.1)', color: u.role === 'admin' ? C.gold : C.grn }}>{u.role}</span></td>
                    <td style={{ ...tdStyle, fontSize: 11, color: C.dim }}>{u.store_id || 'todas'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* SPY MODE — Espiando conversa aguardando */}
        {spyConv && !showAdmin && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, background: C.s1, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ ...avatarStyle, background: `linear-gradient(135deg,${C.gold},${C.goldD})` }}>{(spyConv.customer_push_name || spyConv.phone)?.[0]?.toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{spyConv.customer_push_name || fmtPhone(spyConv.phone)}</div>
                <div style={{ fontSize: 11, color: C.dim }}>{fmtPhone(spyConv.phone)} — 👁️ Modo espiar</div>
              </div>
              <button style={{ ...btnSmall, background: C.wa, color: '#fff', border: 'none', padding: '8px 16px' }} onClick={() => acceptConversation(spyConv.id)}>Aceitar Atendimento</button>
              <button style={btnSmall} onClick={() => setSpyConv(null)}>✕ Fechar</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {spyMsgs.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            </div>
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}`, background: 'rgba(255,215,64,.04)', textAlign: 'center', fontSize: 12, color: C.gold, fontWeight: 600 }}>
              👁️ Modo espiar — aceite o atendimento para responder
            </div>
          </div>
        )}

        {/* PAINEL DE VENDAS */}
        {showSales && activeConv && !showAdmin && (
          <SalesPanel
            customerPhone={activeConv.phone}
            customerName={activeConv.customer_push_name || activeConv.customer_name}
            onClose={() => setShowSales(false)}
          />
        )}

        {/* CHAT ATIVO */}
        {activeConv && !showAdmin && !spyConv && !showSales && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Chat header */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, background: C.s1, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ ...avatarStyle, background: `linear-gradient(135deg,${C.wa},#128C7E)` }}>{(activeConv.customer_push_name || activeConv.phone)?.[0]?.toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{activeConv.customer_push_name || fmtPhone(activeConv.phone)}</div>
                <div style={{ fontSize: 11, color: C.dim }}>{fmtPhone(activeConv.phone)}{activeConv.agent_name ? ` — Atendente: ${activeConv.agent_name}` : ''}</div>
              </div>
              {activeConv.status === 'atendendo' && <>
                <button style={{ ...btnSmall, background: 'rgba(255,215,64,.1)', color: C.gold, border: `1px solid ${C.gold}`, padding: '6px 14px' }} onClick={() => { setShowSales(true); setShowAdmin(false); }}>🛒 Vender</button>
                <button style={btnSmall} onClick={() => transferConversation(activeConv.id)}>↩️ Devolver</button>
                <button style={{ ...btnSmall, color: C.red }} onClick={() => finishConversation(activeConv.id)}>✓ Finalizar</button>
              </>}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: `linear-gradient(180deg, ${C.bg}, ${C.s1}20)` }}>
              {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {activeConv.status === 'atendendo' && activeConv.agent_id === user.id && (
              <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.brd}`, background: C.s1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  style={{ ...inputStyle, flex: 1, marginBottom: 0, padding: '12px 16px', fontSize: 14 }}
                  placeholder="Digite sua mensagem..."
                  value={msgInput}
                  onChange={e => setMsgInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  autoFocus
                />
                <button style={{ ...btnSmall, background: 'linear-gradient(135deg,#FFD740,#FF8F00)', color: C.bg, fontWeight: 800, padding: '12px 18px', fontSize: 13, border: 'none', borderRadius: 8, whiteSpace: 'nowrap' }} onClick={sendMessage}>Enviar</button>
              </div>
            )}
            {activeConv.status === 'finalizado' && (
              <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}`, background: 'rgba(255,82,82,.04)', textAlign: 'center', fontSize: 12, color: C.dim }}>
                Atendimento finalizado{activeConv.finished_by ? ` por ${activeConv.finished_by}` : ''} {activeConv.finished_at ? `em ${fmt(activeConv.finished_at)}` : ''}
              </div>
            )}
          </div>
        )}

        {/* EMPTY STATE */}
        {!activeConv && !spyConv && !showAdmin && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 48, opacity: 0.2 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.dim }}>D'Black Chat</div>
            <div style={{ fontSize: 12, color: C.dim, opacity: 0.6 }}>Selecione uma conversa para começar</div>
            {aguardando.length > 0 && <div style={{ fontSize: 13, color: C.gold, fontWeight: 600, marginTop: 8 }}>{aguardando.length} conversa(s) aguardando na fila</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COMPONENTES ───
function ConvItem({ conv, active, onClick, finished }) {
  return (
    <div onClick={onClick} style={{ ...convItemStyle, background: active ? C.s2 : 'transparent', borderLeft: active ? `3px solid ${C.wa}` : '3px solid transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ ...avatarStyle, background: finished ? `linear-gradient(135deg,${C.dim},#666)` : `linear-gradient(135deg,${C.wa},#128C7E)`, fontSize: 11 }}>
          {(conv.customer_push_name || conv.phone)?.[0]?.toUpperCase() || '?'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{conv.customer_push_name || fmtPhone(conv.phone)}</span>
            <span style={{ fontSize: 10, color: C.dim }}>{fmt(conv.last_message_at)}</span>
          </div>
          <div style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.last_message}</div>
        </div>
        {!finished && conv.unread_count > 0 && <span style={{ background: C.wa, color: '#fff', borderRadius: 10, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>{conv.unread_count}</span>}
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isMe = msg.from_me;
  return (
    <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
      <div style={{
        maxWidth: '70%', padding: '8px 12px', borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        background: isMe ? 'rgba(37,211,102,.12)' : C.s2, border: `1px solid ${isMe ? 'rgba(37,211,102,.2)' : C.brd}`,
      }}>
        {!isMe && <div style={{ fontSize: 10, fontWeight: 700, color: C.wa, marginBottom: 2 }}>{msg.sender}</div>}
        {isMe && <div style={{ fontSize: 10, fontWeight: 700, color: C.grn, marginBottom: 2 }}>{msg.sender}</div>}
        <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.content}</div>
        <div style={{ fontSize: 9, color: C.dim, textAlign: 'right', marginTop: 2 }}>{fmt(msg.timestamp)}</div>
      </div>
    </div>
  );
}

// ─── ESTILOS ───
const inputStyle = { padding: '10px 14px', borderRadius: 8, border: `1px solid rgba(255,215,64,0.08)`, background: '#18181C', color: '#EEEEF0', fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', marginBottom: 10, boxSizing: 'border-box' };
const btnGold = { padding: '10px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#FFD740,#FF8F00)', color: '#0A0A0C', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 0.5, width: '100%' };
const btnSmall = { padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,215,64,0.15)', background: '#18181C', color: '#EEEEF0', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 600 };
const avatarStyle = { width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 };
const convItemStyle = { padding: '10px 14px', borderBottom: '1px solid rgba(255,215,64,0.08)', cursor: 'pointer', transition: 'background .15s' };
const cardStyle = { background: '#111114', border: '1px solid rgba(255,215,64,0.08)', borderRadius: 14, padding: 16, marginBottom: 12 };
const thStyle = { textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,215,64,0.08)', textTransform: 'uppercase' };
const tdStyle = { padding: '7px 10px', fontSize: 12 };
