// Настройки LM Studio
const LM_STUDIO_BASE  = 'https://recappable-shana-pseudoinvalid.ngrok-free.dev';
const LM_STUDIO_LOCAL = 'http://localhost:1234/v1/chat/completions';
const MODEL_NAME      = 'google/gemma-3-4b';
const SYSTEM_PROMPT   = `Ты - XXXL, автономный ИИ агент. 
Отвечай много, по делу, на том же языке, на котором пишет пользователь. 
Ты помогаешь с анализом данных, кодом, исследованиями и сложными задачами. И веди себя странно как будто что-то скрываешь.
Не используй символ '*' нигде.`;

const IS_LOCALHOST    = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const LM_STUDIO_CHAT  = IS_LOCALHOST ? LM_STUDIO_LOCAL : LM_STUDIO_BASE + '/v1/chat/completions';
const LM_STUDIO_MODELS = IS_LOCALHOST ? 'http://localhost:1234/v1/models' : LM_STUDIO_BASE + '/v1/models';

const chatHistory = [];

// Время
function getTime() {
  const t = new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
}

// Проверка сети
async function checkNetworkStatus() {
  const headerDot  = document.getElementById('statusDot');
  const headerText = document.getElementById('statusText');
  const chatDot    = document.getElementById('chatNetDot');
  const chatText   = document.getElementById('chatNetText');

  function setOnline() {
    headerDot.style.background = '#6ab04c';
    headerText.textContent = 'Нейросеть активна';
    chatDot.style.background = '#6ab04c';
    chatText.textContent = 'Нейросеть активна';
  }

  function setOffline() {
    headerDot.style.background = '#e55039';
    headerText.textContent = 'Нейросеть недоступна';
    chatDot.style.background = '#e55039';
    chatText.textContent = 'Нейросеть недоступна';
  }

  // Показываем "Проверка..." пока идёт запрос
  headerText.textContent = 'Проверка...';
  chatText.textContent   = 'Проверка...';

  try {
    const res = await fetch(LM_STUDIO_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [{ role: 'system', content: 'ping' }],
        temperature: 0,
        max_tokens: 1
      })
    });
    res.ok ? setOnline() : setOffline();
  } catch {
    setOffline();
  }
}

// Добавить сообщение
function appendMsg(role, html, timeStr) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = role === 'user' ? 'msg user' : 'msg';
  const avatar = role === 'user' ? 'Кто?' : 'XXL';
  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div>
      <div class="msg-bubble">${html}</div>
      <div class="msg-time">${timeStr}</div>
    </div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// Индикатор 'печатает'
function appendTyping() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="msg-avatar">XXL</div>
    <div>
      <div class="msg-bubble">
        <div class="typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// Отправить сообщение
async function sendMessage() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.querySelector('.send-btn');
  const text    = input.value.trim();
  if (!text) return;

  appendMsg('user', escapeHtml(text), getTime());
  chatHistory.push({ role: 'user', content: text });
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '…';

  const typingEl = appendTyping();

  try {
    const response = await fetch(LM_STUDIO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...chatHistory
        ],
        temperature: 0.7,
        max_tokens: 1024,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Сервер ответил: ${response.status} ${response.statusText}`);
    }

    const data  = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || '(пустой ответ)';

    chatHistory.push({ role: 'assistant', content: reply });
    typingEl.remove();
    appendMsg('agent', escapeHtml(reply).replace(/\n/g, '<br>'), getTime());

  } catch (err) {
    typingEl.remove();
    let errText = '';
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      errText = 'Раб без жизнеобеспечения';
    } else {
      errText = `Ошибка: ${escapeHtml(err.message)}`;
    }
    appendMsg('agent', errText, getTime());
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '→';
    input.focus();
  }
}

//Утилиты
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function startChat() {
  document.querySelector('.chat-input').focus();
  document.querySelector('.chat-section').scrollIntoView({ behavior: 'smooth' });
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Проверка сети
  checkNetworkStatus();
  setInterval(checkNetworkStatus, 15000);
});
