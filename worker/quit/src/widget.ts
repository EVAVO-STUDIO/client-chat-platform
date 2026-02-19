// Embeddable widget served from the Worker.
// - No build step required for client sites (single <script> tag)
// - Uses Shadow DOM to avoid CSS collisions with the host site
// - Supports light/dark (prefers-color-scheme) + manual override via data-theme
// - Mobile-friendly (full-screen drawer below 520px)

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

export function widgetJs(version: string) {
  // Returned as a classic script (not module) so it can be loaded cross-origin without CORS.
  // It auto-inits using <script data-*> attributes.
  const js = `/* client-chat-platform widget v${esc(version)} */
(function(){
  'use strict';

  var CURRENT_SCRIPT = (function(){
    return document.currentScript || (function(){
      var scripts = document.getElementsByTagName('script');
      return scripts[scripts.length-1];
    })();
  })();

  function parseBool(v, d){
    if(v == null || v === '') return d;
    v = String(v).toLowerCase();
    if(v === 'true' || v === '1' || v === 'yes') return true;
    if(v === 'false' || v === '0' || v === 'no') return false;
    return d;
  }

  function pickPosition(pos){
    var p = (pos||'br').toLowerCase();
    if(p==='bl'||p==='tr'||p==='tl'||p==='br') return p;
    return 'br';
  }

  function clamp(n, a, b){ n = Number(n); if(!isFinite(n)) return a; return Math.max(a, Math.min(b, n)); }
  function getData(name){ return CURRENT_SCRIPT && CURRENT_SCRIPT.getAttribute('data-'+name); }

  var options = {
    apiBase: (getData('api-base') || '').trim() || (location.origin),
    botId: (getData('bot-id') || '').trim(),
    title: (getData('title') || '').trim() || '',
    theme: (getData('theme') || 'auto').trim(),
    position: pickPosition(getData('position')),
    brandHex: (getData('brand-hex') || '').trim() || '',
    openByDefault: parseBool(getData('open'), false),
    zIndex: clamp(getData('z'), 2147483000, 9999999999),
    placeholder: (getData('placeholder') || '').trim() || 'Type a message…',
    enableHistory: parseBool(getData('history'), true),
    maxStoredMessages: clamp(getData('max-history'), 5, 100),
    requestTimeoutMs: clamp(getData('timeout-ms'), 5000, 60000)
  };

  if(!options.botId){
    console.warn('[chat-widget] missing data-bot-id on script tag');
    return;
  }

  function nowIso(){ try { return new Date().toISOString(); } catch(_) { return ''; } }

  // ---------- Shadow host ----------
  var host = document.createElement('div');
  host.setAttribute('data-ccp-widget', '1');
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.zIndex = String(options.zIndex);
  host.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';
  host.style.pointerEvents = 'none';

  function applyPos(){
    host.style.top = '';
    host.style.right = '';
    host.style.bottom = '';
    host.style.left = '';
    var gap = '18px';
    if(options.position==='br'){ host.style.right = gap; host.style.bottom = gap; }
    if(options.position==='bl'){ host.style.left  = gap; host.style.bottom = gap; }
    if(options.position==='tr'){ host.style.right = gap; host.style.top    = gap; }
    if(options.position==='tl'){ host.style.left  = gap; host.style.top    = gap; }
  }
  applyPos();

  document.documentElement.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });

  // ---------- Theme ----------
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolveTheme(){
    var t = (options.theme||'auto').toLowerCase();
    if(t==='dark') return 'dark';
    if(t==='light') return 'light';
    return (media && media.matches) ? 'dark' : 'light';
  }
  var theme = resolveTheme();
  var BRAND = options.brandHex || '#00e589';

  // ---------- Storage ----------
  var storageKey = 'ccp_chat_'+encodeURIComponent(options.apiBase)+'_'+encodeURIComponent(options.botId);
  function loadHistory(){
    if(!options.enableHistory) return [];
    try {
      var raw = localStorage.getItem(storageKey);
      if(!raw) return [];
      var data = JSON.parse(raw);
      if(!Array.isArray(data)) return [];
      return data.filter(function(m){ return m && (m.role==='user'||m.role==='assistant') && typeof m.content==='string'; });
    } catch(_) { return []; }
  }
  function saveHistory(arr){
    if(!options.enableHistory) return;
    try { localStorage.setItem(storageKey, JSON.stringify(arr.slice(-options.maxStoredMessages))); } catch(_) {}
  }

  // ---------- DOM ----------
  var style = document.createElement('style');
  style.textContent = `
    :host{ all: initial; }
    .wrap{ pointer-events:none; }
    .btn, .panel{ pointer-events:auto; }
    .btn{
      width:56px;height:56px;border-radius:999px;
      display:flex;align-items:center;justify-content:center;
      border:1px solid rgba(255,255,255,0.12);
      box-shadow: 0 14px 40px rgba(0,0,0,0.22);
      background:${BRAND};
      color:#07110c;
      cursor:pointer;
      transform: translateZ(0);
      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
    }
    .btn:hover{ transform: translateY(-1px); filter: brightness(1.02); box-shadow: 0 18px 48px rgba(0,0,0,0.26); }
    .btn:active{ transform: translateY(0px) scale(.98); }
    .btn:focus{ outline: none; box-shadow: 0 0 0 4px rgba(0,229,137,0.35), 0 14px 40px rgba(0,0,0,0.22); }
    .badge{ position:absolute; right:-2px; top:-2px; width:10px; height:10px; border-radius:999px; background:#ff5f5f; border:2px solid rgba(255,255,255,0.9); display:none; }
    .panel{
      width: 360px; max-width: calc(100vw - 36px);
      height: 520px; max-height: calc(100vh - 110px);
      border-radius: 18px; overflow:hidden;
      box-shadow: 0 26px 70px rgba(0,0,0,0.28);
      border: 1px solid rgba(0,0,0,0.10);
      background: var(--bg); color: var(--fg);
      transform-origin: bottom right;
      transform: translateY(8px) scale(.98);
      opacity:0; pointer-events:none;
      transition: opacity .16s ease, transform .16s ease;
    }
    .panel.open{ opacity:1; transform: translateY(0px) scale(1); pointer-events:auto; }
    .panel-header{
      display:flex; align-items:center; justify-content:space-between;
      padding: 12px 12px 10px 14px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(0,0,0,0.03), rgba(0,0,0,0));
    }
    .title{ display:flex; flex-direction:column; gap:2px; min-width:0; }
    .title strong{ font-size: 13px; letter-spacing: .2px; }
    .title span{ font-size: 12px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .iconbtn{
      width:34px;height:34px;border-radius:10px;
      display:flex;align-items:center;justify-content:center;
      border:1px solid var(--border);
      background: var(--chip);
      cursor:pointer;
      transition: transform .14s ease, filter .14s ease;
    }
    .iconbtn:hover{ transform: translateY(-1px); filter: brightness(1.02); }
    .iconbtn:active{ transform: translateY(0px) scale(.98); }
    .iconbtn:focus{ outline: none; box-shadow: 0 0 0 4px rgba(0,229,137,0.22); }
    .msgs{ height: calc(100% - 110px); overflow:auto; padding: 14px; scroll-behavior:smooth; }
    .row{ display:flex; margin: 10px 0; }
    .row.user{ justify-content:flex-end; }
    .bubble{
      max-width: 84%;
      padding: 10px 12px;
      border-radius: 14px;
      line-height: 1.25;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-wrap:anywhere;
      border:1px solid var(--border);
      background: var(--bubble);
    }
    .row.user .bubble{ background: rgba(0,229,137,0.14); border-color: rgba(0,229,137,0.22); }
    .composer{ padding: 10px 12px; border-top: 1px solid var(--border); background: var(--bg); display:flex; gap: 10px; align-items:flex-end; }
    textarea{
      flex:1; min-height: 40px; max-height: 120px; resize:none;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--chip);
      color: var(--fg);
      padding: 10px 10px;
      font-size: 13px;
      line-height: 1.2;
      outline:none;
    }
    textarea:focus{ box-shadow: 0 0 0 4px rgba(0,229,137,0.18); border-color: rgba(0,229,137,0.35); }
    .send{
      width: 42px; height: 42px;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.12);
      background: ${BRAND};
      color: #07110c;
      cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition: transform .14s ease, filter .14s ease;
    }
    .send:disabled{ opacity:.55; cursor:not-allowed; filter: grayscale(.3); }
    .send:hover{ transform: translateY(-1px); filter: brightness(1.02); }
    .send:active{ transform: translateY(0px) scale(.98); }
    .status{ font-size: 12px; opacity: .75; padding: 8px 14px 0 14px; }
    .dots{ display:inline-flex; gap:4px; vertical-align: middle; margin-left:6px; }
    .dot{ width:5px;height:5px;border-radius:99px; background: currentColor; opacity:.35; animation: ccpDot 1.2s infinite ease-in-out; }
    .dot:nth-child(2){ animation-delay: .15s; }
    .dot:nth-child(3){ animation-delay: .30s; }
    @keyframes ccpDot{ 0%, 80%, 100%{ transform: translateY(0); opacity:.25 } 40%{ transform: translateY(-3px); opacity:.65 } }
    @media (max-width: 520px){
      .panel{ width: calc(100vw - 18px); height: calc(100vh - 18px); max-height: none; border-radius: 16px; }
      .msgs{ height: calc(100% - 118px); }
    }
  `;

  function htmlEscape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  var root = document.createElement('div');
  root.className = 'wrap';
  root.innerHTML = `
    <div class="badge" aria-hidden="true"></div>
    <button class="btn" type="button" aria-label="Open chat">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M7 8h10M7 12h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M20 14.5c0 1.38-1.12 2.5-2.5 2.5H10l-4 3v-3H6.5C5.12 17 4 15.88 4 14.5V7.5C4 6.12 5.12 5 6.5 5h11C18.88 5 20 6.12 20 7.5v7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="panel" role="dialog" aria-modal="true" aria-label="Chat">
      <div class="panel-header">
        <div class="title">
          <strong class="titleText">Chat</strong>
          <span class="subText">Online</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="iconbtn" type="button" aria-label="Restart chat" title="Restart">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M20 4v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="iconbtn" type="button" aria-label="Close chat" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="status" aria-live="polite"></div>
      <div class="msgs" tabindex="0"></div>
      <div class="composer">
        <textarea class="input" rows="1" placeholder="${esc(options.placeholder)}" aria-label="Message"></textarea>
        <button class="send" type="button" aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(root);

  // Theme vars
  function setVars(t){
    var dark = (t==='dark');
    host.style.color = dark ? '#f2f4f7' : '#0b1220';
    host.style.setProperty('--bg', dark ? 'rgba(18, 22, 30, 0.98)' : 'rgba(255, 255, 255, 0.98)');
    host.style.setProperty('--fg', dark ? '#f2f4f7' : '#0b1220');
    host.style.setProperty('--border', dark ? 'rgba(255,255,255,0.10)' : 'rgba(15, 23, 42, 0.10)');
    host.style.setProperty('--chip', dark ? 'rgba(255,255,255,0.06)' : 'rgba(15, 23, 42, 0.04)');
    host.style.setProperty('--bubble', dark ? 'rgba(255,255,255,0.06)' : 'rgba(15, 23, 42, 0.04)');
  }
  setVars(theme);
  if(media && media.addEventListener){
    media.addEventListener('change', function(){
      if((options.theme||'auto').toLowerCase()==='auto'){ theme = resolveTheme(); setVars(theme); }
    });
  }

  // Elements
  var btn = shadow.querySelector('.btn');
  var panel = shadow.querySelector('.panel');
  var closeBtn = shadow.querySelectorAll('.iconbtn')[1];
  var restartBtn = shadow.querySelectorAll('.iconbtn')[0];
  var msgsEl = shadow.querySelector('.msgs');
  var input = shadow.querySelector('.input');
  var send = shadow.querySelector('.send');
  var status = shadow.querySelector('.status');
  var titleText = shadow.querySelector('.titleText');
  var subText = shadow.querySelector('.subText');

  function setStatus(text, busy){
    status.textContent = text || '';
    if(busy){
      var dots = document.createElement('span');
      dots.className = 'dots';
      dots.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      status.appendChild(dots);
    }
  }
  function scrollToBottom(){ try { msgsEl.scrollTop = msgsEl.scrollHeight; } catch(_) {} }

  var messages = loadHistory();
  function push(role, content){
    messages.push({ role: role, content: content, at: nowIso() });
    saveHistory(messages);
    render();
  }
  function render(){
    msgsEl.innerHTML = '';
    for(var i=0;i<messages.length;i++){
      var m = messages[i];
      var row = document.createElement('div');
      row.className = 'row ' + (m.role==='user' ? 'user' : 'assistant');
      var bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = m.content;
      row.appendChild(bubble);
      msgsEl.appendChild(row);
    }
    scrollToBottom();
  }

  // Fetch cfg (for title/greeting)
  var cfg = null;
  var initPromise = null;

  function safeJoin(base, path){
    base = (base||'').replace(/\/+$/,'');
    path = (path||'').replace(/^\/+/, '');
    return base + '/' + path;
  }

  async function init(){
    if(initPromise) return initPromise;
    initPromise = (async function(){
      try {
        setStatus('Loading…', true);
        var res = await fetch(safeJoin(options.apiBase, 'bot/'+encodeURIComponent(options.botId)), { method:'GET' });
        if(res.ok){
          cfg = await res.json();
          var siteName = (cfg && cfg.siteName) ? String(cfg.siteName) : '';
          var t = options.title || siteName || 'Chat';
          titleText.textContent = t;
          subText.textContent = navigator.onLine ? 'Online' : 'Offline';
        }
      } catch(e){
        console.warn('[chat-widget] init failed', e);
      } finally {
        setStatus('', false);
      }
    })();
    return initPromise;
  }

  var open = false;
  function setOpen(v){
    open = !!v;
    if(open){
      panel.classList.add('open');
      btn.setAttribute('aria-label','Close chat');
      setTimeout(function(){ try{ input.focus(); }catch(_){} }, 30);
      init();
      if(messages.length===0){
        var g = (cfg && cfg.greeting) ? String(cfg.greeting) : '';
        if(!g) g = 'Hi — how can I help today?';
        push('assistant', g);
      }
    } else {
      panel.classList.remove('open');
      btn.setAttribute('aria-label','Open chat');
    }
  }

  btn.addEventListener('click', function(){ setOpen(!open); });
  closeBtn.addEventListener('click', function(){ setOpen(false); });
  restartBtn.addEventListener('click', function(){
    if(confirm('Restart chat? This clears the current conversation on this device.')){
      messages = [];
      saveHistory(messages);
      render();
      if(open){ setOpen(false); setOpen(true); }
    }
  });

  window.addEventListener('keydown', function(e){ if(open && e.key === 'Escape'){ setOpen(false); } });

  // Basic focus trap when the panel is open (accessibility)
  window.addEventListener('keydown', function(e){
    if(!open) return;
    if(e.key !== 'Tab') return;
    var focusables = Array.prototype.slice.call(root.querySelectorAll('a,button,input,textarea,select,[tabindex]:not([tabindex="-1"])'))
      .filter(function(el){ return !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'; });
    if(!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = root.activeElement || document.activeElement;
    if(e.shiftKey){
      if(active === first){ e.preventDefault(); last.focus(); }
    } else {
      if(active === last){ e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('online', function(){ subText.textContent = 'Online'; });
  window.addEventListener('offline', function(){ subText.textContent = 'Offline'; });

  function autosize(){ input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  input.addEventListener('input', autosize);
  autosize();
  function trim(s){ return String(s||'').replace(/^\s+|\s+$/g,''); }

  async function sendMessage(){
    var text = trim(input.value);
    if(!text) return;
    input.value = '';
    autosize();
    push('user', text);

    var payload = {
      botId: options.botId,
      messages: messages.filter(function(m){ return m && (m.role==='user'||m.role==='assistant'); }).map(function(m){ return { role: m.role, content: m.content }; })
    };

    send.disabled = true;
    input.disabled = true;
    setStatus('Thinking', true);

    var ctl = new AbortController();
    var to = setTimeout(function(){ try{ ctl.abort(); }catch(_){} }, options.requestTimeoutMs);
    try {
      var res = await fetch(safeJoin(options.apiBase, 'api/chat'), {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
        signal: ctl.signal
      });
      var data = null;
      try { data = await res.json(); } catch(_) {}
      if(!res.ok || !data || data.ok !== true){
        var msg = (data && (data.message||data.error)) ? String(data.message||data.error) : ('Request failed ('+res.status+')');
        push('assistant', 'Sorry — I had trouble responding. ' + msg);
      } else {
        push('assistant', String(data.message||''));
      }
    } catch(e){
      var aborted = (e && (e.name==='AbortError'));
      push('assistant', aborted ? 'Sorry — that took too long. Please try again.' : 'Sorry — I couldn\'t reach the server. Please try again.');
    } finally {
      clearTimeout(to);
      setStatus('', false);
      send.disabled = false;
      input.disabled = false;
      try{ input.focus(); }catch(_){}
    }
  }

  send.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }
  });

  render();
  if(options.openByDefault){ setOpen(true); }
})();
`;
  return js;
}
