// ============================================================
// D'BLACK CHAT — Sidebar Component
// Copiar para: src/components/layout/Sidebar.jsx
// Substitui o sidebar atual com o novo sistema visual
// ============================================================

import React, { useState } from 'react';
import {
  LogoDBlack,
  SidebarNavItem,
  Avatar,
  StatusBadge,
  SIDEBAR_ICONS,
} from '../icons/DBlackIcons';

export const Sidebar = ({
  activeRoute = 'dashboard',
  onNavigate,
  agentName = 'Denilson',
  agentStatus = 'online',
  queueCount = 0,
}) => {
  const [active, setActive] = useState(activeRoute);

  const handleNav = (key) => {
    setActive(key);
    onNavigate?.(key);
  };

  return (
    <div style={{
      width: 72,
      height: '100vh',
      background: '#0d1b18',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '16px 8px',
      borderRight: '0.5px solid rgba(255,255,255,0.06)',
      gap: 4,
      flexShrink: 0,
    }}>

      {/* Logo mark */}
      <div style={{ marginBottom: 12, paddingBottom: 12,
        borderBottom: '0.5px solid rgba(255,255,255,0.07)', width: '100%',
        display: 'flex', justifyContent: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: '#1eba8a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="24" height="24" viewBox="0 0 26 26" fill="none">
            <path d="M3 6.5C3 5.4 3.9 4.5 5 4.5H15C16.1 4.5 17 5.4 17 6.5V12.5C17 13.6 16.1 14.5 15 14.5H9.5L6 18V14.5H5C3.9 14.5 3 13.6 3 12.5V6.5Z"
              fill="#0d1b18"/>
            <path d="M17 9H20C21.1 9 22 9.9 22 11V15C22 16.1 21.1 17 20 17H19L17.5 18.5V17H17C15.9 17 15 16.1 15 15V14"
              stroke="#0d1b18" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/>
          </svg>
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', flex: 1 }}>
        {SIDEBAR_ICONS.map(({ key, label, Icon }) => (
          <SidebarNavItem
            key={key}
            icon={(props) => <Icon {...props} active={active === key} />}
            label={label}
            active={active === key}
            onClick={() => handleNav(key)}
          />
        ))}
      </nav>

      {/* Bottom — agent avatar + status */}
      <div style={{
        borderTop: '0.5px solid rgba(255,255,255,0.07)',
        paddingTop: 12, width: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      }}>
        {/* Status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: agentStatus === 'online' ? '#1eba8a'
              : agentStatus === 'busy' ? '#f59e0b' : '#ef4444',
          }}/>
          {queueCount > 0 && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5 }}>
              {queueCount} fila
            </span>
          )}
        </div>

        <Avatar
          name={agentName}
          size={36}
          index={0}
        />

        {/* Sair */}
        <button style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '6px 4px', borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 0.35, transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = 0.7}
        onMouseLeave={e => e.currentTarget.style.opacity = 0.35}
        title="Sair"
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
            <path d="M11 5V3.5C11 2.7 10.3 2 9.5 2H3.5C2.7 2 2 2.7 2 3.5V14.5C2 15.3 2.7 16 3.5 16H9.5C10.3 16 11 15.3 11 14.5V13"
              stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M14 9H6M14 9L11.5 6.5M14 9L11.5 11.5"
              stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
