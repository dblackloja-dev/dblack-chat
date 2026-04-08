const BASE = '/api';
const getToken = () => localStorage.getItem('dblack_chat_token');
const setToken = (t) => localStorage.setItem('dblack_chat_token', t);
const clearToken = () => localStorage.removeItem('dblack_chat_token');

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { clearToken(); window.location.reload(); return; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro de rede' }));
    throw new Error(err.error || 'Erro na requisição');
  }
  return res.json();
}

const api = {
  // Auth
  login: async (email, password) => {
    const data = await request('/auth/login', { method: 'POST', body: { email, password } });
    if (data?.token) setToken(data.token);
    return data;
  },
  me: async () => {
    if (!getToken()) return null;
    const res = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { clearToken(); return null; }
    return res.json();
  },
  logout: () => clearToken(),
  getToken,

  // Users
  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: data }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: data }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  // Conversations
  getConversations: () => request('/conversations'),
  acceptConversation: (id) => request(`/conversations/${id}/accept`, { method: 'POST' }),
  finishConversation: (id) => request(`/conversations/${id}/finish`, { method: 'POST' }),
  transferConversation: (id) => request(`/conversations/${id}/transfer`, { method: 'POST' }),

  // Messages
  getMessages: (convId) => request(`/messages/${convId}`),
  sendMessage: (data) => request('/messages/send', { method: 'POST', body: data }),

  // WhatsApp
  getWhatsAppStatus: () => request('/whatsapp/status'),
  reconnectWhatsApp: () => request('/whatsapp/reconnect', { method: 'POST' }),
};

export default api;
