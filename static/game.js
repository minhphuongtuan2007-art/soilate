/**
 * Soilate - Client Game Controller & Web Audio Synthesizer
 */

// Global State
let socket = null;
let gameState = null;
let audioEnabled = true;
let audioCtx = null;

let selectedCards = new Set(); // set of card_id
let faceUpMap = {};            // card_id -> boolean

// Pending tool action state
let pendingTool = null; // { tool_id, step: 'pick_card' | 'pick_suit' | 'pick_target' }

// Card Rank Constants
const RANK_LABELS = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 99: 'Joker'
};

const SUIT_ICONS = {
  'S': '♠',
  'C': '♣',
  'D': '♦',
  'H': '♥',
  'X': '⭐',
  'M': '🌙',
  'K': '👑',
  'L': '⚡',
  'W': '🃏',
  'SPEC': '✨'
};

const SUIT_NAMES = {
  'S': 'Bích ♠',
  'C': 'Chuồn ♣',
  'D': 'Rô ♦',
  'H': 'Cơ ♥',
  'X': 'Sao ⭐',
  'M': 'Trăng 🌙',
  'K': 'Vương miện 👑',
  'L': 'Tia sét ⚡',
  'W': 'Joker 🃏',
  'SPEC': 'Đặc biệt ✨'
};

/* ==========================================================================
   1. SOUND SYNTHESIZER (Web Audio API - No external assets required)
   ========================================================================== */
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
}

function playSound(type) {
  if (!audioEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  try {
    if (type === 'click') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.05);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.05);

    } else if (type === 'card_play') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);

    } else if (type === 'call_slam') {
      // Dramatic bass hit + brass
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.45);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.45);

    } else if (type === 'bluff_caught') {
      // Buzzer
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.setValueAtTime(120, now + 0.15);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.35);

    } else if (type === 'victory') {
      // Ascending fanfare
      [330, 440, 554, 659].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.25, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.25);
      });

    } else if (type === 'turn_alert') {
      // Gentle reminder ping
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.1); // A5
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.3);

    } else if (type === 'tool_power') {
      // Sci-fi powerup sweep
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.25);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {
    console.warn("Audio play error", e);
  }
}

/* ==========================================================================
   2. WEBSOCKET NETWORK LAYER
   ========================================================================== */
let savedPlayerName = 'Cao Thủ';
let savedRoomId = 'DEFAULT';
let isReconnecting = false;

function getWebSocketUrl() {
  const customInput = document.getElementById('input-server-url');
  const customVal = customInput ? customInput.value.trim() : '';

  // 1. If user typed in custom URL
  if (customVal) {
    localStorage.setItem('soilate_server_url', customVal);
    let u = customVal;
    if (!u.startsWith('ws://') && !u.startsWith('wss://')) {
      u = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + u;
    }
    return u;
  }

  // 2. If stored in URL query string (?server=wss://...)
  const params = new URLSearchParams(window.location.search);
  const qServer = params.get('server');
  if (qServer) {
    localStorage.setItem('soilate_server_url', qServer);
    return qServer;
  }

  // 3. If stored in localStorage
  const stored = localStorage.getItem('soilate_server_url');
  if (stored) {
    if (customInput) customInput.value = stored;
    return stored;
  }

  // 4. Default automatic resolution
  const isHttps = (window.location.protocol === 'https:');
  const proto = isHttps ? 'wss:' : 'ws:';
  const hostname = window.location.hostname || 'localhost';

  // If local development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `ws://${hostname}:8765`;
  }

  // If deployed on Render / Railway / Koyeb on standard port 443 / 80
  return `${proto}//${window.location.host}/ws`;
}

function connectWebSocket(playerName, roomId) {
  if (playerName) savedPlayerName = playerName;
  if (roomId) savedRoomId = roomId;

  initAudio();
  const wsUrl = getWebSocketUrl();
  console.log("Connecting to WebSocket:", wsUrl);

  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("Connected to Soilate Server.");
    isReconnecting = false;
    socket.send(JSON.stringify({
      action: 'JOIN_ROOM',
      payload: { player_name: savedPlayerName, room_id: savedRoomId }
    }));
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'STATE_UPDATE') {
        const prevState = gameState;
        gameState = msg.data;
        renderGameState(prevState);
      } else if (msg.type === 'ERROR') {
        alert("⚠️ Thông báo: " + msg.message);
      }
    } catch (e) {
      console.error("Error processing msg", e);
    }
  };

  socket.onclose = () => {
    console.log("WebSocket connection closed. Auto-reconnecting in 1.5s...");
    if (!isReconnecting) {
      isReconnecting = true;
      setTimeout(() => {
        connectWebSocket(savedPlayerName, savedRoomId);
      }, 1500);
    }
  };

  socket.onerror = (err) => {
    console.warn("WebSocket error:", err);
  };
}

function sendAction(action, payload = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("Socket not open. Reconnecting...");
    connectWebSocket(savedPlayerName, savedRoomId);
    setTimeout(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action, payload }));
      } else {
        alert("Đang kết nối lại tới máy chủ, vui lòng thử lại sau 1 giây!");
      }
    }, 500);
    return;
  }
  socket.send(JSON.stringify({ action, payload }));
}

function switchView(targetViewId) {
  const views = ['view-lobby', 'view-room-waiting', 'view-game'];
  views.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === targetViewId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

/* ==========================================================================
   3. RENDERING & UI UPDATES
   ========================================================================== */
function renderGameState(prevState) {
  if (!gameState) return;

  // Header room code
  const roomBadge = document.getElementById('room-badge');
  const displayRoomId = document.getElementById('display-room-id');
  roomBadge.classList.remove('hidden');
  displayRoomId.textContent = gameState.room_id;

  // View Switching
  if (gameState.state === 'LOBBY') {
    switchView('view-room-waiting');
    renderWaitingRoom();
    return;
  } else {
    switchView('view-game');
  }

  // Audio cues on state changes
  if (prevState) {
    // If turn changed to you
    if (!prevState.is_your_turn && gameState.is_your_turn) {
      playSound('turn_alert');
    }
    // If call just resolved
    if (!prevState.call_history && gameState.call_history) {
      playSound('call_slam');
      if (gameState.call_history.was_bluff) {
        setTimeout(() => playSound('bluff_caught'), 300);
      }
    }
    // If cards count reduced
    if (prevState.your_hand.length > gameState.your_hand.length) {
      playSound('card_play');
    }
  }

  renderOpponents();
  renderCenterTable();
  renderLogs();
  renderTools();
  renderPlayerHand();
  renderActionControls();
  checkModals();
}

function renderWaitingRoom() {
  const container = document.getElementById('waiting-players-list');
  container.innerHTML = '';

  const title = document.getElementById('waiting-room-title');
  title.textContent = `Phòng Chờ: ${gameState.room_name} (${gameState.players.length} người)`;

  gameState.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'waiting-player-item' + (p.id === gameState.your_id ? ' is-you' : '');
    div.innerHTML = `
      <div class="player-avatar-badge">${p.is_bot ? '🤖' : '👤'}</div>
      <div class="waiting-player-name">${escapeHtml(p.name)}</div>
      ${p.is_host ? '<span class="host-badge">Chủ phòng</span>' : ''}
    `;
    container.appendChild(div);
  });

  const isHost = gameState.is_host;
  const humanCount = gameState.players.filter(p => !p.is_bot).length;
  const canControl = isHost || (humanCount <= 1);

  const btnStart = document.getElementById('btn-start-game');
  btnStart.style.display = canControl ? 'inline-block' : 'none';
  btnStart.disabled = gameState.players.length < 2;

  const btnClaimHost = document.getElementById('btn-claim-host');
  if (btnClaimHost) {
    btnClaimHost.style.display = (!isHost && humanCount > 1) ? 'inline-block' : 'none';
  }

  const btnRemoveBot = document.getElementById('btn-remove-bot');
  if (btnRemoveBot) {
    const hasBots = gameState.players.some(p => p.is_bot);
    btnRemoveBot.style.display = hasBots ? 'inline-block' : 'none';
  }
}

function renderOpponents() {
  const container = document.getElementById('opponents-container');
  container.innerHTML = '';

  const others = gameState.players.filter(p => p.id !== gameState.your_id);
  others.forEach(p => {
    const div = document.createElement('div');
    const isTurn = (p.id === gameState.current_turn_id);
    const isFinished = (p.finished_rank !== null);

    div.className = 'opponent-card' + (isTurn ? ' turn-active' : '') + (isFinished ? ' finished' : '');
    
    let statusText = isTurn ? '⚡ Đang suy nghĩ...' : 'Đang chờ';
    if (isFinished) statusText = `🏆 Về đích #${p.finished_rank}`;
    else if (p.disabled_tools) statusText = '🚫 Đã bị khóa Tool';
    else if (p.tool_used) statusText = '🛠️ Đã dùng Tool';

    div.innerHTML = `
      <div class="opp-header">
        <span class="opp-name">${p.is_bot ? '🤖' : '👤'} ${escapeHtml(p.name)}</span>
        <span class="opp-card-count">🃏 ${p.card_count} lá</span>
      </div>
      <div class="opp-status">${statusText}</div>
    `;
    container.appendChild(div);
  });
}

function renderCenterTable() {
  const claimText = document.getElementById('current-claim-text');
  const claimAuthor = document.getElementById('current-claim-author');
  const deckCount = document.getElementById('deck-remaining-count');
  const discardCount = document.getElementById('discard-count');
  const cardsZone = document.getElementById('table-cards-container');
  const turnIndicator = document.getElementById('turn-player-name');
  const callBanner = document.getElementById('call-result-banner');
  const callContent = document.getElementById('call-banner-content');

  deckCount.textContent = gameState.deck_count;
  discardCount.textContent = gameState.discard_count;
  turnIndicator.textContent = gameState.is_your_turn ? 'BẠN (Đến lượt đánh)' : gameState.current_turn_name;

  if (gameState.table_claim_desc) {
    claimText.textContent = gameState.table_claim_desc;
    claimAuthor.textContent = `Đánh bởi: ${gameState.last_player_name || 'Đối thủ'}`;
  } else {
    claimText.textContent = "Bàn chơi đang trống - Hãy đánh mở màn!";
    claimAuthor.textContent = "";
  }

  // Render Table Cards
  cardsZone.innerHTML = '';
  if (!gameState.table_cards || gameState.table_cards.length === 0) {
    cardsZone.innerHTML = '<div class="empty-table-hint">Chưa có lá bài nào trên bàn</div>';
  } else {
    gameState.table_cards.forEach(card => {
      const cardEl = createCardElement(card, false);
      cardsZone.appendChild(cardEl);
    });
  }

  // Call banner
  if (gameState.call_history) {
    callBanner.classList.remove('hidden');
    const ch = gameState.call_history;
    callContent.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3 style="color:${ch.was_bluff ? '#ef4444' : '#10b981'}; font-size:18px;">
          ${ch.was_bluff ? '💥 BẮT BÀI ĐÚNG! NÓI DỐI BỊ PHÁT HIỆN!' : '🛡️ CALL SAI! ĐÁNH THẬT 100%!'}
        </h3>
        <button class="btn-close" onclick="document.getElementById('call-result-banner').classList.add('hidden')" style="font-size:16px; margin-left:12px;">✕</button>
      </div>
      <p style="font-size:13px; color:#cbd5e1;">
        <b>${escapeHtml(ch.caller_name)}</b> đã CALL bắt bài <b>${escapeHtml(ch.accused_name)}</b>!
      </p>
      <p style="font-size:13px; color:#fbbf24; margin-top:4px;">
        👉 Người thắng <b>${escapeHtml(ch.winner_name)}</b> được quyền chọn 1 lá bài trên tay tống cho <b>${escapeHtml(ch.loser_name)}</b>!
      </p>
    `;
    if (window.callBannerTimer) clearTimeout(window.callBannerTimer);
    window.callBannerTimer = setTimeout(() => {
      callBanner.classList.add('hidden');
    }, 4500);
  } else {
    callBanner.classList.add('hidden');
  }
}

function renderLogs() {
  const container = document.getElementById('game-logs-list');
  container.innerHTML = '';
  if (gameState.logs) {
    gameState.logs.forEach(log => {
      const item = document.createElement('div');
      item.className = 'log-item';
      item.textContent = log;
      container.appendChild(item);
    });
    container.scrollTop = container.scrollHeight;
  }
}

function renderTools() {
  const badge = document.getElementById('tool-status-badge');
  const toolBtns = document.querySelectorAll('.tool-btn');
  const nameEl = document.getElementById('assigned-tool-name');
  const iconEl = document.getElementById('assigned-tool-icon');
  const descEl = document.getElementById('assigned-tool-desc');
  const timingEl = document.getElementById('assigned-tool-timing');
  const activateBtn = document.getElementById('btn-activate-assigned-tool');

  if (!gameState) return;

  if (gameState.your_tools_disabled) {
    badge.textContent = "Đã bị vô hiệu hoá!";
    badge.className = "badge-used";
  } else if (gameState.your_tool_used) {
    badge.textContent = "Đã dùng vòng này";
    badge.className = "badge-used";
  } else {
    badge.textContent = "Sẵn sàng (1 lần)";
    badge.className = "badge-ready";
  }

  const assignedToolKey = gameState.your_assigned_tool;
  const toolInfo = gameState.assigned_tool_info;

  if (toolInfo && assignedToolKey) {
    if (nameEl) nameEl.textContent = toolInfo.name;
    if (iconEl) iconEl.textContent = toolInfo.icon || '🛠️';
    if (descEl) descEl.textContent = toolInfo.desc;
    if (timingEl) {
      if (toolInfo.timing === 'own_turn') {
        timingEl.textContent = 'Trong lượt mình';
        timingEl.className = 'assigned-tool-timing-badge timing-turn';
      } else {
        timingEl.textContent = 'Bất kì lúc nào';
        timingEl.className = 'assigned-tool-timing-badge timing-anytime';
      }
    }

    const isAvailable = (!gameState.your_tools_disabled && !gameState.your_tool_used && gameState.state === 'PLAYING');
    let canTrigger = false;
    if (isAvailable) {
      if (toolInfo.timing === 'own_turn') {
        canTrigger = (gameState.is_your_turn === true);
      } else {
        canTrigger = true;
      }
    }

    if (activateBtn) {
      activateBtn.disabled = !canTrigger;
      if (gameState.your_tool_used) {
        activateBtn.textContent = 'ĐÃ DÙNG VÒNG NÀY';
      } else if (gameState.your_tools_disabled) {
        activateBtn.textContent = 'BỊ VÔ HIỆU HÓA';
      } else if (canTrigger) {
        activateBtn.textContent = '⚡ KÍCH HOẠT CÔNG CỤ';
      } else {
        activateBtn.textContent = (toolInfo.timing === 'own_turn') ? '⏳ ĐỢI ĐẾN LƯỢT ĐÁNH' : '⚡ KÍCH HOẠT CÔNG CỤ';
      }
    }
  } else {
    if (nameEl) nameEl.textContent = "Chưa phân phát";
    if (descEl) descEl.textContent = "Công cụ sẽ được cấp ngẫu nhiên khi ván đấu bắt đầu.";
    if (timingEl) timingEl.textContent = "";
    if (activateBtn) {
      activateBtn.disabled = true;
      activateBtn.textContent = "⚡ KÍCH HOẠT CÔNG CỤ";
    }
  }

  // Update 7 tool buttons in the rack
  toolBtns.forEach(btn => {
    const toolId = btn.getAttribute('data-tool');
    const isAssigned = (toolId === assignedToolKey);

    if (isAssigned) {
      btn.classList.add('assigned-tool-active');
      btn.classList.remove('tool-locked');

      const isAvailable = (!gameState.your_tools_disabled && !gameState.your_tool_used && gameState.state === 'PLAYING');
      let canTrigger = false;
      if (isAvailable) {
        const tInfo = toolInfo || {};
        if (tInfo.timing === 'own_turn') {
          canTrigger = (gameState.is_your_turn === true);
        } else {
          canTrigger = true;
        }
      }
      btn.disabled = !canTrigger;
      btn.title = `${toolInfo?.name || toolId} (Công cụ của bạn vòng này)`;
    } else {
      btn.classList.remove('assigned-tool-active');
      btn.classList.add('tool-locked');
      btn.disabled = true;
      btn.title = `Chưa nhận công cụ này trong vòng đấu hiện tại`;
    }
  });
}

function renderPlayerHand() {
  const container = document.getElementById('my-hand-container');
  const countEl = document.getElementById('my-card-count');
  container.innerHTML = '';

  const hand = gameState.your_hand || [];
  countEl.textContent = hand.length;

  hand.forEach(card => {
    const isSelected = selectedCards.has(card.id);
    const isFaceUp = (faceUpMap[card.id] !== false); // default true

    const cardEl = createCardElement(card, true, isSelected, isFaceUp);

    cardEl.addEventListener('click', (e) => {
      handleCardClick(card.id, e);
    });

    container.appendChild(cardEl);
  });

  updateSelectionSummary();
}

function createCardElement(card, isInteractive = false, isSelected = false, isFaceUp = true) {
  const div = document.createElement('div');
  
  // Card back (hidden)
  if (!card.face_up && card.is_hidden) {
    div.className = 'game-card card-back';
    div.innerHTML = `
      <div class="card-back-pattern">
        <span class="card-back-icon">❓</span>
        <span class="card-back-label">SOILATE</span>
      </div>
    `;
    return div;
  }

  // Special Mystery Card (Skip, Attack, Open All, Chaos, Winner)
  if (card.is_special) {
    div.className = 'game-card special-card';
    div.setAttribute('data-suit', 'SPEC');

    let activateBtnHtml = '';
    const isMyTurn = (gameState && gameState.is_your_turn && gameState.state === 'PLAYING');
    if (isInteractive) {
      activateBtnHtml = `
        <button class="btn-activate-special" ${isMyTurn ? '' : 'disabled'} title="${isMyTurn ? 'Kích hoạt ngay trong lượt của bạn' : 'Chỉ kích hoạt được trong lượt của bạn'}">
          ⚡ KÍCH HOẠT
        </button>
      `;
    }

    const iconMap = {
      'SKIP': '⏭️',
      'ATTACK': '⚔️',
      'OPEN_ALL': '👁️‍🗨️',
      'CHAOS': '🌀',
      'WINNER': '👑'
    };
    const sIcon = iconMap[card.special_type] || '✨';

    div.innerHTML = `
      <div class="special-card-badge">ĐẶC BIỆT</div>
      <div class="card-corner">
        <span class="card-rank">✨</span>
      </div>
      <div class="special-card-body">
        <div class="special-card-icon">${sIcon}</div>
        <div class="special-card-name">${escapeHtml(card.special_name || 'Lá Bí Ẩn')}</div>
        <div class="special-card-desc">${escapeHtml(card.special_desc || '')}</div>
      </div>
      ${activateBtnHtml}
    `;

    if (isInteractive) {
      const actBtn = div.querySelector('.btn-activate-special');
      if (actBtn) {
        actBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!isMyTurn) {
            alert("Chỉ được kích hoạt lá bài đặc biệt trong lượt của bạn!");
            return;
          }
          playSound('call_slam');
          sendAction('PLAY_SPECIAL_CARD', { card_id: card.id });
        });
      }
    }
    return div;
  }

  div.className = 'game-card';
  div.setAttribute('data-suit', card.suit);

  if (isSelected) {
    div.classList.add('selected');
  }

  const icon = SUIT_ICONS[card.suit] || card.suit;
  const rankStr = card.is_wildcard ? '★' : (RANK_LABELS[card.rank] || card.rank);
  const alteredBadge = card.altered_suit ? `<span class="suit-badge-altered">Đã đổi chất: ${SUIT_ICONS[card.altered_suit]}</span>` : '';

  let flipBtnHtml = '';
  if (isSelected && isInteractive) {
    flipBtnHtml = `
      <button class="card-flip-badge ${isFaceUp ? 'flip-up' : 'flip-down'}" title="Nhấn để đổi Úp ↔ Ngửa">
        ${isFaceUp ? '👁️ NGỬA' : '🔒 ÚP'}
      </button>
    `;
  }

  div.innerHTML = `
    ${flipBtnHtml}
    <div class="card-corner">
      <span class="card-rank">${rankStr}</span>
      <span class="card-suit">${icon}</span>
    </div>
    <div class="card-center">${icon}</div>
    <div class="card-corner card-corner-bottom">
      <span class="card-rank">${rankStr}</span>
      <span class="card-suit">${icon}</span>
    </div>
    ${alteredBadge}
  `;

  if (isSelected && isInteractive) {
    const flipBtn = div.querySelector('.card-flip-badge');
    if (flipBtn) {
      flipBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent card deselection!
        playSound('click');
        faceUpMap[card.id] = !faceUpMap[card.id];
        ensureAtLeastOneFaceUp();
        renderPlayerHand();
        renderActionControls();
      });
    }
  }

  return div;
}

function handleCardClick(cardId, e) {
  playSound('click');

  // Prevent special cards from being selected into normal combo hand
  const targetCard = (gameState && gameState.your_hand) ? gameState.your_hand.find(c => c.id === cardId) : null;
  if (targetCard && targetCard.is_special) {
    return;
  }

  // If in tool selection mode (e.g. SWAP_RANDOM or CHANGE_SUIT)
  if (pendingTool) {
    if (pendingTool.tool_id === 'SWAP_RANDOM') {
      sendAction('USE_TOOL', { tool_id: 'SWAP_RANDOM', card_id: cardId });
      pendingTool = null;
      return;
    } else if (pendingTool.tool_id === 'CHANGE_SUIT') {
      pendingTool.card_id = cardId;
      openModal('modal-pick-suit');
      return;
    }
  }

  // Normal Play Selection: TOGGLE SELECT / DESELECT (RÚT BÀI VỀ)
  if (selectedCards.has(cardId)) {
    // Deselect
    selectedCards.delete(cardId);
    delete faceUpMap[cardId];
    ensureAtLeastOneFaceUp();
  } else {
    // Select
    selectedCards.add(cardId);
    if (!(cardId in faceUpMap)) {
      faceUpMap[cardId] = (selectedCards.size === 1) ? true : false;
    }
    ensureAtLeastOneFaceUp();
  }

  renderPlayerHand();
  renderActionControls();
}

function ensureAtLeastOneFaceUp() {
  const anyFaceUp = Array.from(selectedCards).some(cid => faceUpMap[cid] !== false);
  if (!anyFaceUp && selectedCards.size > 0) {
    const firstId = Array.from(selectedCards)[0];
    faceUpMap[firstId] = true;
  }
}

function updateSelectionSummary() {
  const text = document.getElementById('selection-summary-text');
  const clearBtn = document.getElementById('btn-clear-selection');
  const selCount = selectedCards.size;

  if (selCount === 0) {
    text.textContent = "Click vào lá bài để chọn đưa lên. Click lần nữa để rút bài về.";
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  const upCount = Array.from(selectedCards).filter(cid => faceUpMap[cid] !== false).length;
  const downCount = selCount - upCount;
  text.textContent = `Đã chọn: ${selCount} lá (${upCount} lá Ngửa, ${downCount} lá Úp) ${upCount >= 1 ? '✅' : '❌ Cần ít nhất 1 ngửa'}`;

  if (clearBtn) clearBtn.style.display = 'inline-block';
}

function renderActionControls() {
  const btnPlay = document.getElementById('btn-play-hand');
  const btnCall = document.getElementById('btn-call');
  const btnPass = document.getElementById('btn-pass');

  const isMyTurn = gameState.is_your_turn && gameState.state === 'PLAYING';
  const hasTablePlay = (gameState.table_claim !== null);

  // Call button is active when opponent has cards on the table
  btnCall.disabled = !(isMyTurn && hasTablePlay);

  // Pass button is active when opponent has cards on the table
  btnPass.disabled = !(isMyTurn && hasTablePlay);

  // Play button is active when my turn and valid card selection
  const selCount = selectedCards.size;
  const upCount = Array.from(selectedCards).filter(cid => faceUpMap[cid] !== false).length;
  const isValidCount = (selCount >= 2 && selCount <= 5 && upCount >= 1);

  btnPlay.disabled = !(isMyTurn && isValidCount);
}

function checkModals() {
  // 1. Penalty Modal
  const penaltyModal = document.getElementById('modal-penalty');
  if (gameState.state === 'CALL_RESOLVING' && gameState.pending_penalty) {
    if (gameState.pending_penalty.winner_id === gameState.your_id) {
      penaltyModal.classList.remove('hidden');
      renderPenaltyPicker();
    } else {
      penaltyModal.classList.add('hidden');
    }
  } else {
    penaltyModal.classList.add('hidden');
  }

  // 2. Peek Modal
  if (gameState.peek_card) {
    const peekModal = document.getElementById('modal-peek-result');
    const peekRender = document.getElementById('peek-card-render');
    peekRender.innerHTML = '';
    peekRender.appendChild(createCardElement(gameState.peek_card, false));
    peekModal.classList.remove('hidden');
  }
}

function renderPenaltyPicker() {
  const container = document.getElementById('penalty-hand-picker');
  const desc = document.getElementById('penalty-modal-desc');
  container.innerHTML = '';

  const loserName = gameState.pending_penalty ? gameState.pending_penalty.loser_name : 'đối thủ';
  desc.innerHTML = `Hãy chọn 1 lá bài bất kỳ trên tay bạn để <b>tống sang cho ${escapeHtml(loserName)}</b>:`;

  gameState.your_hand.forEach(card => {
    const cardEl = createCardElement(card, false);
    cardEl.style.cursor = 'pointer';
    cardEl.addEventListener('click', () => {
      playSound('card_play');
      sendAction('SELECT_PENALTY_CARD', { card_id: card.id });
      closeModal('modal-penalty');
    });
    container.appendChild(cardEl);
  });
}

/* ==========================================================================
   4. CLAIM FORM CONTROLS & DYNAMIC INPUTS
   ========================================================================== */
function setupClaimForm() {
  const selectType = document.getElementById('select-hand-type');
  const subContainer = document.getElementById('claim-sub-inputs');

  function updateSubInputs() {
    const type = selectType.value;
    subContainer.innerHTML = '';

    if (['pair', 'three', 'four', 'five'].includes(type)) {
      const selectRank = document.createElement('select');
      selectRank.id = 'claim-rank';
      selectRank.className = 'game-select';
      for (let r = 2; r <= 14; r++) {
        selectRank.innerHTML += `<option value="${r}">${RANK_LABELS[r]}</option>`;
      }
      selectRank.value = '14'; // Default Ace
      subContainer.appendChild(selectRank);

    } else if (type === 'full_house') {
      const label1 = document.createElement('span');
      label1.textContent = 'Ba con:';
      label1.style.fontSize = '11px';
      const selectTriple = document.createElement('select');
      selectTriple.id = 'claim-triple-rank';
      selectTriple.className = 'game-select';

      const label2 = document.createElement('span');
      label2.textContent = 'Đôi:';
      label2.style.fontSize = '11px';
      const selectPair = document.createElement('select');
      selectPair.id = 'claim-pair-rank';
      selectPair.className = 'game-select';

      for (let r = 2; r <= 14; r++) {
        selectTriple.innerHTML += `<option value="${r}">${RANK_LABELS[r]}</option>`;
        selectPair.innerHTML += `<option value="${r}">${RANK_LABELS[r]}</option>`;
      }
      selectTriple.value = '13'; // K
      selectPair.value = '10';   // 10

      subContainer.appendChild(label1);
      subContainer.appendChild(selectTriple);
      subContainer.appendChild(label2);
      subContainer.appendChild(selectPair);

    } else if (type === 'straight') {
      const label = document.createElement('span');
      label.textContent = 'Tới con:';
      label.style.fontSize = '11px';
      const selectHigh = document.createElement('select');
      selectHigh.id = 'claim-high-rank';
      selectHigh.className = 'game-select';
      for (let r = 5; r <= 14; r++) {
        selectHigh.innerHTML += `<option value="${r}">${RANK_LABELS[r]}</option>`;
      }
      selectHigh.value = '14';
      subContainer.appendChild(label);
      subContainer.appendChild(selectHigh);

    } else if (type === 'straight_flush') {
      const label1 = document.createElement('span');
      label1.textContent = 'Tới:';
      label1.style.fontSize = '11px';
      const selectHigh = document.createElement('select');
      selectHigh.id = 'claim-high-rank';
      selectHigh.className = 'game-select';
      for (let r = 5; r <= 14; r++) {
        selectHigh.innerHTML += `<option value="${r}">${RANK_LABELS[r]}</option>`;
      }
      selectHigh.value = '14';

      const label2 = document.createElement('span');
      label2.textContent = 'Chất:';
      label2.style.fontSize = '11px';
      const selectSuit = document.createElement('select');
      selectSuit.id = 'claim-suit';
      selectSuit.className = 'game-select';
      ['S', 'C', 'D', 'H', 'X', 'M', 'K', 'L'].forEach(s => {
        selectSuit.innerHTML += `<option value="${s}">${SUIT_NAMES[s]}</option>`;
      });

      subContainer.appendChild(label1);
      subContainer.appendChild(selectHigh);
      subContainer.appendChild(label2);
      subContainer.appendChild(selectSuit);
    }
  }

  selectType.addEventListener('change', updateSubInputs);
  updateSubInputs();

  // Auto-claim button helper
  document.getElementById('btn-auto-claim').addEventListener('click', () => {
    playSound('click');
    autoFillClaim();
  });
}

function autoFillClaim() {
  if (selectedCards.size === 0) return;
  const chosenCards = gameState.your_hand.filter(c => selectedCards.has(c.id));
  const count = chosenCards.length;

  const selectType = document.getElementById('select-hand-type');

  if (count === 2) {
    selectType.value = 'pair';
    selectType.dispatchEvent(new Event('change'));
    const r = chosenCards[0].rank === 99 ? (chosenCards[1]?.rank || 14) : chosenCards[0].rank;
    const rEl = document.getElementById('claim-rank');
    if (rEl) rEl.value = r;

  } else if (count === 3) {
    selectType.value = 'three';
    selectType.dispatchEvent(new Event('change'));
    const r = chosenCards[0].rank === 99 ? 14 : chosenCards[0].rank;
    const rEl = document.getElementById('claim-rank');
    if (rEl) rEl.value = r;

  } else if (count === 4) {
    selectType.value = 'four';
    selectType.dispatchEvent(new Event('change'));
    const r = chosenCards[0].rank === 99 ? 14 : chosenCards[0].rank;
    const rEl = document.getElementById('claim-rank');
    if (rEl) rEl.value = r;

  } else if (count === 5) {
    // Check if straight or full house
    selectType.value = 'full_house';
    selectType.dispatchEvent(new Event('change'));
  }
}

function getBuiltClaim() {
  const type = document.getElementById('select-hand-type').value;
  const claim = { type };

  if (['pair', 'three', 'four', 'five'].includes(type)) {
    claim.rank = parseInt(document.getElementById('claim-rank').value, 10);
  } else if (type === 'full_house') {
    claim.triple_rank = parseInt(document.getElementById('claim-triple-rank').value, 10);
    claim.pair_rank = parseInt(document.getElementById('claim-pair-rank').value, 10);
  } else if (type === 'straight') {
    claim.high_rank = parseInt(document.getElementById('claim-high-rank').value, 10);
  } else if (type === 'straight_flush') {
    claim.high_rank = parseInt(document.getElementById('claim-high-rank').value, 10);
    claim.suit = document.getElementById('claim-suit').value;
  }
  return claim;
}

/* ==========================================================================
   5. TOOL ACTIONS & PICKERS
   ========================================================================== */
function executeTool(toolId) {
  if (!toolId) return;
  playSound('tool_power');

  if (toolId === 'DRAW_RANDOM') {
    sendAction('USE_TOOL', { tool_id: 'DRAW_RANDOM' });

  } else if (toolId === 'SWAP_RANDOM') {
    alert("👉 Hãy CLICK vào 1 lá bài trên tay bạn muốn đổi bỏ!");
    pendingTool = { tool_id: 'SWAP_RANDOM' };

  } else if (toolId === 'SWAP_DECK') {
    openPlayerPicker("Chọn người chơi để HOÁN ĐỔI TOÀN BỘ BÀI:", (targetId) => {
      sendAction('USE_TOOL', { tool_id: 'SWAP_DECK', target_player_id: targetId });
    });

  } else if (toolId === 'CHANGE_SUIT') {
    alert("👉 Hãy CLICK vào 1 lá bài trên tay bạn muốn đổi chất!");
    pendingTool = { tool_id: 'CHANGE_SUIT' };

  } else if (toolId === 'DISABLE_TOOL') {
    openPlayerPicker("Chọn đối thủ để KHÓA CÔNG CỤ vòng này:", (targetId) => {
      sendAction('USE_TOOL', { tool_id: 'DISABLE_TOOL', target_player_id: targetId });
    });

  } else if (toolId === 'PEEK_CARD') {
    sendAction('USE_TOOL', { tool_id: 'PEEK_CARD' });

  } else if (toolId === 'FORCE_REVEAL') {
    sendAction('USE_TOOL', { tool_id: 'FORCE_REVEAL' });
  }
}

function setupTools() {
  const activateBtn = document.getElementById('btn-activate-assigned-tool');
  if (activateBtn) {
    activateBtn.addEventListener('click', () => {
      if (gameState && gameState.your_assigned_tool) {
        executeTool(gameState.your_assigned_tool);
      }
    });
  }

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const toolId = btn.getAttribute('data-tool');
      executeTool(toolId);
    });
  });

  // Setup Suit Picker buttons
  document.querySelectorAll('.suit-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const suit = btn.getAttribute('data-suit');
      if (pendingTool && pendingTool.tool_id === 'CHANGE_SUIT' && pendingTool.card_id) {
        sendAction('USE_TOOL', {
          tool_id: 'CHANGE_SUIT',
          card_id: pendingTool.card_id,
          new_suit: suit
        });
        pendingTool = null;
        closeModal('modal-pick-suit');
      }
    });
  });
}

function openPlayerPicker(title, callback) {
  const modal = document.getElementById('modal-pick-player');
  const titleEl = document.getElementById('pick-player-modal-title');
  const container = document.getElementById('pick-player-container');

  titleEl.textContent = title;
  container.innerHTML = '';

  const targets = gameState.players.filter(p => p.id !== gameState.your_id && p.finished_rank === null);
  if (targets.length === 0) {
    alert("Không có đối thủ khả dụng!");
    return;
  }

  targets.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'target-player-btn';
    btn.innerHTML = `
      <span>${p.is_bot ? '🤖' : '👤'} ${escapeHtml(p.name)}</span>
      <span>🃏 ${p.card_count} lá</span>
    `;
    btn.addEventListener('click', () => {
      playSound('click');
      closeModal('modal-pick-player');
      callback(p.id);
    });
    container.appendChild(btn);
  });

  modal.classList.remove('hidden');
}

/* ==========================================================================
   6. EVENT LISTENERS & INITIALIZATION
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
  // Pre-fill Server URL if saved
  const savedServer = localStorage.getItem('soilate_server_url') || new URLSearchParams(window.location.search).get('server');
  const serverInput = document.getElementById('input-server-url');
  if (serverInput && savedServer) {
    serverInput.value = savedServer;
  }

  setupClaimForm();
  setupTools();

  // Audio Toggle
  const btnAudio = document.getElementById('btn-audio');
  btnAudio.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    btnAudio.textContent = audioEnabled ? '🔊' : '🔇';
    initAudio();
  });

  // Rules Modal
  document.getElementById('btn-rules').addEventListener('click', () => {
    playSound('click');
    openModal('modal-rules');
  });

  // Join Room Button
  document.getElementById('btn-join-room').addEventListener('click', () => {
    const nameInput = document.getElementById('input-player-name');
    const roomInput = document.getElementById('input-room-id');
    const name = nameInput.value.trim() || 'Người chơi';
    const room = roomInput.value.trim().toUpperCase() || 'DEFAULT';

    connectWebSocket(name, room);
  });

  // Add Bot Button
  document.getElementById('btn-add-bot').addEventListener('click', () => {
    playSound('click');
    sendAction('ADD_BOT');
  });

  // Remove Bot Button
  const btnRemoveBotEl = document.getElementById('btn-remove-bot');
  if (btnRemoveBotEl) {
    btnRemoveBotEl.addEventListener('click', () => {
      playSound('click');
      sendAction('REMOVE_BOT');
    });
  }

  // Claim Host Button
  const btnClaimHostEl = document.getElementById('btn-claim-host');
  if (btnClaimHostEl) {
    btnClaimHostEl.addEventListener('click', () => {
      playSound('click');
      sendAction('CLAIM_HOST');
    });
  }

  // Start Game Button
  document.getElementById('btn-start-game').addEventListener('click', () => {
    playSound('click');
    sendAction('START_GAME');
  });

  // Play Hand Button
  document.getElementById('btn-play-hand').addEventListener('click', () => {
    playSound('card_play');
    const cardIds = Array.from(selectedCards);
    const faceUpIds = cardIds.filter(cid => faceUpMap[cid] !== false);
    const claim = getBuiltClaim();

    sendAction('PLAY_HAND', {
      card_ids: cardIds,
      face_up_ids: faceUpIds,
      claim: claim
    });

    // Reset local selection
    selectedCards.clear();
    faceUpMap = {};
    renderPlayerHand();
  });

  // Call Bluff Button
  document.getElementById('btn-call').addEventListener('click', () => {
    playSound('call_slam');
    sendAction('CALL_BLUFF');
  });

  // Pass Turn Button
  document.getElementById('btn-pass').addEventListener('click', () => {
    playSound('click');
    sendAction('PASS_TURN');
  });

  // Clear Selection Button (Bỏ chọn tất cả / Rút bài về)
  const btnClearSelection = document.getElementById('btn-clear-selection');
  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', () => {
      playSound('click');
      selectedCards.clear();
      faceUpMap = {};
      renderPlayerHand();
      renderActionControls();
    });
  }
});

// Modal helpers
function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('hidden');
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}
