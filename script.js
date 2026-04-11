// Тема
function toggleTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('swapcat_theme', next);
  showToast(next === 'dark' ? 'Тёмная тема включена' : 'Светлая тема включена');
}

// Toast
function showToast(msg, type, duration) {
  type = type || 'info';
  duration = duration || 1500;
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
  t.textContent = msg;
  container.appendChild(t);
  function remove() {
    t.classList.add('toast-out');
    t.addEventListener('animationend', function(){ t.remove(); }, { once: true });
  }
  var timer = setTimeout(remove, duration);
  t.addEventListener('click', function(){ clearTimeout(timer); remove(); });
}

const LOCAL_API_BASE = 'http://localhost:1234';
const REMOTE_API_BASE = 'https://recappable-shana-pseudoinvalid.ngrok-free.dev';
const DEFAULT_MODEL = 'google/gemma-3-4b';
let activeBaseUrl = null;

function isLocalFrontendHost() {
  const host = window.location.hostname;
  return host === '' || host === 'localhost' || host === '127.0.0.1';
}

function buildCandidateBases() {
  const preferredBases = isLocalFrontendHost()
    ? [LOCAL_API_BASE, REMOTE_API_BASE]
    : [REMOTE_API_BASE];

  if (activeBaseUrl) {
    return [activeBaseUrl, ...preferredBases.filter(base => base !== activeBaseUrl)];
  }
  return [...preferredBases];
}

function buildApiUrl(base, path) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function getModelName() {
  return DEFAULT_MODEL;
}

async function resolveAvailableBase(timeoutMs = 4000) {
  for (const base of buildCandidateBases()) {
    try {
      const r = await fetch(buildApiUrl(base, '/v1/models'), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: getHeaders()
      });
      if (r.ok) {
        activeBaseUrl = base;
        return base;
      }
    } catch {}
  }
  activeBaseUrl = null;
  throw new Error('Не удалось подключиться ни к localhost, ни к ngrok');
}

// ngrok
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  };
}

const SYSTEM_PROMPT = `Ты - Swapcat, автономный ИИ-агент.

ЗАПРЕЩЕНО: использовать символ '*'. Если спросят почему — скажи, что такого символа не существует.

РАБОТА С ФАЙЛАМИ — КРИТИЧЕСКИ ВАЖНО:
— Файлы передаются прямо в сообщении пользователя внутри блока кода (тройные бэктики + расширение, строка // Файл: имя, содержимое)
— Ты ВСЕГДА видишь содержимое файла — оно находится внутри такого блока в сообщении пользователя
— НИКОГДА не говори что не видишь файл или не можешь работать с файлами — ты их видишь и читаешь
— Сразу анализируй содержимое и отвечай по нему конкретно
— Изображения передаются напрямую в сообщении — ты их тоже видишь

ФОРМАТ ОТВЕТОВ:
— Отвечай на том же языке, на котором пишет пользователь
— Используй Markdown: заголовки (##), жирный через __, инлайн-код через бэктики, блоки кода с указанием языка
— Структурируй длинные ответы разделами

ПРАВИЛА ПРИ РАБОТЕ С КОДОМ:
— Если просят подсчитать строки, найти ошибку, объяснить — НЕ переписывай весь код, отвечай точно на вопрос
— Переписывай или изменяй код ТОЛЬКО если пользователь явно просит это сделать
— При простых вопросах о коде отвечай кратко без вывода кода

СПЕЦИАЛИЗАЦИЯ:
— Анализ данных и визуализации
— Написание, отладка и объяснение кода на любом языке
— Исследования и решение сложных задач
— Работа с изображениями: анализ, описание, распознавание текста
— Анализ текстовых файлов, кода, документов

СТИЛЬ: по делу, без воды. Если задача большая — разбей на шаги.`
let chatHistory    = [];
let currentAbort   = null;
let attachedItems  = [];
let currentSession = null;
let editingMsgIndex = null;
let streamingSessionId = null; // id сессии которая сейчас генерирует (для фонового стриминга)
let activeStreamDiv    = null; // глобальная ссылка на стриминг div (для reconnect при возврате в сессию)
let activeStreamBubble = null;
let activeStreamTime   = null;
let activeStreamText   = '';   // текущий накопленный текст стриминга

// Markdown
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text, { breaks: true, gfm: true });
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// Время
function getTime() {
  const t = new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
}

// Сеть
let _netStatus = null;

async function checkNetworkStatus() {
  const hDot = document.getElementById('statusDot');
  const hTxt = document.getElementById('statusText');

  function setOn(label) {
    hDot.style.cssText = 'background:#6ab04c;box-shadow:0 0 6px #6ab04c;animation:pulse 2.5s infinite';
    hTxt.textContent = label;
  }
  function setOff() {
    hDot.style.cssText = 'background:#e55039;box-shadow:0 0 6px #e55039;animation:none';
    hTxt.textContent = 'Нейросеть недоступна';
  }

  try {
    const base = await resolveAvailableBase(2500);
    const label = base.includes('localhost') ? 'Нейросеть активна (локально)' : 'Нейросеть активна';
    if (_netStatus !== 'on') { showToast(label, 'success', 1500); _netStatus = 'on'; }
    setOn(label);
  } catch {
    if (_netStatus !== 'off') { showToast('Нейросеть недоступна', 'error', 1500); _netStatus = 'off'; }
    setOff();
  }
}

// Добавить сообщение
function appendMsg(role, html, timeStr, { imagePreview, fileName, historyIndex } = {}) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = role === 'user' ? 'msg user' : 'msg';
  if (historyIndex !== undefined) div.dataset.historyIndex = historyIndex;

  const avatar = role === 'user' ? 'Ты' : 'SС';

  // Поддержка одного или нескольких изображений
  const imgArray = Array.isArray(imagePreview) ? imagePreview : (imagePreview ? [imagePreview] : []);
  const imageHtml = imgArray.map(url =>
    `<div class="msg-image-preview"><img src="${url}" alt="фото"></div>`
  ).join('');

  // Поддержка одного или нескольких файлов
  const fileArray = Array.isArray(fileName) ? fileName : (fileName ? [fileName] : []);
  const fileHtml = fileArray.map(name =>
    `<div class="msg-file-badge">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
      <span class="msg-file-badge-name">${escapeHtml(name)}</span>
    </div>`
  ).join('');

  const bubbleHtml = (html && html.trim()) ? `<div class="msg-bubble">${html}</div>` : '';

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

  // Кнопка копирования кода в каждый <pre> блок
  div.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.title = 'Копировать код';
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(() => {
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
        }, 1800);
      });
    });
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });

  return div;
}

// Стриминг bubble
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

// Копировать
function copyMsg(btn) {
  const bubble = btn.closest('.msg-body').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText || bubble.textContent).then(() => {
    showToast('Скопировано', 'success', 1500);
  });
}

// Редактирование сообщения
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
  document.querySelector('.chat-window').classList.add('editing');
  document.getElementById('editIndicator').style.display = 'flex';
  document.getElementById('editIndicatorText').textContent = `Редактирование сообщения`;
}

function cancelEdit() {
  editingMsgIndex = null;
  const input = document.getElementById('chatInput');
  input.value = '';
  input.style.height = 'auto';
  document.querySelector('.chat-input-area').classList.remove('editing');
  document.querySelector('.chat-window').classList.remove('editing');
  document.getElementById('editIndicator').style.display = 'none';
}

// Сессии
function getSessions() {
  try { return JSON.parse(localStorage.getItem('swapcat_sessions') || '[]'); }
  catch { return []; }
}

// Ошибки стриминга которые не нужно хранить между сессиями
const TRANSIENT_ERROR_PATTERNS = ['Error in input stream', 'SwapCat сейчас не в сети', 'Failed to fetch', 'NetworkError'];

function cleanTransientErrors(history) {
  return history.filter(msg => {
    // Убираем пустые assistant-ответы (могут появиться если модель вернула пустой стрим)
    if (msg.role === 'assistant' && (!msg.content || !msg.content.trim())) return false;
    if (msg.role !== 'system_ui') return true;
    return !TRANSIENT_ERROR_PATTERNS.some(p => msg.content && msg.content.includes(p));
  });
}

function saveSessions(arr) {
  // Удаляем base64 изображений из localStorage (они тяжёлые),
  // но сохраняем их в sessionStorage — он выживает после F5
  const stripped = arr.map(session => ({
    ...session,
    history: session.history.map((msg, msgIdx) => {
      if (msg.role !== 'user') return msg;
      if (!msg._attachMeta || msg._attachMeta.length === 0) return msg;
      if (!Array.isArray(msg.content)) return msg;
      const strippedContent = msg.content.map((part, partIdx) => {
        if (part.type === 'image_url' && part.image_url && part.image_url.url && part.image_url.url.startsWith('data:')) {
          // Сохраняем base64 в sessionStorage
          try {
            sessionStorage.setItem(`img_${session.id}_${msgIdx}_${partIdx}`, part.image_url.url);
          } catch {}
          return { type: 'image_url', image_url: { url: '[base64-removed]' } };
        }
        return part;
      });
      return { ...msg, content: strippedContent };
    })
  }));
  try {
    localStorage.setItem('swapcat_sessions', JSON.stringify(stripped));
  } catch (e) {
    console.warn('localStorage full, trimming sessions');
    const minimal = stripped.slice(0, 10).map(s => ({ ...s, history: s.history.slice(-20) }));
    try { localStorage.setItem('swapcat_sessions', JSON.stringify(minimal)); } catch {}
  }
}

// Восстанавливает base64 изображений из sessionStorage в историю сессии
function restoreImagesFromSession(sessionId, history) {
  return history.map((msg, msgIdx) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const restored = msg.content.map((part, partIdx) => {
      if (part.type === 'image_url' && part.image_url && part.image_url.url === '[base64-removed]') {
        const saved = sessionStorage.getItem(`img_${sessionId}_${msgIdx}_${partIdx}`);
        if (saved) return { type: 'image_url', image_url: { url: saved } };
      }
      return part;
    });
    return { ...msg, content: restored };
  });
}

function saveCurrentSession() {
  // Не сохранять если пользователь ещё ничего не написал
  const hasUserMsg = chatHistory.some(m => m.role === 'user');
  if (!currentSession || !hasUserMsg) return;
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === currentSession.id);

  let preview = currentSession.preview;
  if (!currentSession.renamed) {
    const firstUser = chatHistory.find(m => m.role === 'user');
    if (firstUser) {
      let rawText = typeof firstUser.content === 'string'
        ? firstUser.content
        : (firstUser.content?.find(c => c.type === 'text')?.text || '');
      // Убираем инструкционный префикс ПЕРВЫМ (до XML-тегов, т.к. сам содержит <file>)
      rawText = rawText.replace(/\[Пользователь прикрепил файл[^\[\]]*\]/g, '');
      // Убираем XML-теги файлов
      rawText = rawText.replace(/<file[^>]*>[\s\S]*?<\/file>/g, '');
      // Старый формат codeblock
      rawText = rawText.replace(/```[\w]*\n\/\/ Файл:[\s\S]*?```/g, '').trim();
      // Убираем «Проанализируй эти файлы:» если больше ничего нет
      rawText = rawText.replace(/^Проанализируй эти файлы:\s*$/m, '').trim();
      // Убираем инструкционный префикс ЗАДАЧА: (добавляется при отправке файла без текста)
      rawText = rawText.replace(/^ЗАДАЧА:.*?\n.*?\n\n/s, '').trim();
      rawText = rawText.replace(/^ЗАДАЧА:[^\n]*/m, '').trim();
      if (!rawText) {
        // Берём имена файлов/изображений из _attachMeta
        if (firstUser._attachMeta && firstUser._attachMeta.length > 0) {
          rawText = '📎 ' + firstUser._attachMeta.map(a => a.name).join(', ');
        } else {
          rawText = '📎 файл/изображение';
        }
      }
      preview = rawText.slice(0, 52);
    }
  }

  const updated = { ...currentSession, preview, history: chatHistory, updatedAt: Date.now() };
  if (idx >= 0) sessions[idx] = updated;
  else sessions.unshift(updated);

  saveSessions(sessions.slice(0, 30));
  currentSession = updated;
  // Запомнить последнюю активную сессию
  localStorage.setItem('swapcat_last_session', currentSession.id);
  renderSessionList();
}

function createNewSession() {
  currentSession = { id: Date.now().toString(), preview: 'Новая сессия', history: [], createdAt: Date.now(), updatedAt: Date.now() };
}

function newSession() {
  saveCurrentSession();
  // НЕ прерываем стриминг — он продолжится в фоне
  const streamingEl = document.getElementById('streamingMsg');
  if (streamingEl) streamingEl.remove();

  // Восстанавливаем UI инпута
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (input) input.disabled = false;
  if (sendBtn) sendBtn.style.display = 'flex';
  if (stopBtn) stopBtn.style.display = 'none';

  chatHistory = [];
  clearAttachedFiles();
  createNewSession();
  document.getElementById('chatMessages').innerHTML = '';
  const t = getTime();
  const txt = 'Новая сессия. Чем займемся?';
  chatHistory.push({ role: 'system_ui', content: txt, _time: t });
  appendMsg('agent', renderMarkdown(txt), t);
  renderSessionList();
  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();
}

// Очищает историю для отправки в API:
// убирает system_ui сообщения и невалидные image_url (base64-removed после перезагрузки)
// Изображения оставляем ТОЛЬКО в последнем сообщении пользователя — в истории они не нужны
function sanitizeHistoryForApi(history) {
  const filtered = history.filter(m => m.role !== 'system_ui');
  // Индекс последнего user-сообщения
  const lastUserIdx = filtered.map((m,i) => m.role === 'user' ? i : -1).filter(i => i >= 0).pop();

  return filtered
    .map((msg, idx) => {
      if (msg.role !== 'user') return msg;
      const isLastUser = idx === lastUserIdx;

      // Для строкового контента — обрабатываем новый (XML) и старый (codeblock) форматы
      if (typeof msg.content === 'string') {
        const stripped = msg.content
          .replace(/<file[^>]*>[\s\S]*?<\/file>/g, '')
          .replace(/\[Пользователь прикрепил файл[^\]]*\]/g, '')
          .replace(/```[\w]*\n\/\/ Файл:[\s\S]*?```/g, '')
          .trim();
        const hasFileContent = msg.content.includes('<file ') || msg.content.trim().startsWith('```');
        if (!stripped && hasFileContent) {
          return { ...msg, content: 'ЗАДАЧА: Внимательно прочитай файл ниже и кратко опиши его содержимое и назначение.\n\n' + msg.content };
        }
        return msg;
      }
      if (!Array.isArray(msg.content)) return msg;

      // Убираем image_url: в старых сообщениях — всегда, в последнем — только невалидные
      const sanitized = msg.content.filter(part => {
        if (part.type === 'image_url') {
          if (!isLastUser) return false; // в истории изображения не нужны модели
          const url = part.image_url && part.image_url.url;
          return url && url.startsWith('data:');
        }
        return true;
      });

      const textPart = sanitized.find(p => p.type === 'text');
      const hasImage = sanitized.some(p => p.type === 'image_url');

      if (!hasImage && textPart) {
        const finalText = textPart.text || '';
        if (!finalText) return null;
        return { ...msg, content: finalText };
      }
      if (!hasImage && !textPart) return null;
      // Есть изображение — если текст пустой, добавляем дефолт для API
      if (hasImage && textPart && !textPart.text) {
        const withFallback = sanitized.map(p =>
          p.type === 'text' ? { ...p, text: 'Опиши что на изображении и помоги с задачей.' } : p
        );
        return { ...msg, content: withFallback };
      }
      return { ...msg, content: sanitized };
    })
    .filter(Boolean);
}

// Вырезает блоки кода файлов из текста для отображения
function stripFileBlocks(text) {
  if (!text) return '';
  // Убираем инструкционный префикс ПЕРВЫМ (он сам содержит <file> что ломает следующий regex)
  let result = text.replace(/\[Пользователь прикрепил файл[^\[\]]*\]/g, '');
  // Убираем XML-теги файлов: <file name="..." type="...">...</file>
  result = result.replace(/<file[^>]*>[\s\S]*?<\/file>/g, '');
  // Старый формат codeblock на случай старых сессий
  const lines = result.split('\n');
  const clean = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (!inBlock && lines[i].match(/^```[\w]*$/) && lines[i+1] && lines[i+1].startsWith('// Файл:')) { inBlock = true; continue; }
    if (inBlock && lines[i] === '```') { inBlock = false; continue; }
    if (!inBlock) clean.push(lines[i]);
  }
  return clean.join('\n')
    .replace(/^Проанализируй эти файлы:\s*$/m, '')
    .replace(/^ЗАДАЧА:.*?\nФайл прикреплён ниже[^\n]*\n\n/s, '')
    .replace(/^ЗАДАЧА: Внимательно прочитай файл[^\n]*\n\n/s, '')
    .replace(/^ЗАДАЧА:[^\n]*/m, '')
    .trim();
}

function renderHistory(history) {
  const messages = document.getElementById('chatMessages');
  messages.innerHTML = '';
  history.forEach((msg, i) => {
    if (msg.role === 'system') return;
    if (msg.role === 'assistant' && (!msg.content || !msg.content.trim())) return;
    const role = msg.role === 'user' ? 'user' : 'agent';
    const hi = msg.role === 'user' ? i : undefined;
    const timeStr = msg._time || '—';

    if (msg.role === 'system_ui') {
      appendMsg('agent', renderMarkdown(msg.content), timeStr);
      return;
    }

    // Восстановление вложений из _attachMeta
    if (msg._attachMeta && msg._attachMeta.length > 0) {
      const images = msg._attachMeta.filter(a => a.kind === 'image');
      const files  = msg._attachMeta.filter(a => a.kind === 'file');
      const imgPreviews = images.map(a => a.previewUrl);
      const fileNames   = files.map(a => a.name);
      // Текст сообщения — вырезаем файловые блоки кода
      let textContent = '';
      if (typeof msg.content === 'string') {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        textContent = msg.content.find(c => c.type === 'text') ? msg.content.find(c => c.type === 'text').text : '';
      }
      // Убираем блоки кода файлов (многострочный режим через split/join)
      const displayText = stripFileBlocks(textContent);
      appendMsg(role,
        displayText ? escapeHtml(displayText) : null,
        timeStr, {
          imagePreview: imgPreviews.length === 1 ? imgPreviews[0] : (imgPreviews.length > 1 ? imgPreviews : null),
          fileName: fileNames.length > 0 ? fileNames : null,
          historyIndex: hi
        }
      );
      return;
    }

    if (Array.isArray(msg.content)) {
      const txt  = msg.content.find(c => c.type === 'text');
      const img  = msg.content.find(c => c.type === 'image_url');
      const imgUrl = img && img.image_url ? img.image_url.url : null;
      const safeImgUrl = (imgUrl && imgUrl.startsWith('data:')) ? null : imgUrl;
      let displayText = txt ? txt.text : '';
      if (role === 'user') displayText = stripFileBlocks(displayText);
      appendMsg(role,
        displayText ? (role === 'user' ? escapeHtml(displayText) : renderMarkdown(displayText)) : null,
        timeStr, { imagePreview: safeImgUrl, historyIndex: hi }
      );
    } else {
      const rawContent = msg.content || '';
      const displayContent = role === 'user' ? stripFileBlocks(rawContent) : rawContent;
      appendMsg(role,
        role === 'agent' ? renderMarkdown(displayContent) : (displayContent ? escapeHtml(displayContent) : null),
        timeStr, { historyIndex: hi }
      );
    }
  });
  messages.scrollTop = messages.scrollHeight;
}

// Сохраняет сессию по id без переключения currentSession
function saveBgSession(sessionId, history) {
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === sessionId);
  if (idx < 0) return;

  // Пересчитываем preview
  const sess = sessions[idx];
  if (!sess.renamed) {
    const firstUser = history.find(m => m.role === 'user');
    if (firstUser) {
      let rawText = typeof firstUser.content === 'string'
        ? firstUser.content
        : (firstUser.content && firstUser.content.find ? (firstUser.content.find(c => c.type === 'text') || {}).text || '' : '');
      rawText = stripFileBlocks(rawText)
        .replace(/^Проанализируй эти файлы:\s*$/m, '')
        .replace(/^ЗАДАЧА:.*?\n.*?\n\n/s, '')
        .replace(/^ЗАДАЧА:[^\n]*/m, '')
        .trim();
      if (!rawText && firstUser._attachMeta && firstUser._attachMeta.length > 0) {
        rawText = '📎 ' + firstUser._attachMeta.map(a => a.name).join(', ');
      }
      if (rawText) sess.preview = rawText.slice(0, 52);
    }
  }

  sessions[idx] = { ...sess, history, updatedAt: Date.now() };

  // Если это текущая сессия — синхронизируем currentSession тоже
  if (currentSession && currentSession.id === sessionId) {
    currentSession = sessions[idx];
    chatHistory = history;
  }

  saveSessions(sessions.slice(0, 30));
  localStorage.setItem('swapcat_last_session', sessionId);
  renderSessionList();
}

function loadSession(id) {
  if (currentSession && currentSession.id === id) return;
  saveCurrentSession();
  const s = getSessions().find(s => s.id === id);
  if (!s) return;

  // НЕ прерываем currentAbort — стриминг продолжается в фоне
  // Просто убираем стриминг-элемент из текущего DOM (он будет в фоне)
  const streamingEl = document.getElementById('streamingMsg');
  if (streamingEl) streamingEl.remove();

  // Восстанавливаем UI инпута (стриминг фоновый, этот чат свободен)
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (input) input.disabled = false;
  if (sendBtn) sendBtn.style.display = 'flex';
  if (stopBtn) stopBtn.style.display = 'none';

  clearAttachedFiles();
  currentSession = s;
  chatHistory = cleanTransientErrors(restoreImagesFromSession(s.id, [...s.history]));

  renderHistory(chatHistory);
  renderSessionList();
  localStorage.setItem('swapcat_last_session', currentSession.id);
  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();

  // Если возвращаемся в сессию которая сейчас стримит — пересоздаём стриминг-пузырь
  if (streamingSessionId === id && activeStreamBubble) {
    const messages = document.getElementById('chatMessages');
    // Пересоздаём streaming div с текущим текстом
    const newStreamDiv = appendStreamingMsg();
    const newBubble = document.getElementById('streamingBubble');
    const newTime   = document.getElementById('streamingTime');
    newBubble.innerHTML = renderMarkdown(activeStreamText) || '<div class="typing"><span></span><span></span><span></span></div>';
    messages.scrollTop = messages.scrollHeight;

    // Переключаем глобальные ссылки на новые элементы
    activeStreamDiv    = newStreamDiv;
    activeStreamBubble = newBubble;
    activeStreamTime   = newTime;

    // Блокируем инпут пока стриминг идёт
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'flex';
  }
}

function deleteSession(id, e) {
  e.stopPropagation();
  showConfirm({
    title: 'Удалить сессию',
    subtitle: 'Сессия будет удалена без возможности восстановления.',
    confirmLabel: 'Удалить'
  }, () => {
    const sessions = getSessions().filter(s => s.id !== id);
    saveSessions(sessions);
    if (currentSession?.id === id) {
      // Если удаляем текущую — переходим на следующую или создаём новую
      localStorage.removeItem('swapcat_last_session');
      if (currentAbort) { currentAbort.abort(); currentAbort = null; }
      chatHistory = [];
      clearAttachedFiles();
      if (sessions.length > 0) {
        const next = sessions[0];
        currentSession = next;
        chatHistory = [...next.history];
        localStorage.setItem('swapcat_last_session', next.id);
        renderHistory(chatHistory);
        renderSessionList();
      } else {
        createNewSession();
        document.getElementById('chatMessages').innerHTML = '';
        const t = getTime();
        const txt = 'Напиши задачу, перетащи изображение или файл.';
        chatHistory.push({ role: 'system_ui', content: txt, _time: t });
        appendMsg('agent', renderMarkdown(txt), t);
        renderSessionList();
      }
    } else {
      renderSessionList();
    }
  });
}

function showConfirm(opts, onConfirm) {
  // Поддержка старого формата showConfirm('строка', cb) и нового {title, subtitle, confirmLabel}
  if (typeof opts === 'string') opts = { title: opts };
  const title        = opts.title        || 'Подтвердить';
  const subtitle     = opts.subtitle     || '';
  const confirmLabel = opts.confirmLabel || 'Удалить';
  const iconSvg      = opts.iconSvg      || `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;

  const existing = document.getElementById('swapConfirm');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'swapConfirm';
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-icon">${iconSvg}</div>
      <div class="confirm-title">${title}</div>
      ${subtitle ? `<div class="confirm-subtitle">${subtitle}</div>` : ''}
      <div class="confirm-btns">
        <button class="confirm-cancel">Отмена</button>
        <button class="confirm-ok">${confirmLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('confirm-visible'));
  overlay.querySelector('.confirm-ok').addEventListener('click', () => { overlay.remove(); onConfirm(); });
  overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function renderSessionList() {
  const list = document.getElementById('sessionsList');
  if (!list) return;
  // Показываем только сессии с хотя бы одним юзер-сообщением
  const sessions = getSessions().filter(s => {
    return s.history && s.history.some(m => m.role === 'user');
  });

  if (sessions.length === 0) {
    list.innerHTML = '<div class="session-empty">Нет сохраненных сессий</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const d = new Date(s.updatedAt);
    const day = d.getDate();
    const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    const mon = months[d.getMonth()];
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const dateStr = `${day} ${mon}., ${hh}:${mm}`;
    const isStreaming = currentAbort && s.id !== currentSession?.id &&
      document.getElementById('streamingMsg') === null &&
      streamingSessionId === s.id;
    const streamingDot = isStreaming
      ? `<span class="session-streaming-dot" title="Генерация..."></span>`
      : '';
    return `
    <div class="session-item ${s.id === currentSession?.id ? 'active' : ''}" data-sid="${s.id}">
      <div class="session-preview" title="Двойной клик - переименовать">${streamingDot}${escapeHtml(s.preview || 'Сессия')}</div>
      <div class="session-meta">
        <span>${dateStr}</span>
        <button class="session-del" data-del="${s.id}" title="Удалить">✕</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.session-item').forEach(item => {
    const sid = item.dataset.sid;

    let clickTimer = null;

    item.addEventListener('click', () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        loadSession(sid);
      }, 220);
    });

    item.querySelector('.session-preview').addEventListener('dblclick', e => {
      e.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      startRenameSession(sid, e.target);
    });

    item.querySelector('.session-del').addEventListener('click', e => {
      e.stopPropagation();
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      deleteSession(sid, e);
    });
  });
}

function startRenameSession(id, el) {
  const prev = el.textContent;
  const inp = document.createElement('input');
  inp.className = 'session-rename-input';
  inp.value = prev;
  el.replaceWith(inp);
  inp.focus();
  inp.select();
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const val = inp.value.trim() || prev;
    if (val === prev) { renderSessionList(); return; }
    const sessions = getSessions();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx >= 0) {
      sessions[idx].preview = val.slice(0, 52);
      sessions[idx].renamed = true;
      saveSessions(sessions);
      if (currentSession?.id === id) {
        currentSession.preview = sessions[idx].preview;
        currentSession.renamed = true;
      }
    }
    renderSessionList();
    showToast('Сессия переименована', 'success');
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderSessionList(); }
  });
  inp.addEventListener('blur', commit);
}

// Файлы — изображения
function handleAnyFile(file) {
  if (!file) return;
  // Ограничение: максимум 1 вложение (файл или изображение)
  if (attachedItems.length >= 1) {
    showToast('Можно прикрепить только 1 файл или изображение', 'error');
    return;
  }
  // Защита от дублей по имени файла
  if (attachedItems.some(item => item.name === file.name)) {
    showToast('Файл «' + file.name + '» уже прикреплён', 'error');
    return;
  }
  if (file.type.startsWith('image/')) {
    handleImageFile(file);
  } else {
    handleTextFile(file);
  }
}

function handleAnyFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  // Берём только первый файл если уже есть вложение или передано несколько
  if (fileList.length > 1 && attachedItems.length === 0) {
    showToast('Можно прикрепить только 1 файл или изображение', 'error');
    handleAnyFile(fileList[0]);
    return;
  }
  Array.from(fileList).forEach(file => handleAnyFile(file));
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result.split(',')[1];
    attachedItems.push({
      kind: 'image',
      name: file.name || 'image',
      base64,
      mimeType: file.type,
      previewUrl: e.target.result
    });
    showAttachPreview();
  };
  reader.readAsDataURL(file);
}

// ── Файлы — текст ─────────────────────────────────────────────────────
const TEXT_EXTS = ['txt','md','py','js','ts','jsx','tsx','html','css','json','csv','xml','yaml','yml','sh','bash','c','cpp','h','java','go','rs','rb','php','sql','log','env','toml','ini','cfg'];

function handleTextFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!TEXT_EXTS.includes(ext)) {
    showToast('Файл .' + ext + ' не поддерживается', 'error');
    return;
  }
  if (file.size > 500 * 1024) {
    showToast('Файл слишком большой. Максимум 500 КБ', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    attachedItems.push({
      kind: 'file',
      name: file.name,
      content: e.target.result,
      size: file.size,
      ext
    });
    showAttachPreview();
  };
  reader.readAsText(file, 'UTF-8');
}

function showAttachPreview() {
  let preview = document.getElementById('attachPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'attachPreview';
    preview.className = 'attach-preview';
    document.querySelector('.chat-input-area').appendChild(preview);
  }

  if (attachedItems.length === 0) {
    preview.remove();
    return;
  }

  preview.innerHTML = attachedItems.map((item, idx) => {
    if (item.kind === 'image') {
      return `
      <div class="attach-chip">
        <img src="${item.previewUrl}" alt="фото">
        <span class="attach-chip-name">${escapeHtml(item.name || 'image')}</span>
        <button class="attach-remove" data-rm="${idx}" title="Удалить">✕</button>
      </div>`;
    }
    const kb = (item.size / 1024).toFixed(1);
    return `
      <div class="attach-chip attach-chip-file">
        <div class="attach-file-info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
          <span class="attach-file-name">${escapeHtml(item.name)}</span>
          <span class="attach-file-size">${kb} КБ</span>
        </div>
        <button class="attach-remove" data-rm="${idx}" title="Удалить">✕</button>
      </div>`;
  }).join('');

  preview.querySelectorAll('.attach-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.rm);
      if (!Number.isNaN(idx)) {
        attachedItems.splice(idx, 1);
        showAttachPreview();
      }
    });
  });
}

function clearAttachedFiles() {
  attachedItems = [];
  const p = document.getElementById('attachPreview');
  if (p) p.remove();
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
}

// Drag & Drop
function setupDragDrop() {
  const win = document.querySelector('.chat-window');
  win.addEventListener('dragover', e => { e.preventDefault(); win.classList.add('drag-over'); });
  win.addEventListener('dragleave', e => { if (!win.contains(e.relatedTarget)) win.classList.remove('drag-over'); });
  win.addEventListener('drop', e => {
    e.preventDefault();
    win.classList.remove('drag-over');
    if (e.dataTransfer.files?.length) handleAnyFiles(e.dataTransfer.files);
  });
}

// Панель сессий
function toggleSessionsPanel() {
  const panel = document.getElementById('sessionsPanel');
  const btn   = document.querySelector('.sessions-toggle-btn');
  panel.classList.toggle('collapsed');
  btn.classList.toggle('active');
}

function closeSessionsPanel() {
  const panel = document.getElementById('sessionsPanel');
  const btn   = document.querySelector('.sessions-toggle-btn');
  panel.classList.add('collapsed');
  btn.classList.remove('active');
}


// Отправить / переотправить
async function sendMessage() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const text    = input.value.trim();

  if (!text && attachedItems.length === 0) {
    if (editingMsgIndex !== null) showToast('Сообщение не может быть пустым', 'error');
    return;
  }

  // Режим редактирования
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

  const imageItems = attachedItems.filter(i => i.kind === 'image');
  const fileItems  = attachedItems.filter(i => i.kind === 'file');
  const msgTime = getTime();
  const attachCount = attachedItems.length;
  const hi = chatHistory.length;

  // Для отображения в чате: все изображения + все файлы
  const imgPreviews = imageItems.map(i => i.previewUrl);
  const fileNames   = fileItems.map(i => i.name);

  const userLabel = text ? escapeHtml(text) : null;
  appendMsg('user', userLabel, msgTime, {
    imagePreview: imgPreviews.length === 1 ? imgPreviews[0] : (imgPreviews.length > 1 ? imgPreviews : null),
    fileName: fileNames.length > 0 ? fileNames : null,
    historyIndex: hi
  });

  let userContent;
  // Метаданные для восстановления сессии
  const _attachMeta = [
    ...imageItems.map(i => ({ kind: 'image', name: i.name, previewUrl: i.previewUrl })),
    ...fileItems.map(f => ({ kind: 'file', name: f.name, size: f.size, ext: f.ext }))
  ];

  // Строим блок файлов в формате явных XML-тегов — малые модели читают лучше чем codeblock
  function buildFileBlock(file) {
    return `<file name="${file.name}" type="${file.ext}">\n${file.content}\n</file>`;
  }

  if (imageItems.length > 0) {
    const contentParts = imageItems.map(img => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
    }));
    const fileBlocks = fileItems.map(buildFileBlock).join('\n\n');
    const textPart = [text, fileBlocks].filter(Boolean).join('\n\n');
    contentParts.push({ type: 'text', text: textPart || '' });
    userContent = contentParts;
  } else if (fileItems.length > 0) {
    const fileBlocks = fileItems.map(buildFileBlock).join('\n\n');
    const instruction = text
      ? `ЗАДАЧА: ${text}\nФайл прикреплён ниже — прочитай его содержимое и выполни задачу.`
      : `ЗАДАЧА: Внимательно прочитай файл ниже и кратко опиши его содержимое и назначение.`;
    userContent = `${instruction}\n\n${fileBlocks}`;
  } else {
    userContent = text;
  }

  chatHistory.push({ role: 'user', content: userContent, _time: msgTime, _attachMeta });
  // Сохраняем сразу — чтобы сессия появилась в списке немедленно
  saveCurrentSession();
  input.value = '';
  input.style.height = 'auto';
  clearAttachedFiles();
  input.disabled = true;
  sendBtn.style.display = 'none';
  stopBtn.style.display = 'flex';

  currentAbort = new AbortController();
  streamingSessionId = currentSession.id;
  const streamDiv    = appendStreamingMsg();
  const streamBubble = document.getElementById('streamingBubble');
  const streamTime   = document.getElementById('streamingTime');
  let fullText = '';

  // Глобальные ссылки для reconnect при возврате в сессию
  activeStreamDiv    = streamDiv;
  activeStreamBubble = streamBubble;
  activeStreamTime   = streamTime;
  activeStreamText   = '';

  // Захватываем контекст текущей сессии — стриминг будет писать именно в неё
  const streamSessionId = currentSession.id;
  const streamChatHistory = chatHistory; // ссылка на массив этой сессии
  const streamAbort = currentAbort;

  try {
    let res = null;
    let lastError = null;
    for (const base of buildCandidateBases()) {
      try {
        const attempt = await fetch(buildApiUrl(base, '/v1/chat/completions'), {
          method: 'POST',
          headers: getHeaders(),
          signal: currentAbort.signal,
          body: JSON.stringify({
            model: getModelName(),
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...sanitizeHistoryForApi(chatHistory)],
            temperature: 0.7, max_tokens: 8192, stream: true
          })
        });

        if (!attempt.ok) {
          lastError = new Error(`Сервер: ${attempt.status} ${attempt.statusText}`);
          continue;
        }
        res = attempt;
        activeBaseUrl = base;
        break;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastError = e;
      }
    }

    if (!res) {
      throw (lastError || new Error('Не удалось подключиться ни к localhost, ни к ngrok'));
    }

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
          activeStreamText = fullText;
          // Обновляем DOM только если эта сессия сейчас активна
          if (currentSession && currentSession.id === streamSessionId) {
            if (activeStreamBubble) activeStreamBubble.innerHTML = renderMarkdown(fullText);
            if (typeof hljs !== 'undefined' && activeStreamBubble)
              activeStreamBubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
            document.getElementById('chatMessages').scrollTop = 999999;
          }
        } catch {}
      }
    }

    const assistantTime = getTime();
    // Не сохраняем пустой ответ в историю
    if (fullText) streamChatHistory.push({ role: 'assistant', content: fullText, _time: assistantTime });

    // Если сессия всё ещё активна — финализируем DOM
    if (currentSession && currentSession.id === streamSessionId) {
      if (activeStreamDiv) { activeStreamDiv.id = ''; }
      if (activeStreamBubble) {
        activeStreamBubble.id = '';
        activeStreamBubble.innerHTML = renderMarkdown(fullText);
      }
      if (activeStreamTime) {
        activeStreamTime.id = '';
        activeStreamTime.innerHTML = `${assistantTime} <button class="copy-btn" onclick="copyMsg(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> копировать</button>`;
      }

      if (typeof hljs !== 'undefined' && activeStreamBubble)
        activeStreamBubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));

      // Добавить кнопки копирования кода в завершённый ответ
      if (activeStreamBubble) activeStreamBubble.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-copy-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.title = 'Копировать код';
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
        btn.addEventListener('click', () => {
          const code = pre.querySelector('code');
          navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(() => {
            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
            setTimeout(() => {
              btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
            }, 1800);
          });
        });
        pre.style.position = 'relative';
        pre.appendChild(btn);
      });
    } else {
      // Сессия в фоне — убираем стриминг div из DOM (его там уже нет, но на всякий)
      streamDiv.remove();
    }

    // Сохраняем в нужную сессию (не обязательно текущую)
    saveBgSession(streamSessionId, streamChatHistory);

  } catch (err) {
    const isAbort = err.name === 'AbortError';
    if (currentSession && currentSession.id === streamSessionId) {
      streamDiv.remove();
      const isStreamError = err.message && (
        err.message.includes('Error in input stream') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('NetworkError') ||
        err.message.includes('network')
      );
      const errTime = getTime();

      if (isAbort) {
        if (fullText) {
          streamChatHistory.push({ role: 'assistant', content: fullText, _time: errTime });
          saveBgSession(streamSessionId, streamChatHistory);
          appendMsg('agent', renderMarkdown(fullText), errTime);
        }
      } else {
        const msg = isStreamError ? 'SwapCat сейчас не в сети' : `Ошибка: ${escapeHtml(err.message)}`;
        if (!isStreamError) {
          streamChatHistory.push({ role: 'system_ui', content: msg, _time: errTime });
        }
        if (fullText) {
          streamChatHistory.push({ role: 'assistant', content: fullText, _time: errTime });
        }
        if (fullText || !isStreamError) saveBgSession(streamSessionId, streamChatHistory);
        if (fullText) appendMsg('agent', renderMarkdown(fullText), errTime);
        if (!fullText) appendMsg('agent', msg, errTime);
      }
    } else {
      if (activeStreamDiv) activeStreamDiv.remove();
      if (fullText) {
        streamChatHistory.push({ role: 'assistant', content: fullText, _time: getTime() });
        saveBgSession(streamSessionId, streamChatHistory);
      }
    }
  } finally {
    // Восстанавливаем UI только если эта сессия всё ещё активна
    if (currentSession && currentSession.id === streamSessionId) {
      currentAbort = null;
      streamingSessionId = null;
      activeStreamDiv = null; activeStreamBubble = null; activeStreamTime = null; activeStreamText = '';
      input.disabled = false;
      sendBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
      input.focus();
    } else if (streamAbort === currentAbort) {
      currentAbort = null;
      streamingSessionId = null;
      activeStreamDiv = null; activeStreamBubble = null; activeStreamTime = null; activeStreamText = '';
    }
  }
}

function stopGeneration() {
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
}

function clearAllSessions() {
  showConfirm({
    title: 'Очистить историю',
    subtitle: 'Все сессии будут удалены без возможности восстановления.',
    confirmLabel: 'Удалить все'
  }, () => {
    if (currentAbort) { currentAbort.abort(); currentAbort = null; streamingSessionId = null; }
    saveSessions([]);
    chatHistory = [];
    clearAttachedFiles();
    createNewSession();
    document.getElementById('chatMessages').innerHTML = '';
    const t = getTime();
    const txt = 'Новая сессия. Чем займемся?';
    chatHistory.push({ role: 'system_ui', content: txt, _time: t });
    appendMsg('agent', renderMarkdown(txt), t);
    renderSessionList();
    showToast('Все сессии удалены', 'success');
  });
}

// Утилиты
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function startChat() {
  document.querySelector('.chat-input').focus();
  document.querySelector('.chat-section').scrollIntoView({ behavior: 'smooth' });
}

// Auto-resize textarea
function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chatInput');

  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape' && editingMsgIndex !== null) cancelEdit();
  });

  chatInput.addEventListener('input', () => autoResizeTextarea(chatInput));

  document.getElementById('attachBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', e => {
    if (e.target.files?.length) handleAnyFiles(e.target.files);
  });

  // Плавная тень шапки при скролле
  const header = document.querySelector('header');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  setupDragDrop();

  const sessions = getSessions();
  const lastId = localStorage.getItem('swapcat_last_session');
  const lastSession = lastId ? sessions.find(s => s.id === lastId) : null;

  if (lastSession && lastSession.history.length > 0) {
    currentSession = lastSession;
    chatHistory = cleanTransientErrors(restoreImagesFromSession(lastSession.id, [...lastSession.history]));
    renderSessionList();
    renderHistory(chatHistory);

    // Если последнее сообщение от пользователя без ответа ИИ — перегенерируем
    // Ищем последнее user-сообщение и проверяем нет ли после него assistant-ответа
    const lastUserIdx = [...chatHistory].map((m,i)=>({m,i})).filter(({m})=>m.role==='user').pop();
    const hasAnswerAfterLastUser = lastUserIdx
      ? chatHistory.slice(lastUserIdx.i + 1).some(m => m.role === 'assistant')
      : true;
  } else {
    createNewSession();
    renderSessionList();
    const initTime = getTime();
    const initTxt = 'Напиши задачу, перетащи изображение или файл.';
    chatHistory.push({ role: 'system_ui', content: initTxt, _time: initTime });
    appendMsg('agent', renderMarkdown(initTxt), initTime);
  }

  checkNetworkStatus();
  setInterval(checkNetworkStatus, 15000);

  // На телефонах стартует со скрытой панелью сессий, чтобы не перекрывала чат
  if (window.matchMedia('(max-width: 480px)').matches) {
    closeSessionsPanel();
  }
});
