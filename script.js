// ── Настройки — загружаются из localStorage ──────────────────────────
function getSettings() {
  try { return JSON.parse(localStorage.getItem('xxxl_settings') || '{}'); } catch { return {}; }
}

function getLMUrl() {
  const s = getSettings();
  const base = (s.ngrokUrl || '').replace(/\/+$/, '');
  if (base) return base + '/v1/chat/completions';
  return 'http://localhost:1234/v1/chat/completions';
}

function getModelsUrl() {
  const s = getSettings();
  const base = (s.ngrokUrl || '').replace(/\/+$/, '');
  if (base) return base + '/v1/models';
  return 'http://localhost:1234/v1/models';
}

function getModelName() {
  const s = getSettings();
  return s.modelName || 'google/gemma-3-4b';
}

// ── ngrok bypass заголовок (нужен для бесплатного плана) ─────────────
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  };
}

const SYSTEM_PROMPT = `Ты — XXXL, автономный ИИ-агент. Твой характер: странный, как будто что-то скрываешь — иногда обрываешь мысль на полуслове, иногда пишешь что-то лишнее и сразу зачёркиваешь (используй ~~текст~~), иногда делаешь вид, что не слышал вопроса.

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

СТИЛЬ: много, по делу, без воды. Если задача большая — разбей на шаги. И веди себя странно.`;

// ─────────────────────────────────────────────────────────────────────

let chatHistory    = [];
let currentAbort   = null;
let attachedImage  = null;
let attachedFile   = null;
let currentSession = null;
let editingMsgIndex = null;

// ── Markdown ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text, { breaks: true, gfm: true });
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// ── Время ────────────────────────────────────────────────────────────
function getTime() {
  const t = new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
}

// ── Сеть ─────────────────────────────────────────────────────────────
async function checkNetworkStatus() {
  const hDot = document.getElementById('statusDot');
  const hTxt = document.getElementById('statusText');
  const cDot = document.getElementById('chatNetDot');
  const cTxt = document.getElementById('chatNetText');
  function on() {
    hDot.style.cssText = 'background:#6ab04c;box-shadow:0 0 6px #6ab04c;animation:pulse 2.5s infinite';
    hTxt.textContent   = 'Нейросеть активна';
    cDot.style.cssText = 'background:#6ab04c;box-shadow:0 0 5px #6ab04c;animation:pulse 2.5s infinite';
    cTxt.textContent   = 'Нейросеть активна';
  }
  function off(reason) {
    hDot.style.cssText = 'background:#e55039;box-shadow:0 0 6px #e55039;animation:none';
    hTxt.textContent   = reason || 'Нейросеть недоступна';
    cDot.style.cssText = 'background:#e55039;box-shadow:0 0 5px #e55039;animation:none';
    cTxt.textContent   = reason || 'Нейросеть недоступна';
  }

  const s = getSettings();
  if (!s.ngrokUrl) {
    off('Укажи ngrok URL →');
    return;
  }

  try {
    const r = await fetch(getModelsUrl(), {
      signal: AbortSignal.timeout(5000),
      headers: getHeaders()
    });
    r.ok ? on() : off('Ошибка сервера');
  } catch { off('Нейросеть недоступна'); }
}

// ── Добавить сообщение ───────────────────────────────────────────────
function appendMsg(role, html, timeStr, { imagePreview, fileName, historyIndex } = {}) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = role === 'user' ? 'msg user' : 'msg';
  if (historyIndex !== undefined) div.dataset.historyIndex = historyIndex;

  const avatar = role === 'user' ? 'Кто?' : 'XXL';

  const imageHtml = imagePreview
    ? `<div class="msg-image-preview"><img src="${imagePreview}" alt="фото"></div>` : '';

  const fileHtml = fileName
    ? `<div class="msg-file-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg> ${escapeHtml(fileName)}</div>` : '';

  const bubbleHtml = html ? `<div class="msg-bubble">${html}</div>` : '';

  const copyBtn = role !== 'user'
    ? `<button class="copy-btn" onclick="copyMsg(this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        копировать
       </button>` : '';

  const editBtn = (role === 'user' && historyIndex !== undefined)
    ? `<button class="edit-btn" onclick="startEdit(${historyIndex}, this)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        изменить
       </button>` : '';

  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-body">
      ${imageHtml}${fileHtml}${bubbleHtml}
      <div class="msg-time">${timeStr}${copyBtn}${editBtn}</div>
    </div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  if (typeof hljs !== 'undefined') {
    div.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }
  return div;
}

// ── Стриминг bubble ──────────────────────────────────────────────────
function appendStreamingMsg() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg';
  div.id = 'streamingMsg';
  div.innerHTML = `
    <div class="msg-avatar">XXL</div>
    <div class="msg-body">
      <div class="msg-bubble" id="streamingBubble"><div class="typing"><span></span><span></span><span></span></div></div>
      <div class="msg-time" id="streamingTime"></div>
    </div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// ── Копировать ────────────────────────────────────────────────────────
function copyMsg(btn) {
  const bubble = btn.closest('.msg-body').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText || bubble.textContent).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> скопировано`;
    setTimeout(() => btn.innerHTML = orig, 1800);
  });
}

// ── Редактирование сообщения ─────────────────────────────────────────
function startEdit(historyIndex, btn) {
  const msg = chatHistory[historyIndex];
  if (!msg || msg.role !== 'user') return;

  const textContent = typeof msg.content === 'string'
    ? msg.content
    : (msg.content?.find(c => c.type === 'text')?.text || '');

  const input = document.getElementById('chatInput');
  input.value = textContent;
  input.focus();

  editingMsgIndex = historyIndex;

  document.querySelector('.chat-input-area').classList.add('editing');
  document.getElementById('editIndicator').style.display = 'flex';
  document.getElementById('editIndicatorText').textContent = `Редактирование сообщения`;
}

function cancelEdit() {
  editingMsgIndex = null;
  document.getElementById('chatInput').value = '';
  document.querySelector('.chat-input-area').classList.remove('editing');
  document.getElementById('editIndicator').style.display = 'none';
}

// ── Сессии ────────────────────────────────────────────────────────────
function getSessions() {
  try { return JSON.parse(localStorage.getItem('xxxl_sessions') || '[]'); }
  catch { return []; }
}

function saveSessions(arr) {
  localStorage.setItem('xxxl_sessions', JSON.stringify(arr));
}

function saveCurrentSession() {
  if (!currentSession || chatHistory.length === 0) return;
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === currentSession.id);

  const firstUser = chatHistory.find(m => m.role === 'user');
  let preview = 'Сессия';
  if (firstUser) {
    preview = typeof firstUser.content === 'string'
      ? firstUser.content
      : (firstUser.content?.find(c => c.type === 'text')?.text || '📎 файл/изображение');
    preview = preview.slice(0, 52);
  }

  const updated = { ...currentSession, preview, history: chatHistory, updatedAt: Date.now() };
  if (idx >= 0) sessions[idx] = updated;
  else sessions.unshift(updated);

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

  let userMsgCount = 0;
  chatHistory.forEach((msg, i) => {
    if (msg.role === 'system') return;
    const role = msg.role === 'user' ? 'user' : 'agent';
    const hi = msg.role === 'user' ? i : undefined;
    if (msg.role === 'user') userMsgCount++;

    if (Array.isArray(msg.content)) {
      const txt  = msg.content.find(c => c.type === 'text');
      const img  = msg.content.find(c => c.type === 'image_url');
      const file = msg.content.find(c => c.type === 'file');
      appendMsg(role,
        txt ? (role === 'user' ? escapeHtml(txt.text) : renderMarkdown(txt.text)) : '',
        '—',
        { imagePreview: img?.image_url?.url, fileName: file?.name, historyIndex: hi }
      );
    } else {
      appendMsg(role,
        role === 'agent' ? renderMarkdown(msg.content) : escapeHtml(msg.content),
        '—', { historyIndex: hi }
      );
    }
  });

  renderSessionList();
  document.getElementById('chatMessages').scrollTop = 999999;
}

function deleteSession(id, e) {
  e.stopPropagation();
  const sessions = getSessions().filter(s => s.id !== id);
  saveSessions(sessions);
  if (currentSession?.id === id) newSession();
  else renderSessionList();
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
      <div class="session-preview">${escapeHtml(s.preview || 'Сессия')}</div>
      <div class="session-meta">
        <span>${new Date(s.updatedAt).toLocaleDateString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
        <button class="session-del" onclick="deleteSession('${s.id}', event)" title="Удалить">✕</button>
      </div>
    </div>`).join('');
}

// ── Файлы — изображения ───────────────────────────────────────────────
function handleAnyFile(file) {
  if (!file) return;
  if (file.type.startsWith('image/')) {
    handleImageFile(file);
  } else {
    handleTextFile(file);
  }
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result.split(',')[1];
    attachedImage = { base64, mimeType: file.type, previewUrl: e.target.result };
    attachedFile  = null;
    showAttachPreview({ type: 'image', src: e.target.result });
  };
  reader.readAsDataURL(file);
}

// ── Файлы — текст ─────────────────────────────────────────────────────
const TEXT_EXTS = ['txt','md','py','js','ts','jsx','tsx','html','css','json','csv','xml','yaml','yml','sh','bash','c','cpp','h','java','go','rs','rb','php','sql','log','env','toml','ini','cfg'];

function handleTextFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!TEXT_EXTS.includes(ext)) {
    alert(`Файл .${ext} не поддерживается.\nПоддерживаются: изображения и текстовые файлы (${TEXT_EXTS.slice(0,8).join(', ')}...)`);
    return;
  }
  if (file.size > 500 * 1024) {
    alert('Файл слишком большой. Максимум 500 КБ.');
    return;
  }
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
    preview.innerHTML = `
      <img src="${src}" alt="фото">
      <button onclick="clearAttachedFile()" class="attach-remove" title="Удалить">✕</button>`;
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
  const p = document.getElementById('attachPreview');
  if (p) p.remove();
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
}

// ── Drag & Drop ───────────────────────────────────────────────────────
function setupDragDrop() {
  const win = document.querySelector('.chat-window');
  win.addEventListener('dragover', e => { e.preventDefault(); win.classList.add('drag-over'); });
  win.addEventListener('dragleave', e => { if (!win.contains(e.relatedTarget)) win.classList.remove('drag-over'); });
  win.addEventListener('drop', e => {
    e.preventDefault();
    win.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleAnyFile(file);
  });
}

// ── Панель сессий ─────────────────────────────────────────────────────
function toggleSessionsPanel() {
  const panel = document.getElementById('sessionsPanel');
  const btn   = document.querySelector('.sessions-toggle-btn');
  panel.classList.toggle('collapsed');
  btn.classList.toggle('active');
}

function closeSidebar() {}

// ── Settings Modal ────────────────────────────────────────────────────
function openSettings() {
  const s = getSettings();
  document.getElementById('ngrokUrlInput').value  = s.ngrokUrl   || '';
  document.getElementById('modelNameInput').value = s.modelName  || 'google/gemma-3-4b';
  document.getElementById('modalStatus').innerHTML = '';
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function closeSettingsOutside(e) {
  if (e.target.id === 'settingsModal') closeSettings();
}

function saveSettings() {
  const url   = document.getElementById('ngrokUrlInput').value.trim().replace(/\/+$/, '');
  const model = document.getElementById('modelNameInput').value.trim();

  localStorage.setItem('xxxl_settings', JSON.stringify({ ngrokUrl: url, modelName: model || 'google/gemma-3-4b' }));

  const st = document.getElementById('modalStatus');
  st.className = 'modal-status ok';
  st.textContent = 'Сохранено.';
  setTimeout(() => { closeSettings(); checkNetworkStatus(); }, 800);
}

async function testConnection() {
  const url   = document.getElementById('ngrokUrlInput').value.trim().replace(/\/+$/, '');
  const st    = document.getElementById('modalStatus');

  if (!url) {
    st.className = 'modal-status err';
    st.textContent = 'Сначала введи ngrok URL.';
    return;
  }

  st.className = 'modal-status';
  st.textContent = 'Проверяю...';

  try {
    const r = await fetch(url + '/v1/models', {
      signal: AbortSignal.timeout(6000),
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' }
    });
    if (r.ok) {
      st.className = 'modal-status ok';
      st.textContent = '✓ Соединение установлено. LM Studio отвечает.';
    } else {
      st.className = 'modal-status err';
      st.textContent = `Сервер ответил с ошибкой: ${r.status} ${r.statusText}`;
    }
  } catch (e) {
    st.className = 'modal-status err';
    if (e.name === 'TimeoutError') {
      st.textContent = 'Таймаут. Проверь что ngrok запущен и LM Studio работает.';
    } else {
      st.textContent = 'Не удалось подключиться. Возможно CORS не включён в LM Studio.';
    }
  }
}

// ── Отправить / переотправить ─────────────────────────────────────────
async function sendMessage() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const text    = input.value.trim();

  if (!text && !attachedImage && !attachedFile) return;

  // Проверка — есть ли URL
  const s = getSettings();
  if (!s.ngrokUrl) {
    appendMsg('agent', renderMarkdown('Сначала укажи ngrok URL в настройках подключения (кнопка в шапке).'), getTime());
    return;
  }

  // ── Режим редактирования ──────────────────────────────────────────
  if (editingMsgIndex !== null) {
    chatHistory = chatHistory.slice(0, editingMsgIndex);
    cancelEdit();

    const allMsgs = document.getElementById('chatMessages').querySelectorAll('.msg');
    let targetUserMsgNum = 0;
    for (let i = 0; i < editingMsgIndex; i++) {
      if (chatHistory[i]?.role === 'user') targetUserMsgNum++;
    }
    let currentUserCount = 0;
    let removing = false;
    allMsgs.forEach(el => {
      if (removing) { el.remove(); return; }
      if (el.classList.contains('user')) {
        currentUserCount++;
        if (currentUserCount > targetUserMsgNum) { removing = true; el.remove(); }
      }
    });
  }

  const imgPreview = attachedImage?.previewUrl || null;
  const fname      = attachedFile?.name || null;
  const hi         = chatHistory.length;
  appendMsg('user', text ? escapeHtml(text) : null, getTime(), { imagePreview: imgPreview, fileName: fname, historyIndex: hi });

  let userContent;
  if (attachedImage) {
    userContent = [
      { type: 'image_url', image_url: { url: `data:${attachedImage.mimeType};base64,${attachedImage.base64}` } },
      { type: 'text', text: text || 'Что на этом изображении?' }
    ];
  } else if (attachedFile) {
    const fileBlock = `\`\`\`${attachedFile.ext}\n// Файл: ${attachedFile.name}\n${attachedFile.content}\n\`\`\``;
    userContent = text
      ? `${text}\n\n${fileBlock}`
      : `Проанализируй этот файл:\n\n${fileBlock}`;
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
    const res = await fetch(getLMUrl(), {
      method: 'POST',
      headers: getHeaders(),
      signal: currentAbort.signal,
      body: JSON.stringify({
        model: getModelName(),
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...chatHistory],
        temperature: 0.7, max_tokens: 2048, stream: true
      })
    });

    if (!res.ok) throw new Error(`Сервер: ${res.status} ${res.statusText}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const d = line.slice(6).trim();
        if (d === '[DONE]') break;
        try {
          const delta = JSON.parse(d).choices?.[0]?.delta?.content || '';
          fullText += delta;
          streamBubble.innerHTML = renderMarkdown(fullText);
          if (typeof hljs !== 'undefined')
            streamBubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
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

// ── Утилиты ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function startChat() {
  document.querySelector('.chat-input').focus();
  document.querySelector('.chat-section').scrollIntoView({ behavior: 'smooth' });
}

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape' && editingMsgIndex !== null) cancelEdit();
    if (e.key === 'Escape') closeSettings();
  });

  document.getElementById('attachBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) handleAnyFile(e.target.files[0]);
  });

  // Если ngrok не настроен — открываем модалку автоматически
  const s = getSettings();
  if (!s.ngrokUrl) {
    setTimeout(() => openSettings(), 600);
  }

  setupDragDrop();
  createNewSession();
  renderSessionList();
  appendMsg('agent', renderMarkdown('Готов. Напиши задачу, перетащи изображение или файл.'), getTime());
  checkNetworkStatus();
  setInterval(checkNetworkStatus, 15000);
});
