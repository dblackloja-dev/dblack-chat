import { useState, useEffect } from 'react';
import api from '../api';

const W = { border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884', red: '#ea0038', bgHeader: '#f0f2f5' };

export default function QuickReplies() {
  const [replies, setReplies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ label: '', text: '', category: 'geral' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getQuickReplies().then(setReplies).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!form.label || !form.text) return;
    if (editing) {
      await api.updateQuickReply(editing, form);
      setReplies(prev => prev.map(r => r.id === editing ? { ...r, ...form } : r));
    } else {
      const r = await api.createQuickReply(form);
      setReplies(prev => [...prev, r]);
    }
    setForm({ label: '', text: '', category: 'geral' });
    setEditing(null);
  };

  const remove = async (id) => {
    if (!confirm('Excluir esta resposta rápida?')) return;
    await api.deleteQuickReply(id);
    setReplies(prev => prev.filter(r => r.id !== id));
  };

  const startEdit = (r) => {
    setEditing(r.id);
    setForm({ label: r.label, text: r.text, category: r.category || 'geral' });
  };

  const categories = ['geral', 'atendimento', 'info', 'venda'];

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: W.txt, marginBottom: 20 }}>Respostas Rápidas</h2>

      {/* Formulário */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: W.txt2 }}>{editing ? 'EDITAR RESPOSTA' : 'NOVA RESPOSTA'}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} placeholder="Rótulo (ex: 👋 Saudação)" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <select style={{ ...inputStyle, width: 130 }} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <textarea style={{ ...inputStyle, height: 100, resize: 'vertical' }} placeholder="Texto da mensagem..." value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnGreen} onClick={save}>{editing ? 'Salvar' : 'Criar'}</button>
          {editing && <button style={btnOutline} onClick={() => { setEditing(null); setForm({ label: '', text: '', category: 'geral' }); }}>Cancelar</button>}
        </div>
      </div>

      {/* Lista */}
      {loading ? <div style={{ color: W.txt2, padding: 20 }}>Carregando...</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {replies.map(r => (
            <div key={r.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{r.label}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: W.bgHeader, color: W.txt2 }}>{r.category}</span>
              </div>
              <div style={{ fontSize: 13, color: W.txt2, whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 10, maxHeight: 80, overflow: 'hidden' }}>{r.text}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btnSmall} onClick={() => startEdit(r)}>✏️ Editar</button>
                <button style={{ ...btnSmall, color: W.red }} onClick={() => remove(r.id)}>🗑 Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle = { padding: '10px 14px', borderRadius: 8, border: '1px solid #e9edef', background: '#fff', color: '#111b21', fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', marginBottom: 8 };
const cardStyle = { background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e9edef', marginBottom: 12 };
const btnGreen = { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#00a884', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnOutline = { padding: '10px 20px', borderRadius: 8, border: '1px solid #e9edef', background: '#fff', color: '#667781', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const btnSmall = { padding: '4px 10px', borderRadius: 6, border: '1px solid #e9edef', background: '#fff', color: '#111b21', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
