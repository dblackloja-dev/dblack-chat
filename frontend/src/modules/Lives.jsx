import { useState, useEffect, useRef } from 'react';
import api from '../api';

// Painel do moderador da sala de live — cria a live, cadastra as peças (com foto),
// ativa/encerra e acompanha reservado/pago/fila em tempo real.
const SALA_URL = 'https://dblack-checkout-production.up.railway.app/live';
const HLS_URL = 'https://dblack-live-production.up.railway.app/live/dblack/index.m3u8';

const C = {
  bg: '#0f1f1c', card: '#152825', border: 'rgba(255,255,255,0.08)',
  txt: '#e9edef', muted: 'rgba(233,237,239,0.55)', green: '#1eba8a',
  gold: '#d4af37', red: '#e0483d',
};
const inputStyle = { background: '#0d1b18', border: `1px solid ${C.border}`, borderRadius: 8, color: C.txt, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none' };
const btn = (bg, color = '#0d1b18') => ({ background: bg, color, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' });

const fmtPrice = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parsePrice = (str) => Math.round(parseFloat(String(str).replace(/[^\d,\.]/g, '').replace(',', '.')) * 100);
const parseSizes = (str) => {
  // "M:2, G:1" ou "36:3,38:2" → {M:2,G:1}; vazio = peça única
  const out = {};
  for (const part of String(str || '').split(',')) {
    const [s, q] = part.split(':').map(x => x?.trim());
    if (s && q && parseInt(q) > 0) out[s.toUpperCase()] = parseInt(q);
  }
  return out;
};

export default function Lives() {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [board, setBoard] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [item, setItem] = useState({ code: '', name: '', price: '', sizes: '' });
  const [msg, setMsg] = useState('');
  const [streamOn, setStreamOn] = useState(null);
  const photoRefs = useRef({});

  const load = async () => {
    try {
      const s = await api.getLiveSessions();
      setSessions(s);
      if (!selected && s.length) setSelected(s.find(x => x.status === 'active')?.id ?? s[0].id);
    } catch (e) { setMsg(e.message); }
  };

  useEffect(() => { load(); }, []);

  // Board da sessão selecionada (poll 5s)
  useEffect(() => {
    if (!selected) { setBoard(null); return; }
    let alive = true;
    const tick = () => api.getLiveBoard(selected).then(b => alive && setBoard(b)).catch(() => {});
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [selected]);

  // Sinal da transmissão (HLS no ar?)
  useEffect(() => {
    const check = () => fetch(HLS_URL, { method: 'GET', cache: 'no-store' }).then(r => setStreamOn(r.ok)).catch(() => setStreamOn(false));
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  const createSession = async () => {
    if (!newTitle.trim()) return;
    const s = await api.createLiveSession(newTitle.trim()).catch(e => flash(e.message));
    if (s) { setNewTitle(''); await load(); setSelected(s.id); }
  };

  const addItem = async () => {
    try {
      const priceCents = parsePrice(item.price);
      if (!item.code.trim() || !item.name.trim() || !priceCents) return flash('Preencha código, nome e preço');
      await api.addLiveItem(selected, {
        code: item.code.trim(), name: item.name.trim(),
        live_price_cents: priceCents, sizes: parseSizes(item.sizes),
      });
      setItem({ code: '', name: '', price: '', sizes: '' });
      const b = await api.getLiveBoard(selected); setBoard(b);
      flash('Peça salva ✔');
    } catch (e) { flash(e.message); }
  };

  const uploadPhoto = async (itemId, file) => {
    if (!file) return;
    try {
      await api.uploadLiveItemPhoto(itemId, file);
      const b = await api.getLiveBoard(selected); setBoard(b);
      flash('Foto atualizada ✔');
    } catch (e) { flash(e.message); }
  };

  const session = board?.session;
  const isActive = session?.status === 'active';

  return (
    <div style={{ padding: 24, color: C.txt, fontFamily: "-apple-system, 'Inter', sans-serif", maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🎥 Lives</h1>
        <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 12, background: streamOn ? 'rgba(224,72,61,.15)' : 'rgba(255,255,255,.06)', color: streamOn ? '#ff6b61' : C.muted, fontWeight: 700 }}>
          {streamOn == null ? '...' : streamOn ? '🔴 TRANSMISSÃO NO AR' : 'transmissão offline'}
        </span>
        <button style={{ ...btn('rgba(255,255,255,.08)', C.txt), fontSize: 12 }}
          onClick={() => { navigator.clipboard?.writeText(SALA_URL); flash('Link da sala copiado ✔'); }}>
          🔗 Copiar link da sala
        </button>
      </div>

      {msg && <div style={{ background: 'rgba(30,186,138,.12)', color: C.green, padding: '8px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{msg}</div>}

      {/* Sessões */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {sessions.map(s => (
          <button key={s.id} onClick={() => setSelected(s.id)} style={{
            ...btn(selected === s.id ? C.green : 'rgba(255,255,255,.06)', selected === s.id ? '#0d1b18' : C.txt),
            border: s.status === 'active' ? `1px solid ${C.gold}` : '1px solid transparent',
          }}>
            {s.status === 'active' ? '🟢 ' : ''}{s.title} <span style={{ opacity: .6 }}>#{s.id}</span>
          </button>
        ))}
        <input style={{ ...inputStyle, width: 180 }} placeholder="Nova live (título)" value={newTitle}
          onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && createSession()} />
        <button style={btn(C.gold)} onClick={createSession}>+ Criar</button>
      </div>

      {board && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>{session.title}</h2>
            <span style={{ fontSize: 12, color: C.muted }}>{session.status}</span>
            {!isActive && <button style={btn(C.green)} onClick={async () => { await api.activateLiveSession(selected); await load(); const b = await api.getLiveBoard(selected); setBoard(b); flash('Live ATIVA — QUERO ligado ✔'); }}>▶ Ativar</button>}
            {isActive && <button style={btn(C.red, '#fff')} onClick={async () => { await api.closeLiveSession(selected); await load(); const b = await api.getLiveBoard(selected); setBoard(b); flash('Live encerrada'); }}>■ Encerrar</button>}
          </div>

          {/* Nova peça */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 18, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inputStyle, width: 70 }} placeholder="A1" value={item.code} onChange={e => setItem({ ...item, code: e.target.value })} />
            <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder="Nome da peça" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} />
            <input style={{ ...inputStyle, width: 100 }} placeholder="R$ 29,90" value={item.price} onChange={e => setItem({ ...item, price: e.target.value })} />
            <input style={{ ...inputStyle, width: 180 }} placeholder="Tamanhos: M:2, G:1" title="Formato TAM:QTD separados por vírgula. Vazio = peça única." value={item.sizes} onChange={e => setItem({ ...item, sizes: e.target.value })} />
            <button style={btn(C.green)} onClick={addItem}>+ Peça</button>
          </div>

          {/* Peças / board */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {board.items.map(i => (
              <div key={i.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: 'flex', gap: 12 }}>
                <div onClick={() => photoRefs.current[i.id]?.click()} style={{ width: 84, height: 112, borderRadius: 8, background: '#0d1b18', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: `1px dashed ${C.border}` }} title="Clique para enviar a foto">
                  {i.photo_media_id
                    ? <img src={`/media/${i.photo_media_id}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 11, color: C.muted, textAlign: 'center' }}>📷<br />foto</span>}
                </div>
                <input ref={el => photoRefs.current[i.id] = el} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { uploadPhoto(i.id, e.target.files[0]); e.target.value = ''; }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{i.code} <span style={{ fontWeight: 400 }}>{i.name}</span></span>
                    <button
                      onClick={async () => {
                        try {
                          await api.setLiveItemStage(i.id, i.on_stage === false);
                          const b = await api.getLiveBoard(selected); setBoard(b);
                        } catch (e) { flash(e.message); }
                      }}
                      title={i.on_stage === false ? 'Peça escondida da sala — clique para colocar EM CENA' : 'Peça visível na sala — clique para tirar de cena'}
                      style={{
                        border: `1px solid ${i.on_stage === false ? C.border : C.gold}`,
                        background: i.on_stage === false ? 'transparent' : 'rgba(212,175,55,.15)',
                        color: i.on_stage === false ? C.muted : C.gold,
                        borderRadius: 999, padding: '2px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                      }}>
                      {i.on_stage === false ? '🙈 fora de cena' : '🎬 EM CENA'}
                    </button>
                  </div>
                  <div style={{ color: C.gold, fontWeight: 700, margin: '2px 0 6px' }}>{fmtPrice(i.live_price_cents)}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
                    {Object.keys(i.sizes || {}).length ? Object.entries(i.sizes).map(([s, q]) => `${s}:${q}`).join('  ') : 'peça única'}
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
                    <span title="Reservadas agora">⏳ {i.reserved}</span>
                    <span style={{ color: C.green }} title="Pagas">💰 {i.paid}</span>
                    <span style={{ color: C.muted }} title="Expiradas">⌛ {i.expired}</span>
                    <span style={{ color: '#f0a500' }} title="Na fila de espera">👥 {i.waitlist}</span>
                  </div>
                </div>
              </div>
            ))}
            {board.items.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>Nenhuma peça ainda — cadastra a primeira aí em cima 👆</div>}
          </div>

          {/* Últimas reservas */}
          {board.reservations.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <h3 style={{ fontSize: 14, color: C.muted, marginBottom: 8 }}>Últimas reservas</h3>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                {board.reservations.slice(0, 20).map(r => (
                  <div key={r.id} style={{ display: 'flex', gap: 10, padding: '8px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, alignItems: 'center' }}>
                    <b style={{ width: 46 }}>{r.code}</b>
                    <span style={{ width: 36 }}>{r.size || '—'}</span>
                    <span style={{ flex: 1, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.ig_username ? `@${r.ig_username.replace(/^@/, '')}` : r.source}
                    </span>
                    <span style={{
                      fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: r.status === 'paid' ? 'rgba(30,186,138,.15)' : r.status === 'reserved' ? 'rgba(212,175,55,.15)' : 'rgba(255,255,255,.06)',
                      color: r.status === 'paid' ? C.green : r.status === 'reserved' ? C.gold : C.muted,
                    }}>{r.status === 'paid' ? 'PAGA' : r.status === 'reserved' ? 'reservada' : r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
