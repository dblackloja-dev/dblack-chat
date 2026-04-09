// ============================================================
// D'BLACK CHAT — Icon & Logo Components
// Copiar para: src/components/icons/DBlackIcons.jsx
// Uso: import { LogoDBlack, IconDashboard, ... } from './DBlackIcons'
// ============================================================

import React from 'react';

// ── LOGO PRINCIPAL ──────────────────────────────────────────

export const LogoDBlack = ({ variant = 'dark', size = 'md', className = '' }) => {
  const sizes = { sm: 32, md: 40, lg: 52 };
  const iconSize = sizes[size] || 40;
  const isDark = variant === 'dark';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <AppIcon size={iconSize} variant={isDark ? 'teal' : 'dark'} />
      <div>
        <div style={{
          fontSize: size === 'sm' ? 15 : size === 'lg' ? 22 : 18,
          fontWeight: 700,
          letterSpacing: '-0.8px',
          lineHeight: 1,
          color: isDark ? '#ffffff' : '#0d1b18',
        }}>
          D'BLACK{' '}
          <span style={{ color: isDark ? '#1eba8a' : '#0f9e6e' }}>CHAT</span>
        </div>
        <div style={{
          fontSize: 8,
          fontWeight: 500,
          letterSpacing: '3.5px',
          textTransform: 'uppercase',
          color: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(13,27,24,0.35)',
          marginTop: 3,
        }}>
          Multiatendimento
        </div>
      </div>
    </div>
  );
};

// ── APP ICON ─────────────────────────────────────────────────

export const AppIcon = ({ size = 40, variant = 'teal', className = '' }) => {
  const bgMap = { teal: '#1eba8a', dark: '#0d1b18', lime: '#c8ff57' };
  const bg = bgMap[variant] || '#1eba8a';
  const r = Math.round(size * 0.27);

  return (
    <div className={className} style={{
      width: size, height: size,
      borderRadius: r,
      background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 26 26" fill="none">
        <path
          d="M3 6.5C3 5.4 3.9 4.5 5 4.5H15C16.1 4.5 17 5.4 17 6.5V12.5C17 13.6 16.1 14.5 15 14.5H9.5L6 18V14.5H5C3.9 14.5 3 13.6 3 12.5V6.5Z"
          fill={variant === 'teal' ? '#0d1b18' : '#1eba8a'}
        />
        <path
          d="M17 9H20C21.1 9 22 9.9 22 11V15C22 16.1 21.1 17 20 17H19L17.5 18.5V17H17C15.9 17 15 16.1 15 15V14"
          stroke={variant === 'teal' ? '#0d1b18' : '#1eba8a'}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
      </svg>
    </div>
  );
};

// ── SIDEBAR ICONS ─────────────────────────────────────────────

const iconProps = { width: 20, height: 20, viewBox: '0 0 22 22', fill: 'none' };
const s = 'rgba(255,255,255,0.5)'; // stroke color default

export const IconDashboard = ({ active = false, size = 20 }) => (
  <svg {...iconProps} width={size} height={size}>
    <rect x="2" y="2" width="8" height="8" rx="2.5"
      fill={active ? '#0d1b18' : s} opacity={active ? 1 : 0.8}/>
    <rect x="12" y="2" width="8" height="8" rx="2.5"
      fill={active ? '#0d1b18' : s} opacity={active ? 0.55 : 0.4}/>
    <rect x="2" y="12" width="8" height="8" rx="2.5"
      fill={active ? '#0d1b18' : s} opacity={active ? 0.55 : 0.4}/>
    <rect x="12" y="12" width="8" height="8" rx="2.5"
      fill={active ? '#0d1b18' : s} opacity={active ? 0.3 : 0.2}/>
  </svg>
);

export const IconConversas = ({ active = false, size = 20 }) => (
  <svg {...iconProps} width={size} height={size}>
    <path d="M3 5.5C3 4.7 3.7 4 4.5 4H13.5C14.3 4 15 4.7 15 5.5V11C15 11.8 14.3 12.5 13.5 12.5H9L6 15.5V12.5H4.5C3.7 12.5 3 11.8 3 11V5.5Z"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.3"/>
    <path d="M15 7.5H17.5C18.3 7.5 19 8.2 19 9V13C19 13.8 18.3 14.5 17.5 14.5H17L15.5 16V14.5H15C14.2 14.5 13.5 13.8 13.5 13V12"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
    <path d="M6 7.5H12M6 9.5H9.5"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.1" strokeLinecap="round" opacity="0.6"/>
  </svg>
);

export const IconContatos = ({ active = false, size = 20 }) => (
  <svg {...iconProps} width={size} height={size}>
    <circle cx="8" cy="7.5" r="3" stroke={active ? '#0d1b18' : s} strokeWidth="1.3"/>
    <path d="M2.5 17.5C2.5 15.3 5 13.5 8 13.5C11 13.5 13.5 15.3 13.5 17.5"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.3" strokeLinecap="round"/>
    <circle cx="16" cy="8.5" r="2.5" stroke={active ? '#0d1b18' : s} strokeWidth="1.2" opacity="0.45"/>
    <path d="M14.5 14.5C16.2 14.7 17.5 15.8 17.5 17.5"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.2" strokeLinecap="round" opacity="0.45"/>
  </svg>
);

export const IconRespostas = ({ active = false, size = 20 }) => (
  <svg {...iconProps} width={size} height={size}>
    <rect x="3.5" y="4.5" width="15" height="10.5" rx="1.5"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.3"/>
    <path d="M7 8H15M7 11H11"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
    <path d="M8.5 15V18M13.5 15V18M6 18H16"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.2" strokeLinecap="round" opacity="0.4"/>
  </svg>
);

export const IconAgentesIA = ({ active = false, size = 20 }) => (
  <svg {...iconProps} width={size} height={size}>
    <path d="M11 3.5L13.5 8.5L19 9.3L15 13.2L16 18.5L11 15.8L6 18.5L7 13.2L3 9.3L8.5 8.5L11 3.5Z"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);

export const IconRelatorios = ({ active = false, size = 20 }) => (
  <svg {...iconProps} width={size} height={size}>
    {[
      { x: 3.5, h: 5,   op: 0.35 },
      { x: 7,   h: 7,   op: 0.55 },
      { x: 10.5,h: 9.5, op: 1    },
      { x: 14,  h: 6.5, op: 0.55 },
      { x: 17.5,h: 4,   op: 0.35 },
    ].map(({ x, h, op }) => (
      <path key={x}
        d={`M${x} 15.5V${15.5 - h}`}
        stroke={active ? '#0d1b18' : s}
        strokeWidth="1.5" strokeLinecap="round" opacity={active ? op * 0.9 : op}/>
    ))}
    <path d="M2.5 15.5H19.5" stroke={active ? '#0d1b18' : s} strokeWidth="1" strokeLinecap="round" opacity="0.2"/>
  </svg>
);

export const IconConfig = ({ active = false, size = 20 }) => (
  <svg {...iconProps} width={size} height={size}>
    <circle cx="11" cy="11" r="3" stroke={active ? '#0d1b18' : s} strokeWidth="1.3"/>
    <path d="M11 2.5V4.5M11 17.5V19.5M2.5 11H4.5M17.5 11H19.5M4.9 4.9L6.4 6.4M15.6 15.6L17.1 17.1M17.1 4.9L15.6 6.4M6.4 15.6L4.9 17.1"
      stroke={active ? '#0d1b18' : s} strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

// ── NAV ITEM COMPONENT ────────────────────────────────────────

export const SidebarNavItem = ({ icon: Icon, label, active = false, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      padding: '10px 8px',
      borderRadius: 13,
      background: active ? '#1eba8a' : 'transparent',
      border: 'none',
      cursor: 'pointer',
      width: '100%',
      transition: 'background 0.15s',
    }}
  >
    <Icon active={active} size={22} />
    <span style={{
      fontSize: 9.5,
      fontWeight: active ? 600 : 400,
      color: active ? '#0d1b18' : 'rgba(255,255,255,0.4)',
      letterSpacing: '0.2px',
    }}>
      {label}
    </span>
  </button>
);

// ── STATUS BADGE ──────────────────────────────────────────────

export const StatusBadge = ({ status = 'online', label, count }) => {
  const map = {
    online:  { dot: '#1eba8a', text: '#1eba8a',  bg: '#0d1b18',               border: 'transparent' },
    busy:    { dot: '#f59e0b', text: '#f59e0b',  bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.2)' },
    offline: { dot: '#ef4444', text: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.08)' },
    attending: { dot: null,   text: '#1eba8a',  bg: 'rgba(30,186,138,0.08)', border: 'rgba(30,186,138,0.15)' },
    queue:   { dot: null,     text: '#1eba8a',  bg: 'rgba(30,186,138,0.05)', border: 'rgba(30,186,138,0.12)' },
    finished:{ dot: null,     text: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)' },
  };
  const c = map[status] || map.online;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 13px', borderRadius: 8,
      background: c.bg, border: `0.5px solid ${c.border}`,
      fontSize: 11.5, fontWeight: 500, color: c.text,
    }}>
      {c.dot && <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }} />}
      {label}
      {count != null && (
        <div style={{
          width: 17, height: 17, borderRadius: '50%',
          background: '#1eba8a', color: '#0d1b18',
          fontSize: 9, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {count}
        </div>
      )}
    </div>
  );
};

// ── AVATAR ────────────────────────────────────────────────────

const AVATAR_COLORS = [
  { bg: '#1eba8a', text: '#0d1b18' },
  { bg: '#2a1f4a', text: '#b8a8f0' },
  { bg: '#1a3060', text: '#85b7eb' },
  { bg: '#2f1a0a', text: '#d4956a' },
  { bg: '#3d1a2e', text: '#ed93b1' },
];

export const Avatar = ({ name = '', size = 42, index = 0, badge, className = '' }) => {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const c = AVATAR_COLORS[index % AVATAR_COLORS.length];

  return (
    <div className={className} style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: c.bg, color: c.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.32), fontWeight: 700, letterSpacing: '-0.3px',
        flexShrink: 0,
      }}>
        {initials || '?'}
      </div>
      {badge != null && badge > 0 && (
        <div style={{
          position: 'absolute', top: -4, right: -4,
          width: 17, height: 17, borderRadius: '50%',
          background: '#1eba8a', color: '#0d1b18',
          fontSize: 9, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1.5px solid #0f1f1c',
        }}>
          {badge}
        </div>
      )}
    </div>
  );
};

// ── EXPORTS MAP (para uso dinâmico) ───────────────────────────

export const SIDEBAR_ICONS = [
  { key: 'dashboard',  label: 'Dashboard',  Icon: IconDashboard  },
  { key: 'conversas',  label: 'Conversas',  Icon: IconConversas  },
  { key: 'contatos',   label: 'Contatos',   Icon: IconContatos   },
  { key: 'respostas',  label: 'Respostas',  Icon: IconRespostas  },
  { key: 'agentes',    label: 'Ag. IA',     Icon: IconAgentesIA  },
  { key: 'relatorios', label: 'Relatórios', Icon: IconRelatorios },
  { key: 'config',     label: 'Config.',    Icon: IconConfig     },
];
