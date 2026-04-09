import { useState, useEffect } from 'react';
import api from '../api';

const W = { border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884' };

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [waStatus, setWaStatus] = useState({ connected: false });
  const [pairPhone, setPairPhone] = useState('');
  const [pairing, setPairing] = useState(false);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    Promise.all([
      api.getSettings().then(setSettings),
      api.getWhatsAppStatus().then(setWaStatus),
      api.getUsers().then(setUsers),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try { await api.updateSettings(settings); alert('Configurações salvas!'); } catch { alert('Erro ao salvar'); }
    setSaving(false);
  };

  const doPair = async () => {
    if (!pairPhone.trim() || pairing) return;
    setPairing(true);
    try {
      const result = await api.pairWhatsApp(pairPhone.trim());
      if (result.pairingCode) setWaStatus(prev => ({ ...prev, pairingCode: result.pairingCode }));
    } catch {}
    setPairing(false);
  };

  const set = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  if (loading) return <div style={{ padding: 40, color: W.txt2 }}>Carregando...</div>;

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: W.txt, marginBottom: 20 }}>Configurações</h2>

      {/* WhatsApp */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📱 Conexão WhatsApp</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: waStatus.connected ? W.green : '#ea0038' }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: waStatus.connected ? W.green : '#ea0038' }}>{waStatus.connected ? 'Conectado' : 'Desconectado'}</span>
        </div>
        {waStatus.pairingCode && (
          <div style={{ textAlign: 'center', padding: 20, background: 'rgba(0,168,132,.04)', borderRadius: 8, marginBottom: 12, border: '1px solid rgba(0,168,132,.2)' }}>
            <p style={{ fontSize: 13, color: W.txt2, marginBottom: 8 }}>Digite no WhatsApp:</p>
            <div style={{ fontSize: 36, fontWeight: 300, letterSpacing: 8, color: W.green }}>{waStatus.pairingCode}</div>
          </div>
        )}
        {!waStatus.connected && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="5533999999999" value={pairPhone} onChange={e => setPairPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && doPair()} />
            <button style={{ ...btnGreen, opacity: pairing ? 0.6 : 1 }} onClick={doPair} disabled={pairing}>{pairing ? '⏳...' : '🔗 Parear'}</button>
          </div>
        )}
      </div>

      {/* Saudação Automática */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>👋 Saudação Automática</h3>
        <label style={labelStyle}>
          <input type="checkbox" checked={settings.greeting_enabled === 'true'} onChange={e => set('greeting_enabled', e.target.checked ? 'true' : 'false')} />
          <span style={{ marginLeft: 8 }}>Enviar saudação para clientes novos</span>
        </label>
        <textarea style={{ ...inputStyle, height: 120, resize: 'vertical', marginTop: 8 }} value={settings.greeting_text || ''} onChange={e => set('greeting_text', e.target.value)} placeholder="Mensagem de saudação..." />
        <p style={{ fontSize: 11, color: W.txt2 }}>Use {'{nome}'} para inserir o nome do cliente</p>
      </div>

      {/* Dados da Empresa */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>🏪 Dados da Empresa</h3>
        <label style={labelStyle}>Nome da empresa</label>
        <input style={inputStyle} value={settings.company_name || ''} onChange={e => set('company_name', e.target.value)} />
        <label style={labelStyle}>Instagram</label>
        <input style={inputStyle} value={settings.company_instagram || ''} onChange={e => set('company_instagram', e.target.value)} />
        <label style={labelStyle}>Horário de atendimento</label>
        <input style={inputStyle} value={settings.business_hours || ''} onChange={e => set('business_hours', e.target.value)} />
      </div>

      {/* Atendentes */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>👥 Atendentes (do ERP)</h3>
        <p style={{ fontSize: 12, color: W.txt2, marginBottom: 12 }}>Para adicionar ou editar, use o painel do ERP.</p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={thStyle}>Nome</th><th style={thStyle}>Email</th><th style={thStyle}>Cargo</th><th style={thStyle}>Loja</th>
          </tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id} style={{ borderBottom: `1px solid ${W.border}` }}>
              <td style={tdStyle}>{u.name}</td>
              <td style={{ ...tdStyle, color: W.txt2 }}>{u.email || '-'}</td>
              <td style={tdStyle}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: u.role === 'admin' ? 'rgba(0,168,132,.1)' : '#f0f2f5', color: u.role === 'admin' ? W.green : W.txt2 }}>{u.role}</span></td>
              <td style={{ ...tdStyle, color: W.txt2 }}>{u.store_id || 'todas'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <button style={{ ...btnGreen, width: '100%', padding: 14, fontSize: 16, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
        {saving ? 'Salvando...' : '💾 Salvar Configurações'}
      </button>
    </div>
  );
}

const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #e9edef', background: '#fff', color: '#111b21', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 8 };
const cardStyle = { background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #e9edef', marginBottom: 16 };
const btnGreen = { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#00a884', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const labelStyle = { display: 'flex', alignItems: 'center', fontSize: 14, color: '#111b21', marginBottom: 4 };
const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#667781', borderBottom: '1px solid #e9edef' };
const tdStyle = { padding: '8px 10px', fontSize: 13 };
