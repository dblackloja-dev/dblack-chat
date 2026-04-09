// ============================================================
// D'BLACK CHAT — Design Tokens v1.0
// Gerado para uso no Claude Code
// Aplicar em: tailwind.config.js ou CSS variables globais
// ============================================================

export const colors = {
  // Primária — Verde teal D'Black
  primary: {
    DEFAULT: '#1eba8a',
    light:   '#4fcca3',
    dark:    '#0f9e6e',
    subtle:  'rgba(30, 186, 138, 0.08)',
    border:  'rgba(30, 186, 138, 0.2)',
  },

  // Base — Fundo escuro
  base: {
    900: '#0d1b18',  // sidebar, fundo principal
    800: '#0f1f1c',  // cards secundários
    700: '#142420',  // hover states
    600: '#1a2e2a',  // bordas, divisores
    500: '#233d38',  // elementos elevados
  },

  // Neutros
  neutral: {
    white:   '#ffffff',
    50:      '#f2faf7',
    100:     '#e4f5ef',
    200:     '#c8e8dd',
    300:     '#8cbfb0',
    400:     '#5a9e8c',
    500:     'rgba(255,255,255,0.5)',
    600:     'rgba(255,255,255,0.3)',
    700:     'rgba(255,255,255,0.15)',
    800:     'rgba(255,255,255,0.08)',
    900:     'rgba(255,255,255,0.04)',
  },

  // Status
  status: {
    online:  '#1eba8a',
    busy:    '#f59e0b',
    offline: '#ef4444',
    info:    '#3b82f6',
  },

  // Semânticas UI
  success:  { bg: 'rgba(30,186,138,0.1)', text: '#1eba8a',  border: 'rgba(30,186,138,0.2)'  },
  warning:  { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b',  border: 'rgba(245,158,11,0.2)'  },
  danger:   { bg: 'rgba(239,68,68,0.1)',  text: '#ef4444',  border: 'rgba(239,68,68,0.2)'   },
  info:     { bg: 'rgba(59,130,246,0.1)', text: '#60a5fa',  border: 'rgba(59,130,246,0.2)'  },
};

export const typography = {
  fontFamily: "-apple-system, 'Inter', 'SF Pro Display', sans-serif",
  weights: { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 },
  sizes: {
    xs:   '10px',
    sm:   '11px',
    base: '13px',
    md:   '14px',
    lg:   '16px',
    xl:   '18px',
    '2xl':'20px',
    '3xl':'24px',
  },
  tracking: {
    tight:  '-0.5px',
    normal: '0px',
    wide:   '1px',
    wider:  '2.5px',
    widest: '4px',
  },
};

export const spacing = {
  1: '4px',  2: '8px',   3: '12px',  4: '16px',
  5: '20px', 6: '24px',  7: '28px',  8: '32px',
  10: '40px', 12: '48px',
};

export const radius = {
  sm:   '6px',
  md:   '8px',
  lg:   '12px',
  xl:   '16px',
  '2xl':'20px',
  full: '9999px',
};

export const shadows = {
  none: 'none',
  ring: '0 0 0 2px rgba(30,186,138,0.4)',
};

// CSS Variables — colar no :root do CSS global
export const cssVariables = `
:root {
  --color-primary:        #1eba8a;
  --color-primary-light:  #4fcca3;
  --color-primary-dark:   #0f9e6e;
  --color-primary-subtle: rgba(30,186,138,0.08);
  --color-primary-border: rgba(30,186,138,0.2);

  --color-base-900: #0d1b18;
  --color-base-800: #0f1f1c;
  --color-base-700: #142420;
  --color-base-600: #1a2e2a;
  --color-base-500: #233d38;

  --color-text-primary:   rgba(255,255,255,0.92);
  --color-text-secondary: rgba(255,255,255,0.55);
  --color-text-muted:     rgba(255,255,255,0.3);
  --color-text-disabled:  rgba(255,255,255,0.2);

  --color-border:         rgba(255,255,255,0.07);
  --color-border-hover:   rgba(255,255,255,0.12);

  --color-online:  #1eba8a;
  --color-busy:    #f59e0b;
  --color-offline: #ef4444;

  --radius-sm:   6px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-full: 9999px;

  --font-sans: -apple-system, 'Inter', 'SF Pro Display', sans-serif;
}
`;

// Tailwind extend config
export const tailwindExtend = {
  colors: {
    primary: colors.primary,
    base: colors.base,
  },
  borderRadius: radius,
  fontFamily: { sans: ['-apple-system', 'Inter', 'SF Pro Display', 'sans-serif'] },
};
