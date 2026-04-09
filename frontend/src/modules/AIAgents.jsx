import { useState, useEffect } from 'react';
import api from '../api';

const W = { border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884', red: '#ea0038', bgHeader: '#f0f2f5' };

export default function AIAgents() {
  const [agents, setAgents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', personality: '', instructions: '', knowledge_base: '', auto_reply: false, max_wait_seconds: 60 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAIAgents().then(setAgents).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!form.name) return;
    if (editing) {
      await api.updateAIAgent(editing, form);
      setAgents(prev => prev.map(a => a.id === editing ? { ...a, ...form } : a));
    } else {
      const a = await api.createAIAgent(form);
      setAgents(prev => [...prev, { ...a, ...form }]);
    }
    resetForm();
  };

  const toggle = async (agent) => {
    const updated = { ...agent, enabled: !agent.enabled };
    await api.updateAIAgent(agent.id, updated);
    setAgents(prev => prev.map(a => a.id === agent.id ? updated : a));
  };

  const remove = async (id) => {
    if (!confirm('Excluir este agente?')) return;
    await api.deleteAIAgent(id);
    setAgents(prev => prev.filter(a => a.id !== id));
  };

  const startEdit = (a) => {
    setEditing(a.id);
    setForm({ name: a.name, personality: a.personality || '', instructions: a.instructions || '', knowledge_base: a.knowledge_base || '', auto_reply: a.auto_reply || false, max_wait_seconds: a.max_wait_seconds || 60 });
  };

  const resetForm = () => {
    setEditing(null);
    setForm({ name: '', personality: '', instructions: '', knowledge_base: '', auto_reply: false, max_wait_seconds: 60 });
  };

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: W.txt, marginBottom: 8 }}>Agentes de IA</h2>
      <p style={{ fontSize: 14, color: W.txt2, marginBottom: 20 }}>Configure agentes inteligentes para atendimento automático</p>

      {/* Formulário */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: W.txt2 }}>{editing ? 'EDITAR AGENTE' : 'NOVO AGENTE'}</h3>

        <label style={labelStyle}>Nome do agente</label>
        <input style={inputStyle} placeholder="Ex: Atendente Virtual D'Black" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

        <label style={labelStyle}>Personalidade</label>
        <textarea style={{ ...inputStyle, height: 80 }} placeholder="Descreva como o agente deve se comportar. Ex: Você é um atendente simpático da D'Black Store, loja de roupas. Seja educado, use emojis e ajude o cliente." value={form.personality} onChange={e => setForm(f => ({ ...f, personality: e.target.value }))} />

        <label style={labelStyle}>Instruções específicas</label>
        <textarea style={{ ...inputStyle, height: 80 }} placeholder="Regras que o agente deve seguir. Ex: Nunca dê desconto sem autorização. Sempre pergunte o tamanho. Encaminhe para atendente humano se o cliente reclamar." value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} />

        <label style={labelStyle}>Base de conhecimento</label>
        <textarea style={{ ...inputStyle, height: 100 }} placeholder="Informações que o agente pode usar. Ex: Horários, endereços, política de troca, tabela de preços, promoções ativas..." value={form.knowledge_base} onChange={e => setForm(f => ({ ...f, knowledge_base: e.target.value }))} />

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            <input type="checkbox" checked={form.auto_reply} onChange={e => setForm(f => ({ ...f, auto_reply: e.target.checked }))} />
            <span style={{ marginLeft: 8 }}>Responder automaticamente</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: W.txt2 }}>Aguardar</span>
            <input type="number" style={{ ...inputStyle, width: 60, marginBottom: 0, textAlign: 'center' }} value={form.max_wait_seconds} onChange={e => setForm(f => ({ ...f, max_wait_seconds: parseInt(e.target.value) || 60 }))} />
            <span style={{ fontSize: 13, color: W.txt2 }}>seg antes de responder</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnGreen} onClick={save}>{editing ? 'Salvar' : 'Criar Agente'}</button>
          {editing && <button style={btnOutline} onClick={resetForm}>Cancelar</button>}
        </div>
      </div>

      {/* Lista de agentes */}
      {loading ? <div style={{ color: W.txt2 }}>Carregando...</div> : agents.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: W.txt2 }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🤖</div>
          <div style={{ fontSize: 16 }}>Nenhum agente criado ainda</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Crie seu primeiro agente de IA acima</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {agents.map(a => (
            <div key={a.id} style={{ ...cardStyle, borderLeft: `4px solid ${a.enabled ? W.green : '#ccc'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 28 }}>🤖</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: a.enabled ? W.green : W.txt2 }}>{a.enabled ? '🟢 Ativo' : '⚪ Inativo'}</div>
                </div>
                <button style={{ ...btnSmall, background: a.enabled ? 'rgba(234,0,56,.05)' : 'rgba(0,168,132,.05)', color: a.enabled ? W.red : W.green, border: `1px solid ${a.enabled ? W.red : W.green}` }} onClick={() => toggle(a)}>
                  {a.enabled ? 'Desativar' : 'Ativar'}
                </button>
              </div>
              {a.personality && <div style={{ fontSize: 13, color: W.txt2, marginBottom: 4 }}><strong>Personalidade:</strong> {a.personality.slice(0, 100)}...</div>}
              {a.auto_reply && <div style={{ fontSize: 12, color: W.green }}>⚡ Resposta automática após {a.max_wait_seconds}s</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={btnSmall} onClick={() => startEdit(a)}>✏️ Editar</button>
                <button style={{ ...btnSmall, color: W.red }} onClick={() => remove(a.id)}>🗑 Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #e9edef', background: '#fff', color: '#111b21', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 8, resize: 'vertical' };
const cardStyle = { background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #e9edef', marginBottom: 12 };
const btnGreen = { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#00a884', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnOutline = { padding: '10px 20px', borderRadius: 8, border: '1px solid #e9edef', background: '#fff', color: '#667781', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const btnSmall = { padding: '5px 12px', borderRadius: 6, border: '1px solid #e9edef', background: '#fff', color: '#111b21', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const labelStyle = { display: 'block', fontSize: 13, color: '#667781', marginBottom: 4, fontWeight: 600 };
