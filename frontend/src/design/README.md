# D'BLACK CHAT — Design System v1.0
## Instruções para o Claude Code

---

## O QUE ESTÁ NESTE PACOTE

| Arquivo | O que é |
|---|---|
| `design-tokens.js` | Cores, tipografia, espaçamento e CSS variables |
| `DBlackIcons.jsx` | Logo, AppIcon, todos os ícones do sidebar, Avatar, StatusBadge |
| `Sidebar.jsx` | Componente completo do sidebar com navegação |
| `README.md` | Este arquivo |

---

## PALETA DE CORES PRINCIPAL

| Token | Valor | Uso |
|---|---|---|
| `--color-primary` | `#1eba8a` | Teal — cor principal, ativo, CTA |
| `--color-base-900` | `#0d1b18` | Fundo sidebar |
| `--color-base-800` | `#0f1f1c` | Fundo principal |
| `--color-base-700` | `#142420` | Cards, hover |
| `--color-base-600` | `#1a2e2a` | Bordas, divisores |
| `--color-online` | `#1eba8a` | Status online |
| `--color-busy` | `#f59e0b` | Status ocupado |
| `--color-offline` | `#ef4444` | Status offline |

---

## PASSO A PASSO PARA APLICAR

### 1. Adicionar CSS Variables globais
Cole o conteúdo de `cssVariables` de `design-tokens.js` no arquivo CSS global do projeto (ex: `globals.css`, `index.css`, `App.css`).

### 2. Copiar os componentes
```
src/
  components/
    icons/
      DBlackIcons.jsx     ← copiar aqui
    layout/
      Sidebar.jsx         ← copiar aqui
```

### 3. Substituir a sidebar atual
Encontre onde o sidebar atual é renderizado e substitua pelo componente novo:

```jsx
// ANTES (remover)
import Sidebar from './components/Sidebar'  // ou equivalente

// DEPOIS
import Sidebar from './components/layout/Sidebar'

// Uso
<Sidebar
  activeRoute="dashboard"
  onNavigate={(route) => router.push(`/${route}`)}
  agentName="Denilson"
  agentStatus="online"
  queueCount={1}
/>
```

### 4. Usar os ícones individualmente
```jsx
import { IconDashboard, IconConversas, AppIcon, Avatar, StatusBadge } from './components/icons/DBlackIcons'

// Ícone simples
<IconDashboard active={true} size={22} />

// App icon
<AppIcon size={40} variant="teal" />  // 'teal' | 'dark' | 'lime'

// Avatar com badge
<Avatar name="Denilson N" size={42} index={0} badge={2} />

// Status badge
<StatusBadge status="online" label="Online" />
<StatusBadge status="attending" label="Atendendo" count={2} />
<StatusBadge status="queue" label="Fila" count={1} />
<StatusBadge status="finished" label="Finalizados 6" />
```

### 5. Atualizar o header/topbar
Substituir o logo atual pelo componente `LogoDBlack`:
```jsx
import { LogoDBlack } from './components/icons/DBlackIcons'

<LogoDBlack variant="dark" size="md" />
// variant: 'dark' | 'light'
// size: 'sm' | 'md' | 'lg'
```

---

## MAPEAMENTO DE ROTAS × ÍCONES

| Rota | key | Ícone |
|---|---|---|
| `/dashboard` | `dashboard` | IconDashboard |
| `/conversas` | `conversas` | IconConversas |
| `/contatos` | `contatos` | IconContatos |
| `/respostas-rapidas` | `respostas` | IconRespostas |
| `/agentes-ia` | `agentes` | IconAgentesIA |
| `/relatorios` | `relatorios` | IconRelatorios |
| `/configuracoes` | `config` | IconConfig |

---

## COMPORTAMENTO DO ÍCONE ATIVO

Quando `active={true}`:
- Container: `background: #1eba8a` (verde teal sólido)
- Ícone SVG: `stroke/fill: '#0d1b18'` (preto escuro — contraste)
- Label: `color: '#1eba8a'`, `fontWeight: 600`

Quando `active={false}`:
- Container: `background: transparent`
- Ícone SVG: `stroke: rgba(255,255,255,0.5)`
- Label: `color: rgba(255,255,255,0.4)`

---

## DEPENDÊNCIAS NECESSÁRIAS
- React 17+ (hooks)
- Nenhuma biblioteca externa de ícones — tudo é SVG inline nativo
