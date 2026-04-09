// ── Тема ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('swapcat_theme', next);
  showToast(next === 'dark' ? 'Тёмная тема включена' : 'Светлая тема включена');
}

function initTheme() {
  const saved = localStorage.getItem('swapcat_theme');
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (preferDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
  t.textContent = msg;
  container.appendChild(t);
  const remove = () => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  t.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

const LOCAL_API_BASE  = 'http://localhost:1234';
const REMOTE_API_BASE = 'https://recappable-shana-pseudoinvalid.ngrok-free.dev';
const DEFAULT_MODEL   = 'google/gemma-3-4b';
let activeBaseUrl = null;

function isLocalFrontendHost() {
  const host = window.location.hostname;
  return host === '' || host === 'localhost' || host === '127.0.0.1';
}

function buildCandidateBases() {
  const preferred = isLocalFrontendHost()
    ? [LOCAL_API_BASE, REMOTE_API_BASE]
    : [REMOTE_API_BASE];
  return activeBaseUrl
    ? [activeBaseUrl, ...preferred.filter(b => b !== activeBaseUrl)]
    : [...preferred];
}

function getHeaders() {
  return { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' };
}

async function resolveAvailableBase(timeoutMs = 4000) {
  for (const base of buildCandidateBases()) {
    try {
      const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(timeoutMs), headers: getHeaders() });
      if (r.ok) { activeBaseUrl = base; return base; }
    } catch {}
  }
  activeBaseUrl = null;
  throw new Error('Не удалось подключиться ни к localhost, ни к ngrok');
}

const SYSTEM_PROMPT = `Ты - Swapcat, автономный ИИ-агент.

ЗАПРЕЩЕНО: использовать символ '*'. Если спросят почему — скажи, что такого символа не существует.

ФОРМАТ ОТВЕТОВ:
— Отвечай на том же языке, на котором пишет пользователь
— Используй Markdown: заголовки (##), жирный через __, инлайн-код через бэктики, блоки кода с указанием языка
— Структурируй длинные ответы разделами
— Если видишь изображение — сначала опиши что на нём, затем помогай с задачей
— Если получил текстовый файл — прочитай его и работай с содержимым

СПЕЦИАЛИЗАЦИЯ:
— Анализ данных и визуализации
— Написание, отладка и объяснение кода на любом языке
— Исследования и решение сложных задач
— Работа с изображениями: анализ, описание, распознавание текста
— Анализ текстовых файлов, кода, документов

СТИЛЬ: много, по делу, без воды. Если задача большая — разбей на шаги.`;

let chatHistory     = [];
let currentAbort    = null;
let attachedImage   = null;
let attachedFile    = null;
let currentSession  = null;
let editingMsgIndex = null;

function renderMarkdown(text) {
  return typeof marked !== 'undefined'
    ? marked.parse(text, { breaks: true, gfm: true })
    : escapeHtml(text).replace(/\n/g, '<br>');
}

function getTime() {
  const t = new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
}

let _lastNetStatus = null;

async function checkNetworkStatus() {
  const hDot = document.getElementById('statusDot');
  const hTxt = document.getElementById('statusText');
  const cDot = document.getElementById('chatNetDot');
  const cTxt = document.getElementById('chatNetText');

  function setStatus(on, label, color) {
    const dotStyle = on
      ? `background:${color};box-shadow:0 0 6px ${color};animation:pulse 2.5s infinite`
      : `background:${color};box-shadow:0 0 6px ${color};animation:none`;
    hDot.style.cssText = dotStyle;
    hTxt.textContent   = label;
    cDot.style.cssText = dotStyle.replace('6px', '5px');
    cTxt.textContent   = label;
  }

  try {
    const base = await resolveAvailableBase(2500);
    const label = base.includes('localhost') ? 'Нейросеть активна (локально)' : 'Нейросеть активна';
    if (_lastNetStatus !== 'on') showToast(label, 'success', 2500);
    _lastNetStatus = 'on';
    setStatus(true, label, '#6ab04c');
  } catch {
    if (_lastNetStatus !== 'off') showToast('Нейросеть недоступна', 'error', 3500);
    _lastNetStatus = 'off';
    setStatus(false, 'Нейросеть недоступна', '#e55039');
  }
}

function appendMsg(role, html, timeStr, { imagePreview, fileName, historyIndex } = {}) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = role === 'user' ? 'msg user' : 'msg';
  if (historyIndex !== undefined) div.dataset.historyIndex = historyIndex;

  const avatar    = role === 'user' ? 'Кто?' : 'SС';
  const imageHtml = imagePreview ? `<div class="msg-image-preview"><img src="${imagePreview}" alt="фото"></div>` : '';
  const fileHtml  = fileName
    ? `<div class="msg-file-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg> ${escapeHtml(fileName)}</div>` : '';
  const bubbleHtml = html ? `<div class="msg-bubble">${html}</div>` : '';
  const copyBtn = role !== 'user'
    ? `<button class="copy-btn" onclick="copyMsg(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> копировать</button>` : '';
  const editBtn = (role === 'user' && historyIndex !== undefined)
    ? `<button class="edit-btn" onclick="startEdit(${historyIndex}, this)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> изменить</button>` : '';

  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-body">
      ${imageHtml}${fileHtml}${bubbleHtml}
      <div class="msg-time">${timeStr}${copyBtn}${editBtn}</div>
    </div>`;

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  if (typeof hljs !== 'undefined') div.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  return div;
}

function appendStreamingMsg() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg';
  div.id = 'streamingMsg';
  div.innerHTML = `
    <div class="msg-avatar">SC</div>
    <div class="msg-body">
      <div class="msg-bubble" id="streamingBubble"><div class="typing"><span></span><span></span><span></span></div></div>
      <div class="msg-time" id="streamingTime"></div>
    </div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function copyMsg(btn) {
  const bubble = btn.closest('.msg-body').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText || bubble.textContent).then(() => {
    showToast('Скопировано', 'success', 1800);
  });
}

function startEdit(historyIndex) {
  const msg = chatHistory[historyIndex];
  if (!msg || msg.role !== 'user') return;

  const text = typeof msg.content === 'string'
    ? msg.content
    : (msg.content?.find(c => c.type === 'text')?.text || '');

  const input = document.getElementById('chatInput');
  input.value = text;
  input.focus();
  editingMsgIndex = historyIndex;
  document.querySelector('.chat-input-area').classList.add('editing');
  document.getElementById('editIndicator').style.display = 'flex';
  document.getElementById('editIndicatorText').textContent = 'Редактирование сообщения';
}

function cancelEdit() {
  editingMsgIndex = null;
  document.getElementById('chatInput').value = '';
  document.querySelector('.chat-input-area').classList.remove('editing');
  document.getElementById('editIndicator').style.display = 'none';
}

// ── Сессии ─────────────────────────────────────────────────────────────────
function getSessions() {
  try { return JSON.parse(localStorage.getItem('xxxl_sessions') || '[]'); } catch { return []; }
}

function saveSessions(arr) { localStorage.setItem('xxxl_sessions', JSON.stringify(arr)); }

function saveCurrentSession() {
  if (!currentSession || chatHistory.length === 0) return;
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === currentSession.id);

  const firstUser = chatHistory.find(m => m.role === 'user');
  let preview = 'Сессия';
  if (firstUser) {
    preview = (typeof firstUser.content === 'string'
      ? firstUser.content
      : (firstUser.content?.find(c => c.type === 'text')?.text || '📎 файл/изображение')
    ).slice(0, 52);
  }

  const updated = { ...currentSession, preview, history: chatHistory, updatedAt: Date.now() };
  if (idx >= 0) sessions[idx] = updated; else sessions.unshift(updated);
  saveSessions(sessions.slice(0, 30));
  currentSession = updated;
  renderSessionList();
}

function createNewSession() {
  currentSession = { id: Date.now().toString(), preview: 'Новая сессия', history: [], createdAt: Date.now(), updatedAt: Date.now() };
}

function newSession() {
  saveCurrentSession();
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  chatHistory = [];
  clearAttachedFile();
  createNewSession();
  document.getElementById('chatMessages').innerHTML = '';
  appendMsg('agent', renderMarkdown('Новая сессия. Чем займёмся?'), getTime());
  renderSessionList();
  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();
}

function loadSession(id) {
  saveCurrentSession();
  const s = getSessions().find(s => s.id === id);
  if (!s) return;

  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  clearAttachedFile();
  currentSession = s;
  chatHistory = [...s.history];

  const messages = document.getElementById('chatMessages');
  messages.innerHTML = '';

  chatHistory.forEach((msg, i) => {
    if (msg.role === 'system') return;
    const role = msg.role === 'user' ? 'user' : 'agent';
    const hi   = msg.role === 'user' ? i : undefined;

    if (Array.isArray(msg.content)) {
      const txt  = msg.content.find(c => c.type === 'text');
      const img  = msg.content.find(c => c.type === 'image_url');
      const file = msg.content.find(c => c.type === 'file');
      appendMsg(role,
        txt ? (role === 'user' ? escapeHtml(txt.text) : renderMarkdown(txt.text)) : '',
        '—', { imagePreview: img?.image_url?.url, fileName: file?.name, historyIndex: hi }
      );
    } else {
      appendMsg(role, role === 'agent' ? renderMarkdown(msg.content) : escapeHtml(msg.content), '—', { historyIndex: hi });
    }
  });

  renderSessionList();
  messages.scrollTop = 999999;
  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();
}

function deleteSession(id, e) {
  e.stopPropagation();
  const sessions = getSessions().filter(s => s.id !== id);
  saveSessions(sessions);
  if (currentSession?.id === id) newSession(); else renderSessionList();
}

function renderSessionList() {
  const list = document.getElementById('sessionsList');
  if (!list) return;
  const sessions = getSessions();

  if (sessions.length === 0) {
    list.innerHTML = '<div class="session-empty">Нет сохранённых сессий</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === currentSession?.id ? 'active' : ''}" onclick="loadSession('${s.id}')">
      <div class="session-preview" ondblclick="startRenameSession('${s.id}', this)" title="Двойной клик — переименовать">${escapeHtml(s.preview || 'Сессия')}</div>
      <div class="session-meta">
        <span>${new Date(s.updatedAt).toLocaleDateString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
        <button class="session-del" onclick="deleteSession('${s.id}', event)" title="Удалить">✕</button>
      </div>
    </div>`).join('');
}

function startRenameSession(id, el) {
  const current = el.textContent;
  const input = document.createElement('input');
  input.className = 'session-rename-input';
  input.value = current;
  el.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim() || current;
    const sessions = getSessions();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx >= 0) {
      sessions[idx].preview = val.slice(0, 52);
      saveSessions(sessions);
      if (currentSession?.id === id) currentSession.preview = sessions[idx].preview;
    }
    renderSessionList();
    showToast('Сессия переименована', 'success');
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') renderSessionList();
  });
  input.addEventListener('blur', commit);
}

// ── Файлы ───────────────────────────────────────────────────────────────────
function handleAnyFile(file) {
  if (!file) return;
  file.type.startsWith('image/') ? handleImageFile(file) : handleTextFile(file);
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    attachedImage = { base64: e.target.result.split(',')[1], mimeType: file.type, previewUrl: e.target.result };
    attachedFile  = null;
    showAttachPreview({ type: 'image', src: e.target.result });
  };
  reader.readAsDataURL(file);
}

const TEXT_EXTS = ['txt','md','py','js','ts','jsx','tsx','html','css','json','csv','xml','yaml','yml','sh','bash','c','cpp','h','java','go','rs','rb','php','sql','log','env','toml','ini','cfg'];

function handleTextFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!TEXT_EXTS.includes(ext)) {
    showToast(`Файл .${ext} не поддерживается`, 'error'); return;
    return;
  }
  if (file.size > 500 * 1024) { showToast('Файл слишком большой. Максимум 500 КБ', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    attachedFile  = { name: file.name, content: e.target.result, size: file.size, ext };
    attachedImage = null;
    showAttachPreview({ type: 'file', name: file.name, size: file.size });
  };
  reader.readAsText(file, 'UTF-8');
}

function showAttachPreview({ type, src, name, size }) {
  let preview = document.getElementById('attachPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'attachPreview';
    preview.className = 'attach-preview';
    document.querySelector('.chat-input-area').appendChild(preview);
  }
  if (type === 'image') {
    preview.innerHTML = `<img src="${src}" alt="фото"><button onclick="clearAttachedFile()" class="attach-remove" title="Удалить">✕</button>`;
  } else {
    const kb = (size / 1024).toFixed(1);
    preview.innerHTML = `
      <div class="attach-file-info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
        <span class="attach-file-name">${escapeHtml(name)}</span>
        <span class="attach-file-size">${kb} КБ</span>
      </div>
      <button onclick="clearAttachedFile()" class="attach-remove" title="Удалить">✕</button>`;
  }
}

function clearAttachedFile() {
  attachedImage = null;
  attachedFile  = null;
  document.getElementById('attachPreview')?.remove();
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
}

function setupDragDrop() {
  const win = document.querySelector('.chat-window');
  win.addEventListener('dragover',  e => { e.preventDefault(); win.classList.add('drag-over'); });
  win.addEventListener('dragleave', e => { if (!win.contains(e.relatedTarget)) win.classList.remove('drag-over'); });
  win.addEventListener('drop',      e => { e.preventDefault(); win.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) handleAnyFile(f); });
}

// ── Панель сессий ───────────────────────────────────────────────────────────
function toggleSessionsPanel() {
  document.getElementById('sessionsPanel').classList.toggle('collapsed');
  document.querySelector('.sessions-toggle-btn').classList.toggle('active');
}

function closeSessionsPanel() {
  document.getElementById('sessionsPanel').classList.add('collapsed');
  document.querySelector('.sessions-toggle-btn').classList.remove('active');
}

// ── Отправить / переотправить ───────────────────────────────────────────────
async function sendMessage() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const text    = input.value.trim();

  if (!text && !attachedImage && !attachedFile) return;

  if (editingMsgIndex !== null) {
    chatHistory = chatHistory.slice(0, editingMsgIndex);
    cancelEdit();
    let userCount = 0;
    let removing  = false;
    document.getElementById('chatMessages').querySelectorAll('.msg').forEach(el => {
      if (removing) { el.remove(); return; }
      if (el.classList.contains('user') && ++userCount > chatHistory.filter(m => m.role === 'user').length) {
        removing = true; el.remove();
      }
    });
  }

  const hi = chatHistory.length;
  appendMsg('user', text ? escapeHtml(text) : null, getTime(), {
    imagePreview: attachedImage?.previewUrl || null,
    fileName: attachedFile?.name || null,
    historyIndex: hi
  });

  let userContent;
  if (attachedImage) {
    userContent = [
      { type: 'image_url', image_url: { url: `data:${attachedImage.mimeType};base64,${attachedImage.base64}` } },
      { type: 'text', text: text || 'Что на этом изображении?' }
    ];
  } else if (attachedFile) {
    const fileBlock = `\`\`\`${attachedFile.ext}\n// Файл: ${attachedFile.name}\n${attachedFile.content}\n\`\`\``;
    userContent = text ? `${text}\n\n${fileBlock}` : `Проанализируй этот файл:\n\n${fileBlock}`;
  } else {
    userContent = text;
  }

  chatHistory.push({ role: 'user', content: userContent });
  input.value = '';
  clearAttachedFile();
  input.disabled = true;
  sendBtn.style.display = 'none';
  stopBtn.style.display = 'flex';

  currentAbort = new AbortController();
  const streamDiv    = appendStreamingMsg();
  const streamBubble = document.getElementById('streamingBubble');
  const streamTime   = document.getElementById('streamingTime');
  let fullText = '';

  try {
    let res = null, lastError = null;
    for (const base of buildCandidateBases()) {
      try {
        const attempt = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: getHeaders(),
          signal: currentAbort.signal,
          body: JSON.stringify({
            model: DEFAULT_MODEL,
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...chatHistory],
            temperature: 0.7, max_tokens: 2048, stream: true
          })
        });
        if (!attempt.ok) { lastError = new Error(`Сервер: ${attempt.status} ${attempt.statusText}`); continue; }
        res = attempt; activeBaseUrl = base; break;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastError = e;
      }
    }
    if (!res) throw (lastError || new Error('Не удалось подключиться ни к localhost, ни к ngrok'));

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n').filter(l => l.startsWith('data: '))) {
        const d = line.slice(6).trim();
        if (d === '[DONE]') break;
        try {
          fullText += JSON.parse(d).choices?.[0]?.delta?.content || '';
          streamBubble.innerHTML = renderMarkdown(fullText);
          if (typeof hljs !== 'undefined') streamBubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
          document.getElementById('chatMessages').scrollTop = 999999;
        } catch {}
      }
    }

    chatHistory.push({ role: 'assistant', content: fullText });
    streamDiv.id = streamBubble.id = streamTime.id = '';
    streamTime.innerHTML = `${getTime()} <button class="copy-btn" onclick="copyMsg(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> копировать</button>`;
    saveCurrentSession();

  } catch (err) {
    streamDiv.remove();
    const msg = err.name === 'AbortError'
      ? '<em style="opacity:0.5">— прервано —</em>'
      : ((err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))
          ? 'Раб без жизнеобеспечения'
          : `Ошибка: ${escapeHtml(err.message)}`);
    appendMsg('agent', msg, getTime());
  } finally {
    currentAbort = null;
    input.disabled = false;
    sendBtn.style.display = 'flex';
    stopBtn.style.display = 'none';
    input.focus();
  }
}

function stopGeneration() {
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function startChat() {
  document.querySelector('.chat-input').focus();
  document.querySelector('.chat-section').scrollIntoView({ behavior: 'smooth' });
}

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape' && editingMsgIndex !== null) cancelEdit();
  });

  document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', e => { if (e.target.files[0]) handleAnyFile(e.target.files[0]); });

  initTheme();
  setupDragDrop();
  createNewSession();
  renderSessionList();
  appendMsg('agent', renderMarkdown('Готов. Напиши задачу, перетащи изображение или файл.'), getTime());
  checkNetworkStatus();
  setInterval(checkNetworkStatus, 15000);

  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();
});
