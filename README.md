# D'Black Chat — Plataforma de Atendimento WhatsApp

Sistema de atendimento ao cliente via WhatsApp para a D'Black Store, com multi-atendentes, fila de espera e chat em tempo real.

## Funcionalidades

- **Conexão WhatsApp** via QR Code (Baileys)
- **Multi-atendente** — 3+ atendentes simultâneos no mesmo número
- **3 abas:** Atendendo | Aguardando | Finalizados
- **Espiar conversa** — ver mensagens antes de aceitar
- **Transferir** — devolver conversa pra fila
- **Tempo real** — mensagens via WebSocket
- **Admin** — criar/editar/excluir atendentes
- **Notificação sonora** — alerta de nova mensagem

## Como rodar localmente

### Backend
```bash
cd backend
npm install
# Configure o .env com DATABASE_URL e JWT_SECRET
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Acesse http://localhost:5174

### Login padrão
- **E-mail:** admin@dblack.com
- **Senha:** admin123

## Deploy

- **Backend:** Railway (Node.js)
- **Frontend:** Vercel (Vite + React)

## Variáveis de ambiente (Backend)

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | URL do PostgreSQL (Neon, Supabase, etc.) |
| `JWT_SECRET` | Chave secreta para tokens JWT |
| `PORT` | Porta do servidor (padrão: 3002) |
