import { useState, useEffect } from 'react';
import api from '../api';

const W = { bgChat: '#efeae2', bgHeader: '#f0f2f5', border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884', red: '#ea0038', blue: '#53bdeb', gold: '#c77d00' };

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboard().then(setData).catch(() => {}).finally(() => setLoading(false));
    const i = setInterval(() => api.getDashboard().then(setData).catch(() => {}), 30000);
    return () => clearInterval(i);
  }, []);

  if (loading) return <div style={{ padding: 40, color: W.txt2, textAlign: 'center' }}>Carregando...</div>;
  if (!data) return <div style={{ padding: 40, color: W.txt2 }}>Erro ao carregar dashboard</div>;

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: W.txt, marginBottom: 20 }}>Dashboard</h2>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <KPI icon="💬" label="Conversas Hoje" value={data.today_conversations} color={W.green} />
        <KPI icon="⏳" label="Na Fila" value={data.waiting} color={W.gold} />
        <KPI icon="🟢" label="Em Atendimento" value={data.active} color={W.green} />
        <KPI icon="📨" label="Mensagens Hoje" value={data.today_messages} color={W.blue} />
        <KPI icon="🛒" label="Vendas Hoje" value={data.today_sales.count} sub={`R$ ${data.today_sales.total.toFixed(2)}`} color={W.green} />
        <KPI icon="📊" label="Total Conversas" value={data.total_conversations} color={W.txt2} />
      </div>

      {/* Top atendentes */}
      {data.top_agents.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>🏆 Atendentes Hoje</h3>
          {data.top_agents.map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < data.top_agents.length - 1 ? `1px solid ${W.border}` : 'none' }}>
              <span style={{ fontWeight: 500 }}>{i + 1}. {a.agent_name}</span>
              <span style={{ fontWeight: 700, color: W.green }}>{a.total} atendimentos</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KPI({ icon, label, value, sub, color }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 28 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 12, color: W.txt2 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
          {sub && <div style={{ fontSize: 12, color: W.green, fontWeight: 600 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

const cardStyle = { background: '#fff', borderRadius: 8, padding: 16, border: `1px solid ${W.border}` };
