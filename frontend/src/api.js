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

// Monta URL de mídia com token de autenticação (para <img>, <audio>, <a> que precisam acessar /media/)
function mediaUrl(url) {
  if (!url) return url;
  if (!url.startsWith('/media/')) return url;
  const token = getToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
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
  markUnread: (id) => request(`/conversations/${id}/mark-unread`, { method: 'POST' }),

  // Messages
  getMessages: (convId) => request(`/messages/${convId}`),
  sendMessage: (data) => request('/messages/send', { method: 'POST', body: data }),
  deleteMessage: (id) => request(`/messages/${id}`, { method: 'DELETE' }),
  sendAudio: async (conversationId, blob) => {
    const token = getToken();
    const form = new FormData();
    form.append('audio', blob, 'audio.ogg');
    form.append('conversation_id', conversationId);
    const res = await fetch(`${BASE}/messages/send-audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error('Erro ao enviar áudio');
    return res.json();
  },
  sendFile: async (conversationId, file) => {
    const token = getToken();
    const form = new FormData();
    form.append('file', file);
    form.append('conversation_id', conversationId);
    const res = await fetch(`${BASE}/messages/send-file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error('Erro ao enviar arquivo');
    return res.json();
  },
  sendImage: async (conversationId, file, caption) => {
    const token = getToken();
    const form = new FormData();
    form.append('image', file);
    form.append('conversation_id', conversationId);
    if (caption) form.append('caption', caption);
    const res = await fetch(`${BASE}/messages/send-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error('Erro ao enviar imagem');
    return res.json();
  },
  sendVideo: async (conversationId, file, caption) => {
    const token = getToken();
    const form = new FormData();
    form.append('video', file);
    form.append('conversation_id', conversationId);
    if (caption) form.append('caption', caption);
    const res = await fetch(`${BASE}/messages/send-video`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error('Erro ao enviar vídeo');
    return res.json();
  },

  // WhatsApp
  getWhatsAppStatus: () => request('/whatsapp/status'),
  reconnectWhatsApp: () => request('/whatsapp/reconnect', { method: 'POST' }),
  pairWhatsApp: (phone) => request('/whatsapp/pair', { method: 'POST', body: { phone } }),

  // Quick Replies
  getQuickReplies: () => request('/quick-replies'),
  createQuickReply: async (data, imageFile) => {
    if (!imageFile) return request('/quick-replies', { method: 'POST', body: data });
    const token = getToken();
    const form = new FormData();
    form.append('label', data.label);
    form.append('text', data.text);
    form.append('category', data.category || 'geral');
    form.append('image', imageFile);
    const res = await fetch(`${BASE}/quick-replies`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    return res.json();
  },
  updateQuickReply: async (id, data, imageFile) => {
    if (!imageFile && !data.remove_image) return request(`/quick-replies/${id}`, { method: 'PUT', body: data });
    const token = getToken();
    const form = new FormData();
    form.append('label', data.label);
    form.append('text', data.text);
    form.append('category', data.category || 'geral');
    if (data.remove_image) form.append('remove_image', 'true');
    if (imageFile) form.append('image', imageFile);
    const res = await fetch(`${BASE}/quick-replies/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form });
    return res.json();
  },
  deleteQuickReply: (id) => request(`/quick-replies/${id}`, { method: 'DELETE' }),

  // Settings
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: data }),

  // AI Agents
  getAIAgents: () => request('/ai-agents'),
  createAIAgent: (data) => request('/ai-agents', { method: 'POST', body: data }),
  updateAIAgent: (id, data) => request(`/ai-agents/${id}`, { method: 'PUT', body: data }),
  deleteAIAgent: (id) => request(`/ai-agents/${id}`, { method: 'DELETE' }),

  // Dashboard & Reports
  getDashboard: () => request('/dashboard'),
  getReports: (from, to) => request(`/reports?from=${from}&to=${to}`),

  // Contacts (do Chat)
  getContacts: () => request('/contacts'),
  // Customers (do ERP)
  getCustomers: (q) => request(`/erp/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  // Tags
  getConvTags: (convId) => request(`/conversations/${convId}/tags`),
  addConvTag: (convId, data) => request(`/conversations/${convId}/tags`, { method: 'POST', body: data }),
  removeConvTag: (convId, tagId) => request(`/conversations/${convId}/tags/${tagId}`, { method: 'DELETE' }),

  // Histórico e busca
  getConvHistory: (phone) => request(`/conversations/history/${phone}`),
  searchMessages: (q) => request(`/messages/search?q=${encodeURIComponent(q)}`),

  // Fila inteligente
  autoAssign: (convId) => request(`/conversations/${convId}/auto-assign`, { method: 'POST' }),

  // Métricas IA
  getAIMetrics: () => request('/ai-metrics'),

  // ERP — Vendas
  searchProducts: (q) => request(`/erp/products?q=${encodeURIComponent(q)}`),
  getProductStock: (id) => request(`/erp/products/${id}/stock`),
  getStores: () => request('/erp/stores'),
  findCustomer: (phone) => request(`/erp/customer/${phone}`),
  getCustomerDetails: (phone) => request(`/erp/customer-details/${phone}`),
  createSale: (data) => request('/erp/sales', { method: 'POST', body: data }),
};

export { mediaUrl };
export default api;
