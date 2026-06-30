/**
 * API Helper — handles all HTTP calls to backend
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function getToken() {
  return localStorage.getItem('chatbox_token');
}

function setToken(token) {
  localStorage.setItem('chatbox_token', token);
}

function clearToken() {
  localStorage.removeItem('chatbox_token');
  localStorage.removeItem('chatbox_user');
}

function getUser() {
  const raw = localStorage.getItem('chatbox_user');
  return raw ? JSON.parse(raw) : null;
}

function setUser(user) {
  localStorage.setItem('chatbox_user', JSON.stringify(user));
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || 'Lỗi không xác định');
  }

  return data;
}

// Auth
export async function register(name) {
  const res = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  setToken(res.data.token);
  setUser(res.data.user);
  return res.data;
}

export async function adminLogin(username, password) {
  const res = await request('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(res.data.token);
  setUser(res.data.user);
  return res.data;
}

export async function getMe() {
  const res = await request('/api/auth/me');
  return res.data;
}

// Conversations
export async function getConversations() {
  const res = await request('/api/conversations');
  return res.data;
}

export async function createConversation() {
  const res = await request('/api/conversations', { method: 'POST' });
  return res.data;
}

export async function assignConversation(id) {
  const res = await request(`/api/conversations/${id}/assign`, { method: 'PATCH' });
  return res;
}

export async function closeConversation(id) {
  const res = await request(`/api/conversations/${id}/close`, { method: 'PATCH' });
  return res;
}

// Messages
export async function getMessages(conversationId, page = 1) {
  const res = await request(`/api/messages/${conversationId}?page=${page}`);
  return res;
}

export async function sendMessage(conversationId, content) {
  const res = await request('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, content }),
  });
  return res.data;
}

export async function sendImage(conversationId, file) {
  const formData = new FormData();
  formData.append('conversation_id', conversationId);
  formData.append('image', file);

  const res = await request('/api/messages/image', {
    method: 'POST',
    body: formData,
  });
  return res.data;
}

// Pusher config
export async function getPusherConfig() {
  const res = await request('/api/pusher/config');
  return res;
}

// Web Push
export async function getVapidKey() {
  const res = await request('/api/push/vapid-key');
  return res.data.publicKey;
}

export async function subscribePush(subscription) {
  const res = await request('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  });
  return res;
}

export async function unsubscribePush(endpoint) {
  const res = await request('/api/push/unsubscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
  return res;
}

export { getToken, setToken, clearToken, getUser, setUser, API_URL };
