import Pusher from 'pusher-js';
import {
  adminLogin,
  getToken,
  getUser,
  clearToken,
  getConversations,
  assignConversation,
  closeConversation,
  getMessages,
  sendMessage,
  sendImage,
  getPusherConfig,
} from './api.js';

// ═══════════════════════════════════════════
// State
// ═══════════════════════════════════════════

let currentAdmin = null;
let conversations = [];
let activeConversationId = null;
let pusherClient = null;
let subscribedChannels = {};
let selectedFile = null;
let unreadCounts = {};

// ═══════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════

const loginScreen = document.getElementById('login-screen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const conversationList = document.getElementById('conversation-list');
const sidebarEmpty = document.getElementById('sidebar-empty');
const searchInput = document.getElementById('search-input');
const refreshBtn = document.getElementById('refresh-btn');
const logoutBtn = document.getElementById('admin-logout-btn');
const noChat = document.getElementById('no-chat');
const activeChat = document.getElementById('active-chat');
const chatAvatar = document.getElementById('chat-avatar');
const chatUserName = document.getElementById('chat-user-name');
const adminMessages = document.getElementById('admin-messages');
const messageInput = document.getElementById('admin-message-input');
const sendBtn = document.getElementById('admin-send-btn');
const imgBtn = document.getElementById('admin-img-btn');
const imgInput = document.getElementById('admin-image-input');
const imgPreview = document.getElementById('admin-img-preview');
const previewImg = document.getElementById('admin-preview-img');
const previewName = document.getElementById('admin-preview-name');
const previewSize = document.getElementById('admin-preview-size');
const removePreview = document.getElementById('admin-remove-preview');
const closeConvBtn = document.getElementById('close-conv-btn');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const toastContainer = document.getElementById('toast-container');

// ═══════════════════════════════════════════
// Init
// ═══════════════════════════════════════════

async function init() {
  const token = getToken();
  const user = getUser();

  if (token && user && user.role === 'admin') {
    currentAdmin = user;
    await enterDashboard();
  }
}

// ═══════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showLoginError('Vui lòng nhập đầy đủ thông tin');
    return;
  }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  hideLoginError();

  try {
    const data = await adminLogin(username, password);
    currentAdmin = data.user;
    await enterDashboard();
  } catch (err) {
    showLoginError(err.message);
  } finally {
    btn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  if (pusherClient) pusherClient.disconnect();
  clearToken();
  currentAdmin = null;
  activeConversationId = null;
  conversations = [];
  subscribedChannels = {};
  unreadCounts = {};

  dashboard.classList.remove('active');
  loginScreen.style.display = 'flex';
});

// ═══════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════

async function enterDashboard() {
  loginScreen.style.display = 'none';
  dashboard.classList.add('active');

  await loadConversations();
  await setupPusher();
}

async function loadConversations() {
  try {
    conversations = await getConversations();
    renderConversationList();
  } catch (err) {
    showToast('Lỗi tải danh sách hội thoại: ' + err.message, 'error');
  }
}

refreshBtn.addEventListener('click', loadConversations);

// Search
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  renderConversationList(query);
});

function renderConversationList(filter = '') {
  // Keep the empty element reference
  const filtered = conversations.filter((c) => {
    if (!filter) return true;
    return (c.user_name || '').toLowerCase().includes(filter);
  });

  // Remove existing items (not the empty placeholder)
  conversationList.querySelectorAll('.conversation-item').forEach((el) => el.remove());

  if (filtered.length === 0) {
    sidebarEmpty.style.display = 'flex';
    return;
  }

  sidebarEmpty.style.display = 'none';

  filtered.forEach((conv) => {
    const el = document.createElement('div');
    el.className = `conversation-item ${conv.id === activeConversationId ? 'active' : ''}`;
    el.dataset.id = conv.id;

    const avatarUrl = conv.user_avatar || `https://api.dicebear.com/9.x/thumbs/svg?seed=${conv.user_name}`;
    const lastMsg = conv.last_message_type === 'image' ? '🖼️ Ảnh' : (conv.last_message || 'Chưa có tin nhắn');
    const time = conv.last_message_at ? formatTime(conv.last_message_at) : formatTime(conv.created_at);
    const unread = unreadCounts[conv.id] || 0;
    const statusLabel = conv.status === 'closed' ? ' · Đã đóng' : '';

    el.innerHTML = `
      <img class="avatar" src="${avatarUrl}" alt="${escapeHtml(conv.user_name || 'User')}" />
      <div class="info">
        <div class="name">${escapeHtml(conv.user_name || 'Khách')}${statusLabel}</div>
        <div class="last-msg">${escapeHtml(lastMsg)}</div>
      </div>
      <div class="meta">
        <div class="time">${time}</div>
        <span class="unread-badge ${unread === 0 ? 'hidden' : ''}">${unread}</span>
      </div>
    `;

    el.addEventListener('click', () => selectConversation(conv));
    conversationList.appendChild(el);
  });
}

// ═══════════════════════════════════════════
// Select Conversation
// ═══════════════════════════════════════════

async function selectConversation(conv) {
  activeConversationId = conv.id;
  unreadCounts[conv.id] = 0;

  // Update sidebar active state
  conversationList.querySelectorAll('.conversation-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === conv.id);
  });

  // Update header
  const avatarUrl = conv.user_avatar || `https://api.dicebear.com/9.x/thumbs/svg?seed=${conv.user_name}`;
  chatAvatar.src = avatarUrl;
  chatUserName.textContent = conv.user_name || 'Khách';

  // Show chat panel
  noChat.style.display = 'none';
  activeChat.style.display = 'flex';

  // Auto-assign if not assigned
  if (!conv.admin_id && conv.status === 'open') {
    try {
      await assignConversation(conv.id);
      conv.admin_id = currentAdmin.id;
    } catch {
      // ignore
    }
  }

  // Load messages
  await loadChatMessages(conv.id);

  // Subscribe to this conversation's channel
  subscribeToConversation(conv.id);

  messageInput.focus();
}

async function loadChatMessages(conversationId) {
  adminMessages.innerHTML = '';

  try {
    const res = await getMessages(conversationId);
    res.data.forEach((msg) => appendAdminMessage(msg, false));
    scrollToBottom();
  } catch (err) {
    showToast('Lỗi tải tin nhắn: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════
// Pusher
// ═══════════════════════════════════════════

async function setupPusher() {
  try {
    const config = await getPusherConfig();

    pusherClient = new Pusher(config.key, {
      cluster: config.cluster,
      forceTLS: true,
    });

    // Subscribe to admin notifications channel
    const adminChannel = pusherClient.subscribe('admin-notifications');

    adminChannel.bind('new-conversation', (data) => {
      // Add new conversation to list
      const newConv = {
        ...data.conversation,
        user_name: data.user.name,
        user_avatar: data.user.avatar_url,
        last_message: null,
        last_message_type: null,
        message_count: 0,
      };

      // Check if conversation already exists
      const existingIndex = conversations.findIndex((c) => c.id === newConv.id);
      if (existingIndex === -1) {
        conversations.unshift(newConv);
      }

      renderConversationList();
      showToast(`${data.user.name} bắt đầu cuộc hội thoại mới`, 'info');
      playNotificationSound();
    });

    adminChannel.bind('new-message', (data) => {
      // Update conversation in sidebar
      const conv = conversations.find((c) => c.id === data.conversation_id);
      if (conv) {
        conv.last_message = data.message.content;
        conv.last_message_type = data.message.type;
        conv.last_message_at = data.message.created_at;

        // If not the active conversation, increment unread count
        if (data.conversation_id !== activeConversationId) {
          unreadCounts[data.conversation_id] = (unreadCounts[data.conversation_id] || 0) + 1;
          playNotificationSound();
        }

        // Move conversation to top
        conversations.sort((a, b) => {
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(bTime) - new Date(aTime);
        });

        renderConversationList();
      }
    });

    // Subscribe to all existing conversations
    conversations.forEach((conv) => {
      subscribeToConversation(conv.id);
    });
  } catch (err) {
    console.error('Pusher setup error:', err);
  }
}

function subscribeToConversation(conversationId) {
  if (subscribedChannels[conversationId]) return;

  const channel = pusherClient.subscribe(`conversation-${conversationId}`);
  subscribedChannels[conversationId] = channel;

  channel.bind('new-message', (data) => {
    // Don't duplicate admin's own messages
    if (data.sender_id === currentAdmin?.id) return;

    // If this is the active conversation, append message
    if (conversationId === activeConversationId) {
      appendAdminMessage(data);
      scrollToBottom();
    }
  });

  channel.bind('conversation-closed', () => {
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.status = 'closed';
      renderConversationList();
    }
  });
}

// ═══════════════════════════════════════════
// Send Messages
// ═══════════════════════════════════════════

sendBtn.addEventListener('click', handleAdminSend);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAdminSend();
  }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});

async function handleAdminSend() {
  if (selectedFile) {
    await handleAdminSendImage();
    return;
  }

  const content = messageInput.value.trim();
  if (!content || !activeConversationId) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  try {
    const msg = await sendMessage(activeConversationId, content);
    appendAdminMessage(msg);
    scrollToBottom();

    // Update sidebar
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (conv) {
      conv.last_message = content;
      conv.last_message_type = 'text';
      conv.last_message_at = msg.created_at;
      renderConversationList();
    }
  } catch (err) {
    showToast('Lỗi gửi tin nhắn: ' + err.message, 'error');
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

// ═══════════════════════════════════════════
// Image Upload
// ═══════════════════════════════════════════

imgBtn.addEventListener('click', () => imgInput.click());

imgInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Chỉ chấp nhận file ảnh', 'error');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showToast('Ảnh không được vượt quá 10MB', 'error');
    return;
  }

  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    previewImg.src = ev.target.result;
    previewName.textContent = file.name;
    previewSize.textContent = formatFileSize(file.size);
    imgPreview.classList.add('show');
  };
  reader.readAsDataURL(file);
});

removePreview.addEventListener('click', clearAdminPreview);

function clearAdminPreview() {
  selectedFile = null;
  imgInput.value = '';
  imgPreview.classList.remove('show');
}

async function handleAdminSendImage() {
  if (!selectedFile || !activeConversationId) return;

  const file = selectedFile;
  clearAdminPreview();
  sendBtn.disabled = true;

  // Temp uploading
  const tempId = 'admin-uploading-' + Date.now();
  appendUploadingMsg(tempId);
  scrollToBottom();

  try {
    const msg = await sendImage(activeConversationId, file);
    const tempEl = document.getElementById(tempId);
    if (tempEl) tempEl.remove();
    appendAdminMessage(msg);
    scrollToBottom();

    // Update sidebar
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (conv) {
      conv.last_message = null;
      conv.last_message_type = 'image';
      conv.last_message_at = msg.created_at;
      renderConversationList();
    }
  } catch (err) {
    const tempEl = document.getElementById(tempId);
    if (tempEl) tempEl.remove();
    showToast('Lỗi gửi ảnh: ' + err.message, 'error');
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

// ═══════════════════════════════════════════
// Close Conversation
// ═══════════════════════════════════════════

closeConvBtn.addEventListener('click', async () => {
  if (!activeConversationId) return;

  try {
    await closeConversation(activeConversationId);
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (conv) conv.status = 'closed';

    renderConversationList();
    showToast('Đã đóng cuộc hội thoại', 'success');
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
});

// ═══════════════════════════════════════════
// Render Messages
// ═══════════════════════════════════════════

function appendAdminMessage(msg, animate = true) {
  const isSent = msg.sender_id === currentAdmin?.id;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
  if (!animate) wrapper.style.animation = 'none';

  const avatarSrc = msg.sender_avatar || `https://api.dicebear.com/9.x/thumbs/svg?seed=${msg.sender_name}`;

  let bubbleHtml = '';
  if (msg.type === 'image' && msg.image_url) {
    bubbleHtml = `<div class="msg-bubble image-msg">
      <img src="${msg.image_url}" alt="Ảnh" onclick="window.openLightbox('${msg.image_url}')" loading="lazy" />
    </div>`;
  } else {
    bubbleHtml = `<div class="msg-bubble">${escapeHtml(msg.content)}</div>`;
  }

  const senderLabel = !isSent ? `<div class="msg-sender">${escapeHtml(msg.sender_name || 'User')}</div>` : '';

  wrapper.innerHTML = `
    <img class="msg-avatar" src="${avatarSrc}" alt="" />
    <div>
      ${senderLabel}
      ${bubbleHtml}
      <div class="msg-time">${formatTime(msg.created_at)}</div>
    </div>
  `;

  adminMessages.appendChild(wrapper);
}

function appendUploadingMsg(id) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper sent';
  wrapper.id = id;
  wrapper.innerHTML = `
    <div>
      <div class="msg-bubble" style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;"></span>
        Đang tải ảnh...
      </div>
    </div>
  `;
  adminMessages.appendChild(wrapper);
}

// ═══════════════════════════════════════════
// Lightbox
// ═══════════════════════════════════════════

window.openLightbox = function (src) {
  lightboxImg.src = src;
  lightbox.classList.add('show');
};

lightbox.addEventListener('click', (e) => {
  if (e.target !== lightboxImg) {
    lightbox.classList.remove('show');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox.classList.contains('show')) {
    lightbox.classList.remove('show');
  }
});

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function scrollToBottom() {
  requestAnimationFrame(() => {
    adminMessages.scrollTop = adminMessages.scrollHeight;
  });
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.add('show');
}

function hideLoginError() {
  loginError.classList.remove('show');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 600;
    osc.type = 'sine';
    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // ignore
  }
}

// ═══════════════════════════════════════════
// Start
// ═══════════════════════════════════════════

init();
