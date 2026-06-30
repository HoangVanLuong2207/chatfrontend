import Pusher from 'pusher-js';
import {
  register,
  getToken,
  getUser,
  clearToken,
  createConversation,
  getMessages,
  sendMessage,
  sendImage,
  getPusherConfig,
} from './api.js';

// ═══════════════════════════════════════════
// State
// ═══════════════════════════════════════════

let currentUser = null;
let conversationId = null;
let pusherClient = null;
let selectedFile = null;

// ═══════════════════════════════════════════
// DOM Elements
// ═══════════════════════════════════════════

const welcomeScreen = document.getElementById('welcome-screen');
const chatScreen = document.getElementById('chat-screen');
const registerForm = document.getElementById('register-form');
const nameInput = document.getElementById('name-input');
const startBtn = document.getElementById('start-btn');
const registerError = document.getElementById('register-error');
const chatMessages = document.getElementById('chat-messages');
const chatEmpty = document.getElementById('chat-empty');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const imageBtn = document.getElementById('image-btn');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const previewImg = document.getElementById('preview-img');
const previewFilename = document.getElementById('preview-filename');
const previewSize = document.getElementById('preview-size');
const removePreview = document.getElementById('remove-preview');
const logoutBtn = document.getElementById('logout-btn');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const typingIndicator = document.getElementById('typing-indicator');
const toastContainer = document.getElementById('toast-container');

// ═══════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════

async function init() {
  const token = getToken();
  const user = getUser();

  if (token && user) {
    currentUser = user;
    await enterChat();
  }
}

// ═══════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();

  if (!name) {
    showError('Vui lòng nhập tên của bạn');
    return;
  }

  startBtn.classList.add('loading');
  hideError();

  try {
    const data = await register(name);
    currentUser = data.user;
    await enterChat();
  } catch (err) {
    showError(err.message);
  } finally {
    startBtn.classList.remove('loading');
  }
});

logoutBtn.addEventListener('click', () => {
  if (pusherClient) pusherClient.disconnect();
  clearToken();
  currentUser = null;
  conversationId = null;
  selectedFile = null;

  chatScreen.classList.remove('active');
  welcomeScreen.style.display = 'flex';
  chatMessages.innerHTML = '';
  nameInput.value = '';
});

// ═══════════════════════════════════════════
// Enter Chat
// ═══════════════════════════════════════════

async function enterChat() {
  welcomeScreen.style.display = 'none';
  chatScreen.classList.add('active');

  try {
    // Create or get existing conversation
    const conv = await createConversation();
    conversationId = conv.id;

    // Load messages
    await loadMessages();

    // Setup Pusher
    await setupPusher();
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message, 'error');
  }
}

async function loadMessages() {
  if (!conversationId) return;

  try {
    const res = await getMessages(conversationId);
    const messages = res.data;

    chatMessages.innerHTML = '';

    if (messages.length === 0) {
      chatMessages.appendChild(chatEmpty.cloneNode(true));
      chatEmpty.style.display = 'flex';
      return;
    }

    chatEmpty.style.display = 'none';

    messages.forEach((msg) => {
      appendMessage(msg, false);
    });

    scrollToBottom();
  } catch (err) {
    console.error('Load messages error:', err);
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

    const channel = pusherClient.subscribe(`conversation-${conversationId}`);

    channel.bind('new-message', (data) => {
      // Don't duplicate own messages
      if (data.sender_id === currentUser.id) return;
      appendMessage(data);
      scrollToBottom();
      playNotificationSound();
    });

    channel.bind('conversation-closed', () => {
      showToast('Cuộc hội thoại đã được đóng', 'info');
    });
  } catch (err) {
    console.error('Pusher setup error:', err);
  }
}

// ═══════════════════════════════════════════
// Send Messages
// ═══════════════════════════════════════════

sendBtn.addEventListener('click', handleSend);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Auto-resize textarea
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});

async function handleSend() {
  if (selectedFile) {
    await handleSendImage();
    return;
  }

  const content = messageInput.value.trim();
  if (!content || !conversationId) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  try {
    const msg = await sendMessage(conversationId, content);
    appendMessage(msg);
    scrollToBottom();
    hideEmpty();
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

imageBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', (e) => {
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
    previewFilename.textContent = file.name;
    previewSize.textContent = formatFileSize(file.size);
    imagePreview.classList.add('show');
  };
  reader.readAsDataURL(file);
});

removePreview.addEventListener('click', clearImagePreview);

function clearImagePreview() {
  selectedFile = null;
  imageInput.value = '';
  imagePreview.classList.remove('show');
  previewImg.src = '';
}

async function handleSendImage() {
  if (!selectedFile || !conversationId) return;

  const file = selectedFile;
  clearImagePreview();
  sendBtn.disabled = true;

  // Show temp uploading indicator
  const tempId = 'uploading-' + Date.now();
  appendUploadingMessage(tempId);
  scrollToBottom();

  try {
    const msg = await sendImage(conversationId, file);
    // Remove uploading indicator and replace with real message
    const tempEl = document.getElementById(tempId);
    if (tempEl) tempEl.remove();
    appendMessage(msg);
    scrollToBottom();
    hideEmpty();
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
// Render Messages
// ═══════════════════════════════════════════

function appendMessage(msg, animate = true) {
  hideEmpty();
  const isSent = msg.sender_id === currentUser?.id;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
  if (!animate) wrapper.style.animation = 'none';

  const avatarSrc = msg.sender_avatar || `https://api.dicebear.com/9.x/thumbs/svg?seed=${msg.sender_name}`;

  let bubbleContent = '';
  if (msg.type === 'image' && msg.image_url) {
    bubbleContent = `<div class="message-bubble image-bubble">
      <img src="${msg.image_url}" alt="Ảnh" onclick="window.openLightbox('${msg.image_url}')" loading="lazy" />
    </div>`;
  } else {
    bubbleContent = `<div class="message-bubble">${escapeHtml(msg.content)}</div>`;
  }

  const senderLabel = !isSent ? `<div class="message-sender-name">${escapeHtml(msg.sender_name || 'Admin')}</div>` : '';

  wrapper.innerHTML = `
    <img class="message-avatar" src="${avatarSrc}" alt="${escapeHtml(msg.sender_name || '')}" />
    <div>
      ${senderLabel}
      ${bubbleContent}
      <div class="message-time">${formatTime(msg.created_at)}</div>
    </div>
  `;

  chatMessages.appendChild(wrapper);
}

function appendUploadingMessage(id) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper sent';
  wrapper.id = id;
  wrapper.innerHTML = `
    <div>
      <div class="message-bubble" style="display:flex;align-items:center;gap:8px;">
        <span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;"></span>
        Đang tải ảnh...
      </div>
    </div>
  `;
  chatMessages.appendChild(wrapper);
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function hideEmpty() {
  const empty = chatMessages.querySelector('.chat-empty');
  if (empty) empty.style.display = 'none';
}

function showError(msg) {
  registerError.textContent = msg;
  registerError.classList.add('show');
}

function hideError() {
  registerError.classList.remove('show');
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
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not supported
  }
}

// ═══════════════════════════════════════════
// Start
// ═══════════════════════════════════════════

init();
