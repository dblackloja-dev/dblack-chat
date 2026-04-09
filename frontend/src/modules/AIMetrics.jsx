import { useState, useEffect } from 'react';
import api from '../api';

const W = { border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884', red: '#ea0038', blue: '#2196f3' };

export default function AIMetrics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAIMetrics().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, color: W.txt2 }}>Carregando...</div>;
  if (!data) return <div style={{ padding: 40, color: W.txt2 }}>Erro ao carregar métricas</div>;

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: W.txt, marginBottom: 20 }}>Métricas da IA (Lê)</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Card icon="🤖" label="Total Interações" value={data.total} color={W.blue} />
        <Card icon="✅" label="Resolvidas pela IA" value={data.resolved} color={W.green} />
        <Card icon="🔀" label="Transferidas" value={data.transferred} color={W.red} />
        <Card icon="⚡" label="Tempo Médio" value={`${data.avg_response_ms}ms`} color={W.blue} />
        <Card icon="📊" label="Taxa de Resolução" value={`${data.resolution_rate}%`} color={data.resolution_rate >= 50 ? W.green : W.red} />
      </div>

      {data.daily?.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Desempenho Diário</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thStyle}>Dia</th>
              <th style={thStyle}>Total</th>
              <th style={thStyle}>Resolvidas</th>
              <th style={thStyle}>Transferidas</th>
            </tr></thead>
            <tbody>{data.daily.map((d, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${W.border}` }}>
                <td style={tdStyle}>{d.day ? new Date(d.day).toLocaleDateString('pt-BR') : '-'}</td>
                <td style={tdStyle}>{d.total}</td>
                <td style={{ ...tdStyle, color: W.green, fontWeight: 600 }}>{d.resolved}</td>
                <td style={{ ...tdStyle, color: W.red }}>{d.transferred}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {data.total === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: W.txt2 }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🤖</div>
          <div>Nenhuma interação registrada ainda</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>As métricas aparecerão quando a Lê começar a atender</div>
        </div>
      )}
    </div>
  );
}

function Card({ icon, label, value, color }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 12, color: '#667781' }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
        </div>
      </div>
    </div>
  );
}

const cardStyle = { background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e9edef', marginBottom: 12 };
const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#667781', borderBottom: '1px solid #e9edef' };
const tdStyle = { padding: '8px 10px', fontSize: 14 };
