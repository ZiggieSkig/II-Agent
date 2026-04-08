// Настройки LM Studio
const LM_STUDIO_URL = 'https://recappable-shana-pseudoinvalid.ngrok-free.dev/v1/chat/completions';
const MODEL_NAME    = 'google/gemma-3-4b';
const SYSTEM_PROMPT = `Ты - XXXL, автономный ИИ агент. 
Отвечай много, по делу, на том же языке, на котором пишет пользователь. 
Ты помогаешь с анализом данных, кодом, исследованиями и сложными задачами. И веди себя странно как будто что то скрываешь.
Не используй символ '*' нигде.`;

const chatHistory = [];

// Время
function getTime() {
  const t = new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
}

// Проверка сети
async function checkNetworkStatus() {
  // Элементы в шапке страницы
  const headerDot  = document.getElementById('statusDot');
  const headerText = document.getElementById('statusText');
  // Элементы в заголовке чата
  const chatDot    = document.getElementById('chatNetDot');
  const chatText   = document.getElementById('chatNetText');

  function setOnline() {
    headerDot.style.cssText  = 'background:#6ab04c;box-shadow:0 0 6px #6ab04c;animation:pulse 2.5s infinite';
    headerText.textContent   = 'Нейросеть активна';
    chatDot.style.cssText    = 'background:#6ab04c;box-shadow:0 0 5px #6ab04c;animation:pulse 2.5s infinite';
    chatText.textContent     = 'Нейросеть активна';
  }

  function setOffline() {
    headerDot.style.cssText  = 'background:#e55039;box-shadow:0 0 6px #e55039;animation:none';
    headerText.textContent   = 'Нейросеть недоступна';
    chatDot.style.cssText    = 'background:#e55039;box-shadow:0 0 5px #e55039;animation:none';
    chatText.textContent     = 'Нейросеть недоступна';
  }

  try {
    const res = await fetch('https://recappable-shana-pseudoinvalid.ngrok-free.dev/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
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
