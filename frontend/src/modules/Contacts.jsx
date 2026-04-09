import { useState, useEffect, useRef } from 'react';
import api from '../api';

const W = { border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884', bgHeader: '#f0f2f5' };

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = contacts.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (c.customer_push_name || '').toLowerCase().includes(s) || (c.phone || '').includes(s);
  });

  const selectContact = async (c) => {
    setSelected(c);
    setDetails(null);
    try {
      const d = await api.getCustomerDetails(c.phone);
      if (d && !d.not_found) setDetails(d);
    } catch {}
  };

  const fmtPhone = (p) => {
    if (!p) return '';
    const d = p.replace(/\D/g, '');
    if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
    return p;
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Lista */}
      <div style={{ width: 380, borderRight: `1px solid ${W.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px', borderBottom: `1px solid ${W.border}` }}>
          <input style={inputStyle} placeholder="🔍 Buscar contato..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ fontSize: 12, color: W.txt2, marginTop: 4 }}>{contacts.length} contatos</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: W.txt2 }}>Carregando...</div>}
          {filtered.map(c => (
            <div key={c.phone} onClick={() => selectContact(c)}
              style={{ padding: '12px 16px', borderBottom: `1px solid ${W.border}`, cursor: 'pointer', background: selected?.phone === c.phone ? W.bgHeader : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: W.green, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 16, flexShrink: 0 }}>
                  {(c.customer_push_name || c.phone)?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{c.customer_push_name || fmtPhone(c.phone)}</div>
                  <div style={{ fontSize: 13, color: W.txt2 }}>{fmtPhone(c.phone)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: W.txt2 }}>{c.total_conversations} conv.</div>
                  <div style={{ fontSize: 11, color: W.txt2 }}>{c.total_messages} msg</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detalhes */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {!selected ? (
          <div style={{ textAlign: 'center', color: W.txt2, marginTop: 80 }}>
            <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>👤</div>
            <div style={{ fontSize: 16 }}>Selecione um contato</div>
          </div>
        ) : (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: W.green, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 600, margin: '0 auto 12px' }}>
                {(selected.customer_push_name || selected.phone)?.[0]?.toUpperCase()}
              </div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{selected.customer_push_name || 'Cliente'}</div>
              <div style={{ color: W.txt2 }}>{fmtPhone(selected.phone)}</div>
            </div>

            {/* Dados do chat */}
            <div style={cardStyle}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: W.txt2 }}>DADOS DO CHAT</h3>
              <Row label="Conversas" value={selected.total_conversations} />
              <Row label="Mensagens" value={selected.total_messages} />
              <Row label="Primeira mensagem" value={selected.first_contact ? new Date(selected.first_contact).toLocaleDateString('pt-BR') : '-'} />
              <Row label="Último contato" value={selected.last_contact ? new Date(selected.last_contact).toLocaleDateString('pt-BR') : '-'} />
            </div>

            {/* Dados do ERP se existir */}
            {details && (
              <div style={cardStyle}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: W.txt2 }}>CADASTRO NO ERP</h3>
                <Row label="Nome" value={details.name} />
                {details.cpf && <Row label="CPF" value={details.cpf} />}
                {details.email && <Row label="Email" value={details.email} />}
                {details.tags && <Row label="Tags" value={details.tags} />}
                {details.points !== undefined && <Row label="Pontos" value={details.points} />}
                {details.total_purchases !== undefined && <Row label="Compras" value={details.total_purchases} />}
              </div>
            )}

            {details?.recent_sales?.length > 0 && (
              <div style={cardStyle}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: W.txt2 }}>ÚLTIMAS COMPRAS</h3>
                {details.recent_sales.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < details.recent_sales.length - 1 ? `1px solid ${W.border}` : 'none' }}>
                    <span style={{ color: W.txt2 }}>{s.date ? new Date(s.date).toLocaleDateString('pt-BR') : '-'}</span>
                    <span style={{ fontWeight: 700, color: W.green }}>R$ {parseFloat(s.total).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            {!details && (
              <div style={{ ...cardStyle, textAlign: 'center', color: W.txt2, padding: 20 }}>
                Cliente não cadastrado no ERP
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14 }}>
      <span style={{ color: '#667781' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #e9edef', background: '#f0f2f5', color: '#111b21', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const cardStyle = { background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e9edef', marginBottom: 12 };
