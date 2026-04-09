import { useState, useEffect } from 'react';
import api from '../api';

const W = { border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884', bgHeader: '#f0f2f5' };

export default function Reports() {
  const [data, setData] = useState(null);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.getReports(from, to).then(setData).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const totalConvs = data?.conversations_by_day?.reduce((s, d) => s + parseInt(d.total), 0) || 0;
  const totalSales = data?.sales_by_day?.reduce((s, d) => s + parseInt(d.count), 0) || 0;
  const totalRevenue = data?.sales_by_day?.reduce((s, d) => s + parseFloat(d.total), 0) || 0;

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: W.txt, marginBottom: 20 }}>Relatórios</h2>

      {/* Filtros */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>Período:</span>
        <input type="date" style={inputStyle} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: W.txt2 }}>até</span>
        <input type="date" style={inputStyle} value={to} onChange={e => setTo(e.target.value)} />
        <button style={btnGreen} onClick={load}>Filtrar</button>
      </div>

      {loading ? <div style={{ color: W.txt2, padding: 20 }}>Carregando...</div> : data && (
        <>
          {/* Resumo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: W.txt2 }}>Total Conversas</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: W.green }}>{totalConvs}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: W.txt2 }}>Total Vendas</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: W.green }}>{totalSales}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: W.txt2 }}>Faturamento</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: W.green }}>R$ {totalRevenue.toFixed(2)}</div>
            </div>
          </div>

          {/* Atendentes */}
          {data.agent_stats?.length > 0 && (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>👥 Desempenho por Atendente</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={thStyle}>Atendente</th>
                  <th style={thStyle}>Atendimentos</th>
                  <th style={thStyle}>Tempo Médio</th>
                </tr></thead>
                <tbody>{data.agent_stats.map((a, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${W.border}` }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600 }}>{a.agent_name}</span></td>
                    <td style={tdStyle}>{a.total}</td>
                    <td style={tdStyle}>{a.avg_time ? `${Math.round(a.avg_time / 60)} min` : '-'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {/* Conversas por dia */}
          {data.conversations_by_day?.length > 0 && (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>💬 Conversas por Dia</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, padding: '0 8px' }}>
                {data.conversations_by_day.map((d, i) => {
                  const max = Math.max(...data.conversations_by_day.map(x => parseInt(x.total)));
                  const h = max > 0 ? (parseInt(d.total) / max) * 100 : 0;
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, color: W.txt2 }}>{d.total}</span>
                      <div style={{ width: '100%', height: h, background: W.green, borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                      <span style={{ fontSize: 9, color: W.txt2 }}>{new Date(d.day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Vendas por dia */}
          {data.sales_by_day?.length > 0 && (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>🛒 Vendas por Dia (E-commerce)</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, padding: '0 8px' }}>
                {data.sales_by_day.map((d, i) => {
                  const max = Math.max(...data.sales_by_day.map(x => parseFloat(x.total)));
                  const h = max > 0 ? (parseFloat(d.total) / max) * 100 : 0;
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 9, color: W.txt2 }}>R${parseFloat(d.total).toFixed(0)}</span>
                      <div style={{ width: '100%', height: h, background: W.green, borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                      <span style={{ fontSize: 9, color: W.txt2 }}>{new Date(d.day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const inputStyle = { padding: '8px 12px', borderRadius: 8, border: '1px solid #e9edef', background: '#fff', color: '#111b21', fontSize: 14, fontFamily: 'inherit', outline: 'none' };
const cardStyle = { background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e9edef', marginBottom: 12 };
const btnGreen = { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#00a884', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#667781', borderBottom: '1px solid #e9edef' };
const tdStyle = { padding: '8px 10px', fontSize: 14 };
