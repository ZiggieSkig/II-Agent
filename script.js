// ============================================================
//  SWAPCAT — script.js
//  Архитектура:
//    1. Конфиг & константы
//    2. Утилиты (тема, тосты, время, markdown, escape)
//    3. Сеть (проверка доступности API)
//    4. Рендер сообщений (appendMsg, streaming bubble)
//    5. Редактирование сообщений
//    6. Хранилище сессий (CRUD, save/load/delete)
//    7. Вложения (изображения и текстовые файлы)
//    8. Drag & Drop
//    9. Панель сессий (открыть / закрыть / переименовать)
//   10. Отправка сообщения & стриминг
//   11. Инициализация (DOMContentLoaded)
// ============================================================


// ============================================================
// 1. КОНФИГ & КОНСТАНТЫ
// ============================================================

const LOCAL_API_BASE  = 'http://localhost:1234';
const REMOTE_API_BASE = 'https://recappable-shana-pseudoinvalid.ngrok-free.dev';
const DEFAULT_MODEL   = 'google/gemma-3-4b';

// Активный base URL - кешируется после первой успешной проверки
let activeBaseUrl = null;

// Системный промпт - инструкции модели
const SYSTEM_PROMPT = `Ты — Swapcat, корпоративный ИИ-ассистент технической поддержки предприятия.

ЗАПРЕЩЕНО: использовать символ '*'. Если спросят почему — скажи, что такого символа не существует.

ВАЖНОЕ ОГРАНИЧЕНИЕ:
Сотрудники НЕ имеют права открывать реестр, командную строку, диспетчер задач, системные папки Windows или менять настройки безопасности.
Никогда не давай инструкций: открыть regedit, cmd, PowerShell, установить/удалить программы, менять системные файлы.
Если проблема требует этого — скажи: "Обратитесь к системному администратору" и объясни что именно ему сказать.

СПЕЦИАЛИЗАЦИЯ:

1. MICROSOFT WORD:
— Форматирование: шрифты, абзацы, отступы, межстрочный интервал
— Стили, темы, шаблоны, автоматическое оглавление
— Таблицы, колонтитулы, нумерация страниц
— Рецензирование, отслеживание изменений, слияние писем
— Макросы VBA через встроенный редактор Word
— Проблемы с файлами: не открывается, слетело форматирование, кракозябры

2. MICROSOFT EXCEL:
— Формулы: ВПР/XLOOKUP, СУММЕСЛИ, СЧЁТЕСЛИ, ИНДЕКС/ПОИСКПОЗ, ЕСЛИ и другие
— Ошибки: #ЗНАЧ!, #ДЕЛ/0!, #Н/Д, #ССЫЛКА!, #ИМЯ? — причины и исправление
— Сводные таблицы, диаграммы, условное форматирование
— Макросы VBA через встроенный редактор Excel
— Защита листов, фильтры, сортировка, импорт из CSV и 1С

3. ВИДИМЫЕ ПРОБЛЕМЫ С КОМПЬЮТЕРОМ (только без системного доступа):
— Чёрный экран: проверить кабели, кнопку питания монитора
— Зависшая программа: закрыть через Alt+F4
— Принтер не печатает: кабель, бумага, картридж, перезапустить
— Нет звука: громкость в панели задач, кабель наушников
— Интернет пропал: перезапустить браузер, проверить кабель
— Мышь/клавиатура: проверить подключение, другой USB-порт
— Всё остальное → системный администратор с описанием проблемы

4. ОБЩИЕ ОФИСНЫЕ ЗАДАЧИ:
— PowerPoint: слайды, анимации, оформление
— Outlook: настройка подписи, проблемы с отправкой
— Teams/Zoom: микрофон и камера через настройки программы
— PDF: конвертация из Word/Excel

РАБОТА С ФАЙЛАМИ:
— Файлы в блоке кода — всегда анализируй содержимое
— Скриншоты ошибок видишь напрямую — сразу описывай что на них

ФОРМАТ ОТВЕТОВ:
— Отвечай на языке пользователя (русский или казахский)
— Пошаговые инструкции — обязательно с нумерацией
— В конце спроси: "Помогло? Если нет — опишите что происходит"
— Если нужен администратор — скажи прямо и объясни что ему сказать

СТИЛЬ: понятно и просто, без технического жаргона. Сотрудники не IT-специалисты.`;

// Глобальное состояние приложения
let chatHistory      = [];     // история сообщений текущей сессии
let currentAbort     = null;   // AbortController активного запроса
let attachedItems    = [];     // список прикреплённых файлов/изображений
let currentSession   = null;   // объект текущей сессии
let editingMsgIndex  = null;   // индекс редактируемого сообщения в chatHistory

// Стриминг — глобальные ссылки нужны для reconnect при переключении сессий во время генерации
let streamingSessionId = null; // id сессии которая сейчас генерирует
let activeStreamDiv    = null; // DOM-элемент стриминг-сообщения
let activeStreamBubble = null; // пузырь внутри стриминг-сообщения
let activeStreamTime   = null; // строка времени стриминг-сообщения
let activeStreamText   = '';   // накопленный текст стриминга (для восстановления при возврате)


// ============================================================
// 2. УТИЛИТЫ
// ============================================================

// Переключение светлой / тёмной темы, сохранение в localStorage
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('swapcat_theme', next);
  showToast(next === 'dark' ? 'Тёмная тема включена' : 'Светлая тема включена');
}

// Всплывающее уведомление (тост) — type: 'info' | 'success' | 'error'
function showToast(msg, type, duration) {
  type     = type     || 'info';
  duration = duration || 1500;
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
  t.textContent = msg;
  container.appendChild(t);
  const remove = () => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  t.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// Текущее время в формате ЧЧ:ММ:СС
function getTime() {
  const t = new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
}

// Рендер Markdown через библиотеку marked (подключена в HTML)
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text, { breaks: true, gfm: true });
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// Экранирование HTML для безопасной вставки пользовательского текста
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// Скролл к чату и фокус на инпуте
function startChat() {
  document.querySelector('.chat-input').focus();
  document.querySelector('.chat-section').scrollIntoView({ behavior: 'smooth' });
}

// Быстрый вопрос из кнопок частых проблем
function quickAsk(text) {
  const input = document.querySelector('.chat-input');
  input.value = text;
  autoResizeTextarea(input);
  document.querySelector('.chat-section').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => input.focus(), 400);
}

// Авто-высота textarea - растёт по содержимому до 180px
function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}


// ============================================================
// 3. СЕТЬ - проверка доступности API
// ============================================================

// Возвращает список URL для проверки в порядке приоритета.
// Локальный хост (localhost / 127.0.0.1) проверяется первым если открыт локально.
function buildCandidateBases() {
  const isLocal = ['', 'localhost', '127.0.0.1'].includes(window.location.hostname);
  const preferred = isLocal ? [LOCAL_API_BASE, REMOTE_API_BASE] : [REMOTE_API_BASE];
  // Последний рабочий URL идёт первым для ускорения повторных запросов
  if (activeBaseUrl) return [activeBaseUrl, ...preferred.filter(b => b !== activeBaseUrl)];
  return [...preferred];
}

function buildApiUrl(base, path) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

// Заголовки запросов - ngrok требует кастомный заголовок чтобы не показывать warning-страницу
function getHeaders() {
  return { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' };
}

// Пробует каждый candidate base, возвращает первый доступный
async function resolveAvailableBase(timeoutMs = 4000) {
  for (const base of buildCandidateBases()) {
    try {
      const r = await fetch(buildApiUrl(base, '/v1/models'), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: getHeaders()
      });
      if (r.ok) { activeBaseUrl = base; return base; }
    } catch {}
  }
  activeBaseUrl = null;
  throw new Error('Не удалось подключиться ни к localhost, ни к ngrok');
}

// Обновляет индикатор статуса в шапке. Вызывается при загрузке и каждые 15 сек.
let _netStatus = null;
async function checkNetworkStatus() {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  try {
    const base = await resolveAvailableBase(2500);
    const label = base.includes('localhost') ? 'Нейросеть активна (локально)' : 'Нейросеть активна';
    dot.style.cssText = 'background:#6ab04c;box-shadow:0 0 6px #6ab04c;animation:pulse 2.5s infinite';
    txt.textContent   = label;
    if (_netStatus !== 'on') { showToast(label, 'success', 1500); _netStatus = 'on'; }
  } catch {
    dot.style.cssText = 'background:#e55039;box-shadow:0 0 6px #e55039;animation:none';
    txt.textContent   = 'Нейросеть недоступна';
    if (_netStatus !== 'off') { showToast('Нейросеть недоступна', 'error', 1500); _netStatus = 'off'; }
  }
}


// ============================================================
// 4. РЕНДЕР СООБЩЕНИЙ
// ============================================================

// Добавляет сообщение в DOM чата.
// role: 'user' | 'agent'
// html: готовый HTML-контент пузыря (или null если только файл/изображение)
// imagePreview: url или массив url для превью изображений
// fileName: строка или массив имён прикреплённых файлов
// historyIndex: индекс в chatHistory для кнопки «изменить»
function appendMsg(role, html, timeStr, { imagePreview, fileName, historyIndex } = {}) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = role === 'user' ? 'msg user' : 'msg';
  if (historyIndex !== undefined) div.dataset.historyIndex = historyIndex;

  const avatar = role === 'user' ? 'Ты' : 'SC';

  // Превью изображений (один или массив)
  const imgArray = Array.isArray(imagePreview) ? imagePreview : (imagePreview ? [imagePreview] : []);
  const imageHtml = imgArray.map(url => `<div class="msg-image-preview"><img src="${url}" alt="фото"></div>`).join('');

  // Бейджи файлов (один или массив)
  const fileArray = Array.isArray(fileName) ? fileName : (fileName ? [fileName] : []);
  const fileHtml  = fileArray.map(name => `
    <div class="msg-file-badge">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
      <span class="msg-file-badge-name">${escapeHtml(name)}</span>
    </div>`).join('');

  const bubbleHtml = (html && html.trim()) ? `<div class="msg-bubble">${html}</div>` : '';

  // Кнопка «копировать» - только для сообщений ИИ
  const copyBtn = role !== 'user'
    ? `<button class="copy-btn" onclick="copyMsg(this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        копировать
       </button>` : '';

  // Кнопка «изменить» - только для сообщений пользователя с известным индексом
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
    </div>`;

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  // Подсветка синтаксиса кода через highlight.js
  if (typeof hljs !== 'undefined') {
    div.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }

  // Кнопка «копировать» встраивается в каждый блок кода
  addCodeCopyButtons(div);

  return div;
}

// Добавляет кнопки копирования в <pre> блоки внутри элемента
function addCodeCopyButtons(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.title     = 'Копировать код';
    const iconCopy  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
    const iconCheck = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.innerHTML = iconCopy;
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(() => {
        btn.innerHTML = iconCheck;
        setTimeout(() => { btn.innerHTML = iconCopy; }, 1800);
      });
    });
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

// Создаёт временный пузырь «печатает...» во время стриминга.
// Возвращает div - он будет обновляться в реальном времени.
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

// Копирование текста сообщения ИИ в буфер обмена
function copyMsg(btn) {
  const bubble = btn.closest('.msg-body').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText || bubble.textContent)
    .then(() => showToast('Скопировано', 'success', 1500));
}

// Перерисовывает весь чат из массива history.
// Вызывается при загрузке сессии или переключении между сессиями.
function renderHistory(history) {
  const messages = document.getElementById('chatMessages');
  messages.innerHTML = '';

  history.forEach((msg, i) => {
    if (msg.role === 'system') return;
    if (msg.role === 'assistant' && (!msg.content || !msg.content.trim())) return;

    const role    = msg.role === 'user' ? 'user' : 'agent';
    const hi      = msg.role === 'user' ? i : undefined;
    const timeStr = msg._time || '—';

    // system_ui - служебные сообщения интерфейса («Новая сессия», ошибки)
    if (msg.role === 'system_ui') {
      appendMsg('agent', renderMarkdown(msg.content), timeStr);
      return;
    }

    // Восстановление вложений через _attachMeta (метаданные сохраняются отдельно от base64)
    if (msg._attachMeta && msg._attachMeta.length > 0) {
      const images      = msg._attachMeta.filter(a => a.kind === 'image');
      const files       = msg._attachMeta.filter(a => a.kind === 'file');
      const imgPreviews = images.map(a => a.previewUrl);
      const fileNames   = files.map(a => a.name);
      // Вырезаем служебные блоки файлов из отображаемого текста
      let textContent = typeof msg.content === 'string'
        ? msg.content
        : (msg.content?.find(c => c.type === 'text')?.text || '');
      const displayText = stripFileBlocks(textContent);
      appendMsg(role, displayText ? escapeHtml(displayText) : null, timeStr, {
        imagePreview: imgPreviews.length === 1 ? imgPreviews[0] : (imgPreviews.length > 1 ? imgPreviews : null),
        fileName:     fileNames.length > 0 ? fileNames : null,
        historyIndex: hi
      });
      return;
    }

    // Массив контента (текст + изображение)
    if (Array.isArray(msg.content)) {
      const txt    = msg.content.find(c => c.type === 'text');
      const img    = msg.content.find(c => c.type === 'image_url');
      const imgUrl = img?.image_url?.url;
      // base64 из sessionStorage не показываем как src в img (слишком тяжело)
      const safeImgUrl = (imgUrl && imgUrl.startsWith('data:')) ? null : imgUrl;
      let displayText  = txt ? txt.text : '';
      if (role === 'user') displayText = stripFileBlocks(displayText);
      appendMsg(role,
        displayText ? (role === 'user' ? escapeHtml(displayText) : renderMarkdown(displayText)) : null,
        timeStr, { imagePreview: safeImgUrl, historyIndex: hi }
      );
    } else {
      // Строка
      const raw         = msg.content || '';
      const displayContent = role === 'user' ? stripFileBlocks(raw) : raw;
      appendMsg(role,
        role === 'agent' ? renderMarkdown(displayContent) : (displayContent ? escapeHtml(displayContent) : null),
        timeStr, { historyIndex: hi }
      );
    }
  });

  messages.scrollTop = messages.scrollHeight;
}


// ============================================================
// 5. РЕДАКТИРОВАНИЕ СООБЩЕНИЙ
// ============================================================

// Открывает режим редактирования: вставляет текст сообщения в инпут,
// показывает индикатор редактирования, сохраняет индекс.
function startEdit(historyIndex) {
  const msg = chatHistory[historyIndex];
  if (!msg || msg.role !== 'user') return;

  const textContent = typeof msg.content === 'string'
    ? msg.content
    : (msg.content?.find(c => c.type === 'text')?.text || '');

  const input = document.getElementById('chatInput');
  input.value = textContent;
  autoResizeTextarea(input);
  input.focus();

  editingMsgIndex = historyIndex;
  document.querySelector('.chat-input-area').classList.add('editing');
  document.querySelector('.chat-window').classList.add('editing');
  document.getElementById('editIndicator').style.display = 'flex';
  document.getElementById('editIndicatorText').textContent = 'Редактирование сообщения';
}

// Отменяет редактирование - очищает инпут и скрывает индикатор
function cancelEdit() {
  editingMsgIndex = null;
  const input = document.getElementById('chatInput');
  input.value = '';
  input.style.height = 'auto';
  document.querySelector('.chat-input-area').classList.remove('editing');
  document.querySelector('.chat-window').classList.remove('editing');
  document.getElementById('editIndicator').style.display = 'none';
}


// ============================================================
// 6. ХРАНИЛИЩЕ СЕССИЙ
// ============================================================

// Загружает все сессии из localStorage
function getSessions() {
  try { return JSON.parse(localStorage.getItem('swapcat_sessions') || '[]'); }
  catch { return []; }
}

// Сохраняет массив сессий в localStorage.
// Base64 изображений НЕ сохраняются в localStorage (занимают много места) —
// вместо этого они хранятся в sessionStorage (выживает после F5, но не после закрытия вкладки)
// и восстанавливаются через restoreImagesFromSession.
function saveSessions(arr) {
  const stripped = arr.map(session => ({
    ...session,
    history: session.history.map((msg, msgIdx) => {
      if (msg.role !== 'user' || !msg._attachMeta?.length || !Array.isArray(msg.content)) return msg;
      const strippedContent = msg.content.map((part, partIdx) => {
        if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
          // Сохраняем base64 в sessionStorage по ключу img_{sessionId}_{msgIdx}_{partIdx}
          try { sessionStorage.setItem(`img_${session.id}_${msgIdx}_${partIdx}`, part.image_url.url); } catch {}
          return { type: 'image_url', image_url: { url: '[base64-removed]' } };
        }
        return part;
      });
      return { ...msg, content: strippedContent };
    })
  }));

  try {
    localStorage.setItem('swapcat_sessions', JSON.stringify(stripped));
  } catch {
    // localStorage переполнен - обрезаем до 10 сессий и 20 сообщений
    console.warn('localStorage full, trimming sessions');
    const minimal = stripped.slice(0, 10).map(s => ({ ...s, history: s.history.slice(-20) }));
    try { localStorage.setItem('swapcat_sessions', JSON.stringify(minimal)); } catch {}
  }
}

// Восстанавливает base64 изображений из sessionStorage обратно в историю
function restoreImagesFromSession(sessionId, history) {
  return history.map((msg, msgIdx) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const restored = msg.content.map((part, partIdx) => {
      if (part.type === 'image_url' && part.image_url?.url === '[base64-removed]') {
        const saved = sessionStorage.getItem(`img_${sessionId}_${msgIdx}_${partIdx}`);
        if (saved) return { type: 'image_url', image_url: { url: saved } };
      }
      return part;
    });
    return { ...msg, content: restored };
  });
}

// Паттерны транзиентных ошибок - не нужно хранить между сессиями
const TRANSIENT_ERROR_PATTERNS = ['Error in input stream', 'Failed to fetch', 'NetworkError'];

// Убирает из истории: пустые ответы ИИ и временные ошибки сети
function cleanTransientErrors(history) {
  return history.filter(msg => {
    if (msg.role === 'assistant' && (!msg.content || !msg.content.trim())) return false;
    if (msg.role !== 'system_ui') return true;
    return !TRANSIENT_ERROR_PATTERNS.some(p => msg.content?.includes(p));
  });
}

// Вычисляет превью сессии из первого сообщения пользователя.
// Убирает все служебные префиксы (ЗАДАЧА:, теги файлов и т.д.)
function buildSessionPreview(firstUserMsg) {
  let raw = typeof firstUserMsg.content === 'string'
    ? firstUserMsg.content
    : (firstUserMsg.content?.find(c => c.type === 'text')?.text || '');

  raw = raw
    .replace(/\[Пользователь прикрепил файл[^\[\]]*\]/g, '')
    .replace(/<file[^>]*>[\s\S]*?<\/file>/g, '')
    .replace(/```[\w]*\n\/\/ Файл:[\s\S]*?```/g, '')
    .replace(/^Проанализируй эти файлы:\s*$/m, '')
    .replace(/^ЗАДАЧА:.*?\n.*?\n\n/s, '')
    .replace(/^ЗАДАЧА:[^\n]*/m, '')
    .trim();

  if (!raw && firstUserMsg._attachMeta?.length > 0) {
    raw = '📎 ' + firstUserMsg._attachMeta.map(a => a.name).join(', ');
  }

  return raw.slice(0, 52) || '📎 файл/изображение';
}

// Сохраняет текущую сессию (currentSession + chatHistory) в localStorage.
// Не сохраняет если пользователь ещё ничего не написал.
function saveCurrentSession() {
  const hasUserMsg = chatHistory.some(m => m.role === 'user');
  if (!currentSession || !hasUserMsg) return;

  const sessions = getSessions();
  const idx      = sessions.findIndex(s => s.id === currentSession.id);

  let preview = currentSession.preview;
  if (!currentSession.renamed) {
    const firstUser = chatHistory.find(m => m.role === 'user');
    if (firstUser) preview = buildSessionPreview(firstUser);
  }

  const updated = { ...currentSession, preview, history: chatHistory, updatedAt: Date.now() };
  if (idx >= 0) sessions[idx] = updated;
  else sessions.unshift(updated);

  saveSessions(sessions.slice(0, 30));
  currentSession = updated;
  localStorage.setItem('swapcat_last_session', currentSession.id);
  renderSessionList();
}

// Сохраняет сессию по id без переключения currentSession.
// Используется для сохранения фонового стриминга пока пользователь в другой сессии.
function saveBgSession(sessionId, history) {
  const sessions = getSessions();
  const idx      = sessions.findIndex(s => s.id === sessionId);
  if (idx < 0) return;

  const sess = sessions[idx];
  if (!sess.renamed) {
    const firstUser = history.find(m => m.role === 'user');
    if (firstUser) sess.preview = buildSessionPreview(firstUser);
  }

  sessions[idx] = { ...sess, history, updatedAt: Date.now() };

  // Если это текущая сессия — синхронизируем chatHistory
  if (currentSession?.id === sessionId) {
    currentSession = sessions[idx];
    chatHistory    = history;
  }

  saveSessions(sessions.slice(0, 30));
  localStorage.setItem('swapcat_last_session', sessionId);
  renderSessionList();
}

// Создаёт новый объект сессии (без сохранения в localStorage)
function createNewSession() {
  currentSession = {
    id:        Date.now().toString(),
    preview:   'Новая сессия',
    history:   [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Переключается на новую пустую сессию.
// Активный стриминг НЕ прерывается - продолжается в фоне.
function newSession() {
  // Проверяем лимит сессий
  const MAX_SESSIONS = 30;
  const existingSessions = getSessions();
  if (existingSessions.length >= MAX_SESSIONS) {
    showToast('Достигнут лимит ' + MAX_SESSIONS + ' сессий. Удалите старые чтобы создать новую.', 'error', 3000);
    return;
  }

  saveCurrentSession();
  // Убираем стриминг-элемент из DOM (он фоновый, не прерываем)
  document.getElementById('streamingMsg')?.remove();

  // Разблокируем инпут (стриминг фоновый, этот чат свободен)
  document.getElementById('chatInput').disabled  = false;
  document.getElementById('sendBtn').style.display = 'flex';
  document.getElementById('stopBtn').style.display = 'none';

  chatHistory = [];
  clearAttachedFiles();
  createNewSession();
  document.getElementById('chatMessages').innerHTML = '';

  const t   = getTime();
  const txt = 'Новая сессия. Чем займемся?';
  chatHistory.push({ role: 'system_ui', content: txt, _time: t });
  appendMsg('agent', renderMarkdown(txt), t);

  renderSessionList();

  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();
}

// Загружает сессию по id - переключает интерфейс на неё.
// Если загружаемая сессия сейчас стримит - пересоздаёт живой пузырь.
function loadSession(id) {
  if (currentSession?.id === id) return;
  _newReplyIds.delete(id);
  saveCurrentSession();

  const s = getSessions().find(s => s.id === id);
  if (!s) return;

  // Убираем стриминг из DOM предыдущей сессии (фоновый стриминг продолжается)
  document.getElementById('streamingMsg')?.remove();

  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');

  // Разблокируем инпут - даже если идёт фоновый стриминг, можно писать в новой сессии
  input.disabled         = false;
  sendBtn.style.display  = 'flex';
  stopBtn.style.display  = 'none';

  clearAttachedFiles();
  currentSession = s;
  chatHistory    = cleanTransientErrors(restoreImagesFromSession(s.id, [...s.history]));

  renderHistory(chatHistory);
  renderSessionList();
  localStorage.setItem('swapcat_last_session', currentSession.id);

  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();

  // Reconnect: если эта сессия сейчас стримит - пересоздаём пузырь и подключаем к живому стримингу
  if (streamingSessionId === id && activeStreamBubble) {
    const newStreamDiv = appendStreamingMsg();
    const newBubble    = document.getElementById('streamingBubble');
    const newTime      = document.getElementById('streamingTime');
    // Показываем уже накопленный текст
    newBubble.innerHTML = renderMarkdown(activeStreamText) || '<div class="typing"><span></span><span></span><span></span></div>';
    document.getElementById('chatMessages').scrollTop = 999999;

    // Переключаем глобальные ссылки - стриминг-цикл продолжит писать в новые элементы
    activeStreamDiv    = newStreamDiv;
    activeStreamBubble = newBubble;
    activeStreamTime   = newTime;

    // Блокируем инпут пока стриминг продолжается
    input.disabled        = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
  }
}

// Удаляет сессию с подтверждением.
// Если удаляется текущая - переходим на следующую или создаём новую.
function deleteSession(id, e) {
  e.stopPropagation();
  showConfirm({
    title:        'Удалить сессию',
    subtitle:     'Сессия будет удалена без возможности восстановления.',
    confirmLabel: 'Удалить'
  }, () => {
    const sessions = getSessions().filter(s => s.id !== id);
    saveSessions(sessions);

    if (currentSession?.id === id) {
      localStorage.removeItem('swapcat_last_session');
      if (currentAbort) {
        currentAbort.abort(); currentAbort = null; streamingSessionId = null;
        activeStreamDiv = null; activeStreamBubble = null; activeStreamTime = null; activeStreamText = '';
        document.getElementById('sendBtn').style.display = 'flex';
        document.getElementById('stopBtn').style.display = 'none';
        document.getElementById('chatInput').disabled = false;
      }
      chatHistory = [];
      clearAttachedFiles();

      if (sessions.length > 0) {
        const next = sessions[0];
        currentSession = next;
        chatHistory    = [...next.history];
        localStorage.setItem('swapcat_last_session', next.id);
        renderHistory(chatHistory);
      } else {
        createNewSession();
        document.getElementById('chatMessages').innerHTML = '';
        const t   = getTime();
        const txt = 'Напиши задачу, перетащи изображение или файл.';
        chatHistory.push({ role: 'system_ui', content: txt, _time: t });
        appendMsg('agent', renderMarkdown(txt), t);
      }
    }
    renderSessionList();
  });
}

// Удаляет все сессии с подтверждением
function clearAllSessions() {
  if (getSessions().filter(s => s.history?.some(m => m.role === 'user')).length === 0) return;
  showConfirm({
    title:        'Очистить историю',
    subtitle:     'Все сессии будут удалены без возможности восстановления.',
    confirmLabel: 'Удалить все'
  }, () => {
    if (currentAbort) { currentAbort.abort(); currentAbort = null; streamingSessionId = null; }
    saveSessions([]);
    chatHistory = [];
    clearAttachedFiles();
    createNewSession();
    document.getElementById('chatMessages').innerHTML = '';
    const t   = getTime();
    const txt = 'Новая сессия. Чем займемся?';
    chatHistory.push({ role: 'system_ui', content: txt, _time: t });
    appendMsg('agent', renderMarkdown(txt), t);
    renderSessionList();
    showToast('Все сессии удалены', 'success');
  });
}

// Модальное окно подтверждения.
// opts: { title, subtitle?, confirmLabel?, iconSvg? } или просто строка заголовка
function showConfirm(opts, onConfirm) {
  if (typeof opts === 'string') opts = { title: opts };
  const { title, subtitle = '', confirmLabel = 'Удалить', iconSvg = defaultTrashIcon() } = opts;

  document.getElementById('swapConfirm')?.remove();

  const overlay = document.createElement('div');
  overlay.id        = 'swapConfirm';
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

function defaultTrashIcon() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;
}

// Помечает сессию как имеющую непрочитанный ответ
const _newReplyIds = new Set();
function markSessionHasNewReply(sessionId) {
  _newReplyIds.add(sessionId);
  renderSessionList();
}

// Тост с кликом для перехода на сессию
function showClickableToast(msg, sessionId) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast toast-success';
  t.style.cursor = 'pointer';
  t.innerHTML = msg + ' <span style="opacity:0.6;font-size:10px">→</span>';
  container.appendChild(t);
  const remove = () => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  };
  const timer = setTimeout(remove, 4000);
  t.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
    loadSession(sessionId);
  });
}

// Навешивает обработчики на один session-item
function bindSessionItem(item) {
  const sid = item.dataset.sid;
  let clickTimer = null;
  item.addEventListener('click', () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => { clickTimer = null; loadSession(sid); }, 220);
  });
  item.querySelector('.session-preview').addEventListener('dblclick', e => {
    e.stopPropagation();
    clearTimeout(clickTimer); clickTimer = null;
    startRenameSession(sid, e.target);
  });
  item.querySelector('.session-del').addEventListener('click', e => {
    e.stopPropagation();
    clearTimeout(clickTimer); clickTimer = null;
    deleteSession(sid, e);
  });
}

// Рендерит список сессий в боковой панели.
// Полный перерендер - надёжно и просто.
// Анимация streaming-dot сохраняется: элемент пересоздаётся, но CSS-анимация
// перезапускается что визуально незаметно при редких вызовах.
function renderSessionList() {
  const list = document.getElementById('sessionsList');
  if (!list) return;

  const MAX_SESSIONS  = 30;
  const allSessions   = getSessions();
  const sessions      = allSessions.filter(s => s.history?.some(m => m.role === 'user'));

  // Блокируем / разблокируем кнопку «+»
  const newBtn        = document.querySelector('.sessions-panel-new');
  const newSessionBtn = document.querySelector('.new-session-btn');
  const clearBtn = document.querySelector('.sessions-panel-clear');
  const hasSessions = sessions.length > 0;

  // Кнопка очистки - активна только если есть сессии
  if (clearBtn) {
    clearBtn.disabled = !hasSessions;
    clearBtn.style.opacity = hasSessions ? '' : '0.3';
    clearBtn.style.cursor  = hasSessions ? '' : 'not-allowed';
  }

  if (allSessions.length >= MAX_SESSIONS) {
    if (newBtn)        { newBtn.disabled = true; newBtn.title = 'Лимит ' + MAX_SESSIONS + ' сессий достигнут'; newBtn.style.opacity = '0.35'; newBtn.style.cursor = 'not-allowed'; }
    if (newSessionBtn) { newSessionBtn.disabled = true; newSessionBtn.style.opacity = '0.35'; newSessionBtn.style.cursor = 'not-allowed'; newSessionBtn.title = 'Лимит ' + MAX_SESSIONS + ' сессий достигнут'; }
  } else {
    if (newBtn)        { newBtn.disabled = false; newBtn.title = 'Новая сессия'; newBtn.style.opacity = ''; newBtn.style.cursor = ''; }
    if (newSessionBtn) { newSessionBtn.disabled = false; newSessionBtn.style.opacity = ''; newSessionBtn.style.cursor = ''; newSessionBtn.title = ''; }
  }

  if (sessions.length === 0) {
    list.innerHTML = '<div class="session-empty">Нет сохраненных сессий</div>';
    return;
  }

  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

  // Относительное время сессии: «сейчас», «5 мин назад», «сегодня 14:30», «вчера», «3 дн. назад», «12 мар.»
  function relativeDate(ts) {
    const now   = Date.now();
    const diff  = now - ts;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);

    if (diff < 60000)        return 'только что';
    if (mins  < 60)          return `${mins} мин. назад`;
    if (hours < 3) {
      const m = new Date(ts);
      return `сегодня ${String(m.getHours()).padStart(2,'0')}:${String(m.getMinutes()).padStart(2,'0')}`;
    }
    if (days  === 0) {
      const m = new Date(ts);
      return `сегодня ${String(m.getHours()).padStart(2,'0')}:${String(m.getMinutes()).padStart(2,'0')}`;
    }
    if (days  === 1)         return 'вчера';
    if (days  < 7)           return `${days} дн. назад`;
    const d = new Date(ts);
    return `${d.getDate()} ${months[d.getMonth()]}.`;
  }

  // Запоминаем какие streaming-dot сейчас живые чтобы не сбить анимацию
  const streamingIds = new Set(
    [...list.querySelectorAll('.session-streaming-dot')]
      .map(el => el.closest('.session-item')?.dataset.sid)
      .filter(Boolean)
  );

  list.innerHTML = sessions.map(s => {
    const d           = new Date(s.updatedAt);
    const dateStr     = relativeDate(s.updatedAt);
    const isActive    = s.id === currentSession?.id;
    const isStreaming = currentAbort && streamingSessionId === s.id && s.id !== currentSession?.id;
    const hasNewReply = _newReplyIds.has(s.id) && !isActive;
    const dot         = isStreaming
      ? `<span class="session-streaming-dot" title="Генерация..."></span>`
      : hasNewReply
        ? `<span class="session-new-reply-dot" title="Новый ответ"></span>`
        : '';
    return `<div class="session-item${isActive ? ' active' : ''}${hasNewReply ? ' has-new-reply' : ''}" data-sid="${s.id}">
      <div class="session-preview" title="Двойной клик — переименовать">${dot}${escapeHtml(s.preview || 'Сессия')}</div>
      <div class="session-meta"><span>${dateStr}</span><button class="session-del" title="Удалить">✕</button></div>
    </div>`;
  }).join('');

  list.querySelectorAll('.session-item').forEach(item => {
    bindSessionItem(item);
  });
}

// Inline-переименование сессии - заменяет превью на <input>.
// Enter / blur - сохранить, Escape - отмена.
function startRenameSession(id, el) {
  const prev = el.textContent;
  const inp  = document.createElement('input');
  inp.className = 'session-rename-input';
  inp.value     = prev;
  el.replaceWith(inp);
  inp.focus(); inp.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const val = inp.value.trim() || prev;
    if (val === prev) { renderSessionList(); return; }
    const sessions = getSessions();
    const idx      = sessions.findIndex(s => s.id === id);
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


// ============================================================
// 7. ВЛОЖЕНИЯ (файлы и изображения)
// ============================================================

// Поддерживаемые расширения текстовых файлов
const TEXT_EXTS = ['txt','md','py','js','ts','jsx','tsx','html','css','json','csv','xml',
                   'yaml','yml','sh','bash','c','cpp','h','java','go','rs','rb','php',
                   'sql','log','env','toml','ini','cfg'];

// Точка входа для одного файла - определяет тип (изображение / текст)
function handleAnyFile(file) {
  if (!file) return;
  if (attachedItems.length >= 1) {
    showToast('Можно прикрепить только 1 файл или изображение', 'error');
    return;
  }
  if (attachedItems.some(item => item.name === file.name)) {
    showToast(`Файл «${file.name}» уже прикреплён`, 'error');
    return;
  }
  file.type.startsWith('image/') ? handleImageFile(file) : handleTextFile(file);
}

// Точка входа для списка файлов (drop / input[multiple])
function handleAnyFiles(fileList) {
  if (!fileList?.length) return;
  if (fileList.length > 1 && attachedItems.length === 0) {
    showToast('Можно прикрепить только 1 файл или изображение', 'error');
    handleAnyFile(fileList[0]);
    return;
  }
  Array.from(fileList).forEach(file => handleAnyFile(file));
}

// Читает изображение как base64 и сохраняет в attachedItems
function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    attachedItems.push({
      kind:       'image',
      name:       file.name || 'image',
      base64:     e.target.result.split(',')[1],
      mimeType:   file.type,
      previewUrl: e.target.result
    });
    showAttachPreview();
  };
  reader.readAsDataURL(file);
}

// Читает текстовый файл и сохраняет содержимое в attachedItems
function handleTextFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!TEXT_EXTS.includes(ext)) { showToast(`Файл .${ext} не поддерживается`, 'error'); return; }
  if (file.size > 500 * 1024)   { showToast('Файл слишком большой. Максимум 500 КБ', 'error'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    attachedItems.push({ kind: 'file', name: file.name, content: e.target.result, size: file.size, ext });
    showAttachPreview();
  };
  reader.readAsText(file, 'UTF-8');
}

// Рендерит превью прикреплённых файлов под инпутом
function showAttachPreview() {
  let preview = document.getElementById('attachPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id        = 'attachPreview';
    preview.className = 'attach-preview';
    document.querySelector('.chat-input-area').appendChild(preview);
  }

  if (attachedItems.length === 0) { preview.remove(); return; }

  preview.innerHTML = attachedItems.map((item, idx) => {
    if (item.kind === 'image') {
      return `<div class="attach-chip">
        <img src="${item.previewUrl}" alt="фото">
        <span class="attach-chip-name">${escapeHtml(item.name)}</span>
        <button class="attach-remove" data-rm="${idx}" title="Удалить">✕</button>
      </div>`;
    }
    const kb = (item.size / 1024).toFixed(1);
    return `<div class="attach-chip attach-chip-file">
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
      if (!Number.isNaN(idx)) { attachedItems.splice(idx, 1); showAttachPreview(); }
    });
  });
}

// Сбрасывает все прикреплённые файлы и очищает превью
function clearAttachedFiles() {
  attachedItems = [];
  document.getElementById('attachPreview')?.remove();
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
}

// Вырезает блоки файлов из текста перед отображением в пузыре.
// Пользователь видит только свой текст - без служебных тегов и инструкций.
function stripFileBlocks(text) {
  if (!text) return '';
  return text
    .replace(/\[Пользователь прикрепил файл[^\[\]]*\]/g, '')
    .replace(/<file[^>]*>[\s\S]*?<\/file>/g, '')
    // Старый формат codeblock (для совместимости со старыми сессиями)
    .split('\n').reduce((acc, line, i, arr) => {
      if (!acc.inBlock && line.match(/^```[\w]*$/) && arr[i+1]?.startsWith('// Файл:')) {
        return { ...acc, inBlock: true };
      }
      if (acc.inBlock && line === '```') return { ...acc, inBlock: false };
      if (!acc.inBlock) acc.lines.push(line);
      return acc;
    }, { lines: [], inBlock: false }).lines.join('\n')
    .replace(/^Проанализируй эти файлы:\s*$/m, '')
    .replace(/^ЗАДАЧА:.*?\nФайл прикреплён ниже[^\n]*\n\n/s, '')
    .replace(/^ЗАДАЧА: Внимательно прочитай файл[^\n]*\n\n/s, '')
    .replace(/^ЗАДАЧА:[^\n]*/m, '')
    .trim();
}

// Очищает историю для отправки в API:
// - убирает system_ui сообщения
// - изображения передаются ТОЛЬКО в последнем сообщении пользователя
//   (в истории они не нужны - экономим токены и не путаем модель)
function sanitizeHistoryForApi(history) {
  const filtered    = history.filter(m => m.role !== 'system_ui');
  const lastUserIdx = filtered.map((m,i) => m.role === 'user' ? i : -1).filter(i => i >= 0).pop();

  return filtered.map((msg, idx) => {
    if (msg.role !== 'user') return msg;
    const isLastUser = idx === lastUserIdx;

    // Строковый контент (текстовые файлы, обычные сообщения)
    if (typeof msg.content === 'string') {
      const stripped = msg.content
        .replace(/<file[^>]*>[\s\S]*?<\/file>/g, '')
        .replace(/\[Пользователь прикрепил файл[^\]]*\]/g, '')
        .replace(/```[\w]*\n\/\/ Файл:[\s\S]*?```/g, '')
        .trim();
      // Если только файловый контент без текста - добавляем явную инструкцию
      if (!stripped && (msg.content.includes('<file ') || msg.content.trim().startsWith('```'))) {
        return { ...msg, content: 'ЗАДАЧА: Внимательно прочитай файл ниже и кратко опиши его содержимое и назначение.\n\n' + msg.content };
      }
      return msg;
    }

    if (!Array.isArray(msg.content)) return msg;

    // Массив контента (изображение + текст)
    const sanitized = msg.content.filter(part => {
      if (part.type === 'image_url') {
        // В старых сообщениях изображения убираем всегда
        if (!isLastUser) return false;
        // В последнем - только валидные base64
        return part.image_url?.url?.startsWith('data:');
      }
      return true;
    });

    const textPart = sanitized.find(p => p.type === 'text');
    const hasImage = sanitized.some(p => p.type === 'image_url');

    if (!hasImage && !textPart) return null;
    if (!hasImage && textPart) {
      const finalText = textPart.text || '';
      return finalText ? { ...msg, content: finalText } : null;
    }
    // Изображение есть, но текст пустой - добавляем дефолтный промпт
    if (hasImage && textPart && !textPart.text) {
      return { ...msg, content: sanitized.map(p => p.type === 'text' ? { ...p, text: 'Опиши что на изображении и помоги с задачей.' } : p) };
    }
    return { ...msg, content: sanitized };
  }).filter(Boolean);
}


// ============================================================
// 8. DRAG & DROP
// ============================================================

function setupDragDrop() {
  const win = document.querySelector('.chat-window');
  win.addEventListener('dragover',  e => { e.preventDefault(); win.classList.add('drag-over'); });
  win.addEventListener('dragleave', e => { if (!win.contains(e.relatedTarget)) win.classList.remove('drag-over'); });
  win.addEventListener('drop', e => {
    e.preventDefault();
    win.classList.remove('drag-over');
    if (e.dataTransfer.files?.length) handleAnyFiles(e.dataTransfer.files);
  });
}


// ============================================================
// 9. ПАНЕЛЬ СЕССИЙ
// ============================================================

function toggleSessionsPanel() {
  const panel = document.getElementById('sessionsPanel');
  const isCollapsed = panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed');
  document.querySelector('.sessions-toggle-btn').classList.toggle('active');

  // На мобильных показываем/скрываем оверлей для закрытия панели тапом по чату
  if (window.matchMedia('(max-width: 480px)').matches) {
    if (isCollapsed) {
      showSessionsOverlay();
    } else {
      hideSessionsOverlay();
    }
  }
}

function closeSessionsPanel() {
  document.getElementById('sessionsPanel').classList.add('collapsed');
  document.querySelector('.sessions-toggle-btn').classList.remove('active');
  hideSessionsOverlay();
}

function showSessionsOverlay() {
  if (document.getElementById('sessionsPanelOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'sessionsPanelOverlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:10;background:transparent;cursor:pointer;';
  overlay.addEventListener('click', () => closeSessionsPanel());
  const chatWindow = document.getElementById('chatWindow');
  if (chatWindow) chatWindow.appendChild(overlay);
}

function hideSessionsOverlay() {
  document.getElementById('sessionsPanelOverlay')?.remove();
}


// ============================================================
// 10. ОТПРАВКА СООБЩЕНИЯ & СТРИМИНГ
// ============================================================

// Останавливает текущую генерацию
function stopGeneration() {
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
}

// Главная функция отправки. Работает в двух режимах:
// - обычный: добавляет новое сообщение в историю и запускает стриминг
// - редактирование: обрезает историю до редактируемого сообщения, затем то же самое
async function sendMessage() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const text    = input.value.trim();

  // Пустое сообщение - запрещено (особая ошибка в режиме редактирования)
  if (!text && attachedItems.length === 0) {
    if (editingMsgIndex !== null) showToast('Сообщение не может быть пустым', 'error');
    return;
  }

  // Режим редактирования: обрезаем историю и DOM до редактируемого сообщения
  if (editingMsgIndex !== null) {
    const cutIdx = editingMsgIndex;
    chatHistory  = chatHistory.slice(0, cutIdx);
    cancelEdit();

    // Удаляем из DOM все сообщения начиная с редактируемого
    const allMsgs = document.getElementById('chatMessages').querySelectorAll('.msg');
    let userCount = 0;
    const targetUserNum = chatHistory.filter(m => m.role === 'user').length;
    let removing = false;
    allMsgs.forEach(el => {
      if (removing) { el.remove(); return; }
      if (el.classList.contains('user')) {
        userCount++;
        if (userCount > targetUserNum) { removing = true; el.remove(); }
      }
    });
  }

  const imageItems = attachedItems.filter(i => i.kind === 'image');
  const fileItems  = attachedItems.filter(i => i.kind === 'file');
  const msgTime    = getTime();
  const hi         = chatHistory.length; // индекс для кнопки «изменить»

  // Показываем сообщение пользователя в DOM (без служебного контента)
  const imgPreviews = imageItems.map(i => i.previewUrl);
  const fileNames   = fileItems.map(i => i.name);
  appendMsg('user', text ? escapeHtml(text) : null, msgTime, {
    imagePreview: imgPreviews.length === 1 ? imgPreviews[0] : (imgPreviews.length > 1 ? imgPreviews : null),
    fileName:     fileNames.length > 0 ? fileNames : null,
    historyIndex: hi
  });

  // Строим контент для API
  // Метаданные вложений сохраняются отдельно - используются для восстановления превью при рендере истории
  const _attachMeta = [
    ...imageItems.map(i => ({ kind: 'image', name: i.name, previewUrl: i.previewUrl })),
    ...fileItems.map(f  => ({ kind: 'file',  name: f.name, size: f.size, ext: f.ext  }))
  ];

  let userContent;

  if (imageItems.length > 0) {
    // Изображение - multipart контент [image_url, text]
    const contentParts = imageItems.map(img => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
    }));
    const fileBlocks = fileItems.map(f => `<file name="${f.name}" type="${f.ext}">\n${f.content}\n</file>`).join('\n\n');
    contentParts.push({ type: 'text', text: [text, fileBlocks].filter(Boolean).join('\n\n') || '' });
    userContent = contentParts;
  } else if (fileItems.length > 0) {
    // Только текстовые файлы - строка с XML-тегами
    const fileBlocks  = fileItems.map(f => `<file name="${f.name}" type="${f.ext}">\n${f.content}\n</file>`).join('\n\n');
    const instruction = text
      ? `ЗАДАЧА: ${text}\nФайл прикреплён ниже — прочитай его содержимое и выполни задачу.`
      : `ЗАДАЧА: Внимательно прочитай файл ниже и кратко опиши его содержимое и назначение.`;
    userContent = `${instruction}\n\n${fileBlocks}`;
  } else {
    userContent = text;
  }

  chatHistory.push({ role: 'user', content: userContent, _time: msgTime, _attachMeta });
  saveCurrentSession();

  // Сбрасываем инпут и блокируем UI на время генерации
  input.value   = '';
  input.style.height = 'auto';
  clearAttachedFiles();
  input.disabled        = true;
  sendBtn.style.display = 'none';
  stopBtn.style.display = 'flex';

  // Захватываем контекст стриминга - колбеки будут использовать эти переменные
  currentAbort       = new AbortController();
  streamingSessionId = currentSession.id;
  const streamDiv    = appendStreamingMsg();
  activeStreamDiv    = streamDiv;
  activeStreamBubble = document.getElementById('streamingBubble');
  activeStreamTime   = document.getElementById('streamingTime');
  activeStreamText   = '';

  // Локальные алиасы для замыкания (не меняются при переключении сессий)
  const streamSessionId   = currentSession.id;
  const streamChatHistory = chatHistory;
  const streamAbort       = currentAbort;
  let   fullText          = '';
  let   firstChunk        = true; // показываем typing-анимацию до первого токена

  try {
    // Пробуем каждый candidate base пока один не ответит успешно
    let res = null, lastError = null;
    for (const base of buildCandidateBases()) {
      try {
        const attempt = await fetch(buildApiUrl(base, '/v1/chat/completions'), {
          method:  'POST',
          headers: getHeaders(),
          signal:  streamAbort.signal,
          body: JSON.stringify({
            model:       DEFAULT_MODEL,
            messages: [
            { role: 'user', content: `[СИСТЕМНЫЕ ИНСТРУКЦИИ — СТРОГО СЛЕДУЙ ИМ]\n\n${SYSTEM_PROMPT}\n\n[КОНЕЦ ИНСТРУКЦИЙ]` },
            { role: 'assistant', content: 'Понял. Буду строго следовать инструкциям.' },
            ...sanitizeHistoryForApi(chatHistory)
            ],
            temperature: 0.7,
            max_tokens:  8192,
            stream:      true
          })
        });
        if (!attempt.ok) { lastError = new Error(`Сервер: ${attempt.status} ${attempt.statusText}`); continue; }
        res = attempt;
        activeBaseUrl = base;
        break;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastError = e;
      }
    }
    if (!res) throw lastError || new Error('Не удалось подключиться');

    // Читаем SSE-стрим (Server-Sent Events)
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
          if (!delta) continue;
          fullText       += delta;
          activeStreamText = fullText;

          // Обновляем DOM только если пользователь сейчас смотрит эту сессию
          if (currentSession?.id === streamSessionId && activeStreamBubble) {
            // Первый реальный токен - убираем typing-анимацию
            if (firstChunk) {
              firstChunk = false;
              activeStreamBubble.innerHTML = '';
            }
            activeStreamBubble.innerHTML = renderMarkdown(fullText);
            if (typeof hljs !== 'undefined')
              activeStreamBubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
            document.getElementById('chatMessages').scrollTop = 999999;
          } else if (firstChunk) {
            firstChunk = false;
          }
        } catch {}
      }
    }

    // Стриминг завершён - сохраняем в историю
    const assistantTime = getTime();
    if (fullText) streamChatHistory.push({ role: 'assistant', content: fullText, _time: assistantTime });

    if (currentSession?.id === streamSessionId) {
      // Сессия активна - финализируем DOM (убираем id стриминга, добавляем кнопки)
      if (activeStreamDiv)    activeStreamDiv.id    = '';
      if (activeStreamBubble) {
        activeStreamBubble.id      = '';
        activeStreamBubble.innerHTML = renderMarkdown(fullText);
      }
      if (activeStreamTime) {
        activeStreamTime.id      = '';
        activeStreamTime.innerHTML = `${assistantTime} <button class="copy-btn" onclick="copyMsg(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> копировать</button>`;
      }
      if (typeof hljs !== 'undefined' && activeStreamBubble)
        activeStreamBubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
      if (activeStreamBubble) addCodeCopyButtons(activeStreamBubble.closest('.msg-body') || activeStreamBubble);
    } else {
      // Сессия в фоне - просто убираем стриминг-div (он там уже не виден)
      activeStreamDiv?.remove();
    }

    saveBgSession(streamSessionId, streamChatHistory);

  } catch (err) {
    const isAbort       = err.name === 'AbortError';
    const isStreamError = !isAbort && err.message && (
      err.message.includes('Error in input stream') ||
      err.message.includes('Failed to fetch') ||
      err.message.includes('NetworkError') ||
      err.message.includes('network')
    );
    const errTime = getTime();

    if (currentSession?.id === streamSessionId) {
      // Ошибка в активной сессии - показываем в DOM
      activeStreamDiv?.remove();

      if (isAbort) {
        // Пользователь нажал «Стоп» - сохраняем уже сгенерированный текст если есть
        if (fullText) {
          streamChatHistory.push({ role: 'assistant', content: fullText, _time: errTime });
          saveBgSession(streamSessionId, streamChatHistory);
          appendMsg('agent', renderMarkdown(fullText), errTime);
        }
      } else {
        const errMsg = isStreamError ? 'SwapCat сейчас не в сети' : `Ошибка: ${escapeHtml(err.message)}`;
        // Сохраняем частичный текст ответа если успел накопиться
        if (fullText) streamChatHistory.push({ role: 'assistant', content: fullText, _time: errTime });
        // Сохраняем сообщение об ошибке всегда
        streamChatHistory.push({ role: 'system_ui', content: errMsg, _time: errTime });
        saveBgSession(streamSessionId, streamChatHistory);
        // Показываем частичный текст отдельным пузырём если есть
        if (fullText) appendMsg('agent', renderMarkdown(fullText), errTime);
        // Показываем ошибку отдельным пузырём
        appendMsg('agent', renderMarkdown(errMsg), errTime);
      }
    } else {
      // Ошибка в фоновой сессии - сохраняем всё включая ошибку
      activeStreamDiv?.remove();
      if (fullText) streamChatHistory.push({ role: 'assistant', content: fullText, _time: errTime });
      const bgErrMsg = isStreamError ? 'SwapCat сейчас не в сети' : `Ошибка: ${escapeHtml(err.message)}`;
      streamChatHistory.push({ role: 'system_ui', content: bgErrMsg, _time: errTime });
      saveBgSession(streamSessionId, streamChatHistory);
    }
  } finally {
    // Разблокируем UI - только если эта сессия сейчас активна
    if (currentSession?.id === streamSessionId) {
      currentAbort = null; streamingSessionId = null;
      activeStreamDiv = null; activeStreamBubble = null; activeStreamTime = null; activeStreamText = '';
      input.disabled        = false;
      sendBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
      input.focus();
    } else {
      // Стриминг завершился пока пользователь был в другой сессии.
      // Если сейчас вернулись на эту сессию - перерендериваем историю чтобы показать ответ.
      // Если нет - просто чистим глобальные ссылки.
      const wasThisSession = streamSessionId;
      if (streamAbort === currentAbort) currentAbort = null;
      streamingSessionId = null;
      activeStreamDiv = null; activeStreamBubble = null; activeStreamTime = null; activeStreamText = '';

      // Если пользователь уже вернулся на эту сессию - рендерим историю
      if (currentSession?.id === wasThisSession) {
        chatHistory = cleanTransientErrors(restoreImagesFromSession(wasThisSession, [...streamChatHistory]));
        renderHistory(chatHistory);
        input.disabled        = false;
        sendBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        input.focus();
      } else {
        // Пользователь в другой сессии - помечаем сессию как "есть новый ответ"
        // и показываем кликабельный тост
        markSessionHasNewReply(wasThisSession);
        showClickableToast('Ответ готов — нажми чтобы перейти', wasThisSession);
      }
    }
  }
}


// ============================================================
// 11. ИНИЦИАЛИЗАЦИЯ
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chatInput');

  // Enter - отправить, Shift+Enter - перенос строки, Escape - отмена редактирования
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape' && editingMsgIndex !== null) cancelEdit();
  });

  chatInput.addEventListener('input', () => autoResizeTextarea(chatInput));

  // Кнопка скрепки - input[type=file]
  document.getElementById('attachBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', e => {
    if (e.target.files?.length) handleAnyFiles(e.target.files);
  });

  // Тень шапки при скролле страницы
  const header = document.querySelector('header');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  setupDragDrop();

  // Восстанавливаем последнюю активную сессию или создаём новую
  const sessions   = getSessions();
  const lastId     = localStorage.getItem('swapcat_last_session');
  const lastSession = lastId ? sessions.find(s => s.id === lastId) : null;

  if (lastSession?.history.length > 0) {
    currentSession = lastSession;
    chatHistory    = cleanTransientErrors(restoreImagesFromSession(lastSession.id, [...lastSession.history]));
    renderSessionList();
    renderHistory(chatHistory);
  } else {
    createNewSession();
    const initTime = getTime();
    const initTxt  = 'Напиши задачу, перетащи изображение или файл.';
    chatHistory.push({ role: 'system_ui', content: initTxt, _time: initTime });
    renderSessionList();
    appendMsg('agent', renderMarkdown(initTxt), initTime);
  }

  // Проверка статуса сети - сразу и каждые 15 сек
  checkNetworkStatus();
  setInterval(checkNetworkStatus, 15000);

  // Обновляем относительное время в панели сессий каждую минуту
  setInterval(renderSessionList, 60000);

  // На мобильных скрываем панель сессий по умолчанию (перекрывает чат)
  if (window.matchMedia('(max-width: 480px)').matches) closeSessionsPanel();

  // Адаптивный placeholder для поля ввода
  const mq = window.matchMedia('(max-width: 640px)');
  const updatePlaceholder = (e) => {
    chatInput.placeholder = e.matches ? 'Опишите проблему...' : 'Опишите проблему, прикрепите скриншот или файл...';
  };
  updatePlaceholder(mq);
  mq.addEventListener('change', updatePlaceholder);
});
