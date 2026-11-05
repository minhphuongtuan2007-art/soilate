/**
 * Xon - Client Game Controller & Web Audio Synthesizer
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

let currentRoomAction = 'JOIN_ROOM';

function connectWebSocket(playerName, roomId, action = 'JOIN_ROOM') {
  if (playerName) savedPlayerName = playerName;
  if (roomId) savedRoomId = roomId;
  if (action) currentRoomAction = action;

  initAudio();
  const wsUrl = getWebSocketUrl();
  console.log("Connecting to WebSocket:", wsUrl);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      action: currentRoomAction,
      payload: { player_name: savedPlayerName, room_id: savedRoomId }
    }));
    return;
  }

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("Connected to Xon Server.");
    isReconnecting = false;
    socket.send(JSON.stringify({
      action: currentRoomAction,
      payload: { player_name: savedPlayerName, room_id: savedRoomId }
    }));
    // Also fetch available rooms
    socket.send(JSON.stringify({ action: 'GET_ROOMS' }));
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'STATE_UPDATE') {
        const prevState = gameState;
        gameState = msg.data;
        renderGameState(prevState);
      } else if (msg.type === 'ROOM_LIST') {
        renderPublicRooms(msg.rooms);
      } else if (msg.type === 'ROOM_LEFT') {
        gameState = null;
        switchView('view-lobby');
        sendAction('GET_ROOMS');
      } else if (msg.type === 'ERROR') {
        alert("⚠️ Thông báo: " + msg.message);
      }
    } catch (e) {
      console.error("Error processing msg", e);
    }
  };

  socket.onclose = () => {
    console.log("WebSocket connection closed. Auto-reconnecting in 1.5s...");
    if (!isReconnecting && gameState) {
      isReconnecting = true;
      setTimeout(() => {
        connectWebSocket(savedPlayerName, savedRoomId, 'JOIN_ROOM');
      }, 1500);
    }
  };

  socket.onerror = (err) => {
    console.warn("WebSocket error:", err);
  };
}

function renderPublicRooms(rooms) {
  const listEl = document.getElementById('public-rooms-list');
  if (!listEl) return;

  if (!rooms || rooms.length === 0) {
    listEl.innerHTML = '<div class="room-item-row" style="justify-content: center; color: #94a3b8; font-size: 13px;">Chưa có phòng nào đang mở. Hãy tạo phòng mới nhé!</div>';
    return;
  }

  listEl.innerHTML = '';
  rooms.forEach(r => {
    const row = document.createElement('div');
    row.className = 'room-item-row';
    const isPlaying = (r.state === 'PLAYING');
    const stateBadge = isPlaying
      ? '<span class="badge-state-playing">⚔️ Đang đấu</span>'
      : '<span class="badge-state-lobby">⏳ Phòng chờ</span>';
    const isFull = (r.player_count >= r.max_players);

    row.innerHTML = `
      <div class="room-item-info">
        <div class="room-item-title">
          <span>${escapeHtml(r.name || r.id)}</span>
          <span style="font-family: monospace; font-size: 11px; color: #fbbf24; background: rgba(245, 158, 11, 0.15); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.3);">${escapeHtml(r.id)}</span>
        </div>
        <div class="room-item-meta">
          <span>👥 ${r.player_count}/${r.max_players} người (${r.human_count} người thật)</span>
          <span>${stateBadge}</span>
        </div>
      </div>
      <button class="btn-primary btn-inline btn-join-from-list" data-room-id="${escapeHtml(r.id)}" ${isFull ? 'disabled' : ''}>
        ${isFull ? 'Phòng đầy' : 'Vào chơi 🚀'}
      </button>
    `;

    const joinBtn = row.querySelector('.btn-join-from-list');
    if (joinBtn && !isFull) {
      joinBtn.addEventListener('click', () => {
        playSound('click');
        const nameInput = document.getElementById('input-player-name');
        const name = nameInput.value.trim() || 'Người chơi';
        connectWebSocket(name, r.id, 'JOIN_ROOM');
      });
    }

    listEl.appendChild(row);
  });
}

function copyInviteLink(roomId) {
  const origin = window.location.origin;
  const path = window.location.pathname;
  const inviteUrl = `${origin}${path}?room=${encodeURIComponent(roomId)}`;

  navigator.clipboard.writeText(inviteUrl).then(() => {
    alert(`📋 Đã sao chép link mời phòng [ ${roomId} ] vào bộ nhớ tạm!\n\nLink: ${inviteUrl}\n\nGửi link này cho bạn bè để cùng vào chiến game nhé!`);
  }).catch(() => {
    prompt(`Link mời bạn bè vào phòng [ ${roomId} ] (Nhấn Ctrl + C để sao chép):`, inviteUrl);
  });
}

function leaveCurrentRoom() {
  if (confirm("Bạn có chắc chắn muốn rời phòng để quay về Sảnh chờ không?")) {
    playSound('click');
    sendAction('LEAVE_ROOM');
  }
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

  const badge = document.getElementById('room-badge');
  const btnHeaderLeave = document.getElementById('btn-header-leave');
  if (targetViewId === 'view-lobby') {
    if (badge) badge.classList.add('hidden');
    if (btnHeaderLeave) btnHeaderLeave.style.display = 'none';
  } else {
    if (badge) badge.classList.remove('hidden');
    if (btnHeaderLeave) btnHeaderLeave.style.display = 'inline-block';
  }
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
  if (gameState.state === 'GAME_OVER') {
    if (callBanner) callBanner.classList.add('hidden');
    turnIndicator.textContent = "🏆 TRẬN ĐẤU KẾT THÚC";
    claimText.textContent = "🏆 TRẬN ĐẤU ĐÃ KẾT THÚC!";
    claimAuthor.textContent = "";

    const winner = (gameState.rankings && gameState.rankings[0]) ? gameState.rankings[0] : null;
    const winnerName = winner ? winner.name : 'Người chiến thắng';
    const countdown = (gameState.game_over_countdown !== undefined && gameState.game_over_countdown !== null) ? gameState.game_over_countdown : 5;

    cardsZone.innerHTML = `
      <div class="game-over-center-box card-glass" style="padding: 20px 24px; text-align: center; border: 2px solid #f59e0b; border-radius: 14px; background: rgba(15, 23, 42, 0.96); box-shadow: 0 0 25px rgba(245, 158, 11, 0.4); max-width: 440px; margin: auto;">
        <div style="font-size: 40px; margin-bottom: 4px;">🏆</div>
        <div style="font-size: 20px; font-weight: 800; color: #fbbf24; margin-bottom: 4px;">KẾT THÚC TRẬN ĐẤU!</div>
        <div style="font-size: 14px; color: #f8fafc; margin-bottom: 8px;">🥇 Người chiến thắng: <b style="color:#10b981;">${escapeHtml(winnerName)}</b></div>
        <div style="font-size: 14px; color: #94a3b8; margin-bottom: 14px;">⏱️ Tự động bắt đầu ván mới sau: <b style="color:#f59e0b; font-size: 18px;">${countdown > 0 ? countdown : 1}s</b></div>
        <button id="btn-quick-new-game" class="btn-primary" style="padding: 8px 20px; font-weight: 800; cursor: pointer; border-radius: 8px; border: none; background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-size: 13px;">
          🚀 Bắt đầu ván mới ngay
        </button>
      </div>
    `;

    const btnQuick = document.getElementById('btn-quick-new-game');
    if (btnQuick) {
      btnQuick.addEventListener('click', () => {
        playSound('click');
        sendAction('START_GAME');
      });
    }
    return;
  } else if (gameState.your_finished_rank) {
    turnIndicator.textContent = `🎉 BẠN ĐÃ VỀ ĐÍCH (#${gameState.your_finished_rank})`;
  } else {
    turnIndicator.textContent = gameState.is_your_turn ? 'BẠN (Đến lượt đánh)' : gameState.current_turn_name;
  }

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
        <span class="card-back-label">XỒN</span>
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

  // Tự động nhận diện thế bài khi chọn / bỏ chọn bài
  autoFillClaim();

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

const REQUIRED_HAND_CARD_COUNT = {
  'pair': 2,
  'three': 3,
  'four': 4,
  'five': 5,
  'full_house': 5,
  'straight': 5,
  'straight_flush': 5
};

const HAND_TYPE_VN_NAMES = {
  'pair': 'Đôi (2 lá)',
  'three': 'Ba lá (3 lá)',
  'four': 'Tứ quý (4 lá)',
  'five': 'Năm lá (5 lá)',
  'full_house': 'Cù lũ (3 + 2 lá)',
  'straight': 'Sảnh (5 lá)',
  'straight_flush': 'Thùng phá sảnh (5 lá)'
};

function updateSelectionSummary() {
  const text = document.getElementById('selection-summary-text');
  const clearBtn = document.getElementById('btn-clear-selection');
  const selCount = selectedCards.size;

  const hasTablePlay = (gameState && gameState.table_claim);
  const reqType = hasTablePlay ? gameState.table_claim.type : null;
  const reqCount = reqType ? (REQUIRED_HAND_CARD_COUNT[reqType] || 2) : null;
  const reqName = reqType ? (HAND_TYPE_VN_NAMES[reqType] || reqType) : '';

  if (selCount === 0) {
    if (hasTablePlay) {
      const myCardCount = (gameState.your_hand || []).length;
      if (myCardCount < reqCount) {
        text.innerHTML = `<span style="color:#ef4444; font-weight:700;">⚠️ Bạn chỉ có ${myCardCount} lá, không đủ ${reqCount} lá để đánh cùng thế ${reqName}. Bắt buộc bấm CALL!</span>`;
      } else {
        text.innerHTML = `Bàn yêu cầu thế <b>${reqName}</b>. Hãy chọn đúng ${reqCount} lá (ít nhất 1 lá ngửa) để đánh hoặc bấm <b>CALL</b>.`;
      }
    } else {
      text.textContent = "Click vào lá bài để chọn đưa lên. Click lần nữa để rút bài về.";
    }
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  const chosenCards = (gameState && gameState.your_hand) ? gameState.your_hand.filter(c => selectedCards.has(c.id)) : [];
  const detected = detectBestHand(chosenCards);

  const upCount = Array.from(selectedCards).filter(cid => faceUpMap[cid] !== false).length;
  const downCount = selCount - upCount;

  let handTag = '';
  if (hasTablePlay) {
    if (selCount === reqCount) {
      if (detected.valid && detected.type === reqType) {
        handTag = ` | 🎯 Khớp thế bài: <b style="color:#10b981;">${detected.name}</b> (Bài Thật ✅)`;
      } else {
        handTag = ` | 🎭 <b style="color:#fbbf24;">Đánh cùng thế ${reqName} (Bài Nói dối / Bluff 🤫)</b>`;
      }
    } else {
      handTag = ` | <b style="color:#ef4444;">❌ Bắt buộc đúng ${reqCount} lá cho thế ${reqName}!</b>`;
    }
  } else {
    if (detected.valid) {
      handTag = ` | 🎯 Thế bài: <b style="color:#10b981;">${detected.name}</b>`;
    } else if (selCount >= 2 && selCount <= 5) {
      handTag = ` | 🎭 <b style="color:#fbbf24;">Bài Nói dối / Bluff</b>`;
    }
  }

  text.innerHTML = `Đã chọn: ${selCount} lá (${upCount} lá Ngửa, ${downCount} lá Úp) ${upCount >= 1 ? '✅' : '❌ Cần ít nhất 1 ngửa'}${handTag}`;

  if (clearBtn) clearBtn.style.display = 'inline-block';
}

function renderActionControls() {
  const btnPlay = document.getElementById('btn-play-hand');
  const btnCall = document.getElementById('btn-call');
  const selectType = document.getElementById('select-hand-type');

  // If player already finished their cards
  if (gameState.your_finished_rank) {
    if (btnPlay) btnPlay.disabled = true;
    if (btnCall) btnCall.disabled = true;
    const summaryText = document.getElementById('selection-summary-text');
    if (summaryText) {
      summaryText.textContent = `🎉 BẠN ĐÃ XẢ HẾT BÀI VÀ VỀ ĐÍCH Ở VỊ TRÍ #${gameState.your_finished_rank}! Đang theo dõi ván đấu...`;
    }
    return;
  }

  const isMyTurn = gameState.is_your_turn && gameState.state === 'PLAYING';
  const hasTablePlay = (gameState.table_claim !== null);

  // Call button is active when opponent has cards on the table
  if (btnCall) {
    btnCall.disabled = !(isMyTurn && hasTablePlay);
  }

  const selCount = selectedCards.size;
  const upCount = Array.from(selectedCards).filter(cid => faceUpMap[cid] !== false).length;

  let isValidCount = false;
  if (hasTablePlay) {
    const reqType = gameState.table_claim.type;
    const reqCount = REQUIRED_HAND_CARD_COUNT[reqType] || 2;
    if (selectType) {
      if (selectType.value !== reqType) {
        selectType.value = reqType;
        selectType.dispatchEvent(new Event('change'));
      }
      selectType.disabled = true;
    }
    isValidCount = (selCount === reqCount && upCount >= 1);
  } else {
    if (selectType) {
      selectType.disabled = false;
    }
    isValidCount = (selCount >= 2 && selCount <= 5 && upCount >= 1);
  }

  if (btnPlay) {
    btnPlay.disabled = !(isMyTurn && isValidCount);
  }
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

  // 3. Game Over / Victory Modal
  if (gameState.state === 'GAME_OVER') {
    renderGameOverModal();
  } else {
    closeModal('modal-game-over');
  }
}

function renderGameOverModal() {
  const modal = document.getElementById('modal-game-over');
  const icon = document.getElementById('game-over-icon');
  const title = document.getElementById('game-over-title');
  const sub = document.getElementById('game-over-subtitle');
  const board = document.getElementById('game-over-scoreboard');

  if (!modal) return;

  const yourRank = gameState.your_finished_rank;
  if (yourRank === 1) {
    if (icon) icon.textContent = '👑';
    if (title) title.textContent = 'XUẤT SẮC! BẠN ĐÃ CHIẾN THẮNG!';
    if (sub) sub.textContent = 'Bạn là người đầu tiên xả sạch bài trên tay!';
    playSound('victory');
  } else if (yourRank === gameState.players.length) {
    if (icon) icon.textContent = '💀';
    if (title) title.textContent = 'BẠN ĐÃ THUA CUỘC!';
    if (sub) sub.textContent = 'Bạn là người giữ bài cuối cùng trên bàn đấu!';
    playSound('bluff_caught');
  } else {
    if (icon) icon.textContent = '🏅';
    if (title) title.textContent = 'KẾT THÚC TRẬN ĐẤU!';
    if (sub) sub.textContent = `Bạn đã về đích ở Hạng #${yourRank || '?'}`;
    playSound('victory');
  }

  if (board) {
    board.innerHTML = '';
    const rankings = gameState.rankings || [];
    rankings.forEach((p, idx) => {
      const isYou = (p.id === gameState.your_id);
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.padding = '10px 14px';
      item.style.borderRadius = '8px';
      item.style.background = isYou ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)';
      item.style.border = isYou ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)';

      const medal = (p.rank === 1) ? '🥇 HẠNG 1 (THẮNG)' : (idx === rankings.length - 1 ? '💀 HẠNG CHÓT (THUA)' : `Hạng #${p.rank || (idx + 1)}`);
      item.innerHTML = `
        <span style="font-weight: 700; ${isYou ? 'color: #fbbf24;' : ''}">${p.is_bot ? '🤖' : '👤'} ${escapeHtml(p.name)} ${isYou ? '(Bạn)' : ''}</span>
        <span style="font-weight: 800; color: ${p.rank === 1 ? '#10b981' : (idx === rankings.length - 1 ? '#ef4444' : '#94a3b8')};">${medal}</span>
      `;
      board.appendChild(item);
    });
  }

  const secEl = document.getElementById('game-over-countdown-sec');
  const countdown = (gameState.game_over_countdown !== undefined && gameState.game_over_countdown !== null) ? gameState.game_over_countdown : 5;
  if (secEl) {
    secEl.textContent = countdown > 0 ? countdown : 1;
  }

  openModal('modal-game-over');
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
    autoFillClaim(true);
    updateSelectionSummary();
  });
}

/**
 * Tự động nhận diện thế bài thực tế từ các lá đang chọn
 * Trả về object chi tiết: { valid, type, name, rank, ... }
 */
function detectBestHand(chosenCards) {
  if (!chosenCards || chosenCards.length === 0) {
    return { valid: false, count: 0, reason: 'Chưa chọn lá bài nào' };
  }

  // Lá bài đặc biệt (Skip, Attack, Chaos...) không thể gộp thế bài thường
  if (chosenCards.some(c => c.is_special)) {
    return { valid: false, count: chosenCards.length, reason: 'Lá bài đặc biệt không thể kết hợp trong thế bài' };
  }

  const count = chosenCards.length;
  if (count < 2 || count > 5) {
    return { valid: false, count, reason: count < 2 ? 'Cần chọn ít nhất 2 lá' : 'Thế bài tối đa 5 lá' };
  }

  const wildcards = chosenCards.filter(c => c.is_wildcard || c.rank === 99);
  const naturals = chosenCards.filter(c => !c.is_wildcard && c.rank !== 99);
  const numWild = wildcards.length;

  // 1. HAI LÁ: ĐÔI (Pair)
  if (count === 2) {
    if (naturals.length === 0) {
      return { valid: true, type: 'pair', rank: 14, name: 'Đôi A (2 Joker 🃏)' };
    }
    if (naturals.length === 1) {
      const r = naturals[0].rank;
      return { valid: true, type: 'pair', rank: r, name: `Đôi ${RANK_LABELS[r]} (kèm Joker 🃏)` };
    }
    if (naturals[0].rank === naturals[1].rank) {
      const r = naturals[0].rank;
      return { valid: true, type: 'pair', rank: r, name: `Đôi ${RANK_LABELS[r]}` };
    }
    const maxR = Math.max(naturals[0].rank, naturals[1].rank);
    return {
      valid: false,
      count: 2,
      type: 'pair',
      suggestedRank: maxR,
      reason: '2 lá khác điểm số (Bài Nói dối / Bluff)'
    };
  }

  // 2. BA LÁ: SÁM / BA LÁ (Three of a kind)
  if (count === 3) {
    const ranks = new Set(naturals.map(c => c.rank));
    if (ranks.size <= 1) {
      const r = naturals.length > 0 ? naturals[0].rank : 14;
      return { valid: true, type: 'three', rank: r, name: `Ba lá ${RANK_LABELS[r]}${numWild > 0 ? ' (kèm Joker 🃏)' : ''}` };
    }
    const maxR = Math.max(...naturals.map(c => c.rank));
    return {
      valid: false,
      count: 3,
      type: 'three',
      suggestedRank: maxR,
      reason: '3 lá không cùng điểm (Bài Nói dối / Bluff)'
    };
  }

  // 3. BỐN LÁ: TỨ QUÝ / BỐN LÁ (Four of a kind)
  if (count === 4) {
    const ranks = new Set(naturals.map(c => c.rank));
    if (ranks.size <= 1) {
      const r = naturals.length > 0 ? naturals[0].rank : 14;
      return { valid: true, type: 'four', rank: r, name: `Tứ quý ${RANK_LABELS[r]}${numWild > 0 ? ' (kèm Joker 🃏)' : ''}` };
    }
    const maxR = Math.max(...naturals.map(c => c.rank));
    return {
      valid: false,
      count: 4,
      type: 'four',
      suggestedRank: maxR,
      reason: '4 lá không cùng điểm (Bài Nói dối / Bluff)'
    };
  }

  // 4. NĂM LÁ: NGŨ QUÝ, THÙNG PHÁ SẢNH, CÙ LŨ, SẢNH
  if (count === 5) {
    // 4.1. Ngũ quý (Five of a kind)
    const distinctRanks = new Set(naturals.map(c => c.rank));
    if (distinctRanks.size <= 1) {
      const r = naturals.length > 0 ? naturals[0].rank : 14;
      return { valid: true, type: 'five', rank: r, name: `Ngũ quý ${RANK_LABELS[r]}${numWild > 0 ? ' (kèm Joker 🃏)' : ''}` };
    }

    // 4.2. Thùng phá sảnh (Straight Flush)
    const suits = new Set(naturals.map(c => c.suit));
    if (suits.size <= 1) {
      const suit = naturals.length > 0 ? naturals[0].suit : 'S';
      for (let high = 14; high >= 5; high--) {
        const targetRanks = (high === 5) ? [14, 2, 3, 4, 5] : [high - 4, high - 3, high - 2, high - 1, high];
        const natRanks = naturals.map(c => c.rank);
        const uniqueNatRanks = new Set(natRanks);
        if (uniqueNatRanks.size === natRanks.length) {
          if (natRanks.every(r => targetRanks.includes(r))) {
            if (targetRanks.length - natRanks.length <= numWild) {
              return {
                valid: true,
                type: 'straight_flush',
                high_rank: high,
                suit: suit,
                name: `Thùng phá sảnh ${SUIT_NAMES[suit]} tới ${RANK_LABELS[high]}`
              };
            }
          }
        }
      }
    }

    // 4.3. Cù lũ (Full House: 3 lá Rank A + 2 lá Rank B)
    if (distinctRanks.size === 2) {
      const rArr = Array.from(distinctRanks);
      const r1 = rArr[0], r2 = rArr[1];
      const c1 = naturals.filter(c => c.rank === r1).length;
      const c2 = naturals.filter(c => c.rank === r2).length;
      let bestFH = null;

      if (c1 <= 3 && c2 <= 2) {
        const need1 = Math.max(0, 3 - c1);
        const need2 = Math.max(0, 2 - c2);
        if (need1 + need2 <= numWild) {
          bestFH = { triple_rank: r1, pair_rank: r2 };
        }
      }
      if (c2 <= 3 && c1 <= 2) {
        const need2 = Math.max(0, 3 - c2);
        const need1 = Math.max(0, 2 - c1);
        if (need2 + need1 <= numWild) {
          if (!bestFH || r2 > bestFH.triple_rank) {
            bestFH = { triple_rank: r2, pair_rank: r1 };
          }
        }
      }
      if (bestFH) {
        return {
          valid: true,
          type: 'full_house',
          triple_rank: bestFH.triple_rank,
          pair_rank: bestFH.pair_rank,
          name: `Cù lũ (${RANK_LABELS[bestFH.triple_rank]} trên ${RANK_LABELS[bestFH.pair_rank]})`
        };
      }
    }

    // 4.4. Sảnh (Straight: 5 lá liên tiếp)
    for (let high = 14; high >= 5; high--) {
      const targetRanks = (high === 5) ? [14, 2, 3, 4, 5] : [high - 4, high - 3, high - 2, high - 1, high];
      const natRanks = naturals.map(c => c.rank);
      const uniqueNatRanks = new Set(natRanks);
      if (uniqueNatRanks.size === natRanks.length) {
        if (natRanks.every(r => targetRanks.includes(r))) {
          if (targetRanks.length - natRanks.length <= numWild) {
            return {
              valid: true,
              type: 'straight',
              high_rank: high,
              name: `Sảnh tới ${RANK_LABELS[high]}`
            };
          }
        }
      }
    }

    // 5 lá không khớp thế: Bluff!
    const maxR = naturals.length > 0 ? Math.max(...naturals.map(c => c.rank)) : 14;
    return {
      valid: false,
      count: 5,
      type: 'full_house',
      suggestedHigh: maxR,
      reason: '5 lá không tạo thành thế bài (Bài Nói dối / Bluff)'
    };
  }

  return { valid: false, count, reason: 'Chưa đủ điều kiện thế bài' };
}

/**
 * Tự động phân tích các lá bài đang chọn và điền vào form tuyên bố
 */
function autoFillClaim(isManual = false) {
  const badge = document.getElementById('detected-hand-badge');
  const selectType = document.getElementById('select-hand-type');

  if (!gameState || !gameState.your_hand || selectedCards.size === 0) {
    if (badge) {
      badge.textContent = 'Chưa chọn bài';
      badge.className = 'detected-badge neutral';
    }
    return;
  }

  const chosenCards = gameState.your_hand.filter(c => selectedCards.has(c.id));
  const detected = detectBestHand(chosenCards);

  // Cập nhật nhãn nhận diện trên giao diện
  if (badge) {
    if (detected.valid) {
      badge.innerHTML = `✨ Nhận diện: <b>${detected.name}</b> (Bài Thật ✅)`;
      badge.className = 'detected-badge valid-hand';
    } else if (chosenCards.length >= 2 && chosenCards.length <= 5) {
      badge.innerHTML = `🎭 ${detected.reason} (Đòn Nói dối / Bluff 🤫)`;
      badge.className = 'detected-badge bluff-hand';
    } else if (chosenCards.length === 1) {
      badge.innerHTML = `ℹ️ Đã chọn 1 lá (Cần chọn thêm ít nhất 1 lá)`;
      badge.className = 'detected-badge neutral';
    } else {
      badge.innerHTML = `⚠️ ${detected.reason}`;
      badge.className = 'detected-badge neutral';
    }
  }

  // Tự động điền giá trị thế bài vào dropdowns
  const activeType = (gameState && gameState.table_claim) ? gameState.table_claim.type : detected.type;
  if (activeType && selectType) {
    selectType.value = activeType;
    selectType.dispatchEvent(new Event('change'));

    // Determine fallback rank from face up or chosen cards
    const faceUpCards = chosenCards.filter(c => faceUpMap[c.id] !== false);
    const primaryCard = (faceUpCards.length > 0) ? faceUpCards[0] : chosenCards[0];
    const fallbackRank = primaryCard ? primaryCard.rank : 14;

    if (['pair', 'three', 'four', 'five'].includes(activeType)) {
      const rEl = document.getElementById('claim-rank');
      if (rEl) {
        if (detected.valid && detected.type === activeType) {
          rEl.value = detected.rank || fallbackRank;
        } else {
          rEl.value = fallbackRank;
        }
      }
    } else if (activeType === 'full_house') {
      const tripEl = document.getElementById('claim-triple-rank');
      const pairEl = document.getElementById('claim-pair-rank');
      if (detected.valid && detected.type === 'full_house') {
        if (tripEl && detected.triple_rank) tripEl.value = detected.triple_rank;
        if (pairEl && detected.pair_rank) pairEl.value = detected.pair_rank;
      } else {
        if (tripEl) tripEl.value = fallbackRank;
        if (pairEl) pairEl.value = (fallbackRank === 2 ? 3 : 2);
      }
    } else if (activeType === 'straight') {
      const highEl = document.getElementById('claim-high-rank');
      if (highEl) {
        highEl.value = (detected.valid && detected.type === 'straight') ? detected.high_rank : Math.max(5, fallbackRank);
      }
    } else if (activeType === 'straight_flush') {
      const highEl = document.getElementById('claim-high-rank');
      const suitEl = document.getElementById('claim-suit');
      if (highEl) {
        highEl.value = (detected.valid && detected.type === 'straight_flush') ? detected.high_rank : Math.max(5, fallbackRank);
      }
      if (suitEl) {
        suitEl.value = (primaryCard && !['W', 'SPEC'].includes(primaryCard.suit)) ? primaryCard.suit : 'S';
      }
    }
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

  // Lobby Navigation Tabs
  document.querySelectorAll('.lobby-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('click');
      document.querySelectorAll('.lobby-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.lobby-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      const content = document.getElementById(tabId);
      if (content) content.classList.add('active');

      if (tabId === 'tab-rooms') {
        sendAction('GET_ROOMS');
      }
    });
  });

  // Random Room Code Generator
  const btnGenRandom = document.getElementById('btn-gen-random-code');
  if (btnGenRandom) {
    btnGenRandom.addEventListener('click', () => {
      playSound('click');
      const createInput = document.getElementById('input-create-room-id');
      if (createInput) {
        createInput.value = 'SOL-' + Math.floor(1000 + Math.random() * 9000);
      }
    });
  }

  // Create Room Button
  const btnCreateRoom = document.getElementById('btn-create-room');
  if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
      playSound('click');
      const nameInput = document.getElementById('input-player-name');
      const createInput = document.getElementById('input-create-room-id');
      const name = nameInput.value.trim() || 'Người chơi';
      let roomCode = createInput.value.trim().toUpperCase();
      if (!roomCode) {
        roomCode = 'SOL-' + Math.floor(1000 + Math.random() * 9000);
      }
      connectWebSocket(name, roomCode, 'CREATE_ROOM');
    });
  }

  // Join Room Button
  document.getElementById('btn-join-room').addEventListener('click', () => {
    playSound('click');
    const nameInput = document.getElementById('input-player-name');
    const roomInput = document.getElementById('input-room-id');
    const name = nameInput.value.trim() || 'Người chơi';
    const room = roomInput.value.trim().toUpperCase() || 'DEFAULT';

    connectWebSocket(name, room, 'JOIN_ROOM');
  });

  // Refresh Public Rooms List Button
  const btnRefreshRooms = document.getElementById('btn-refresh-rooms');
  if (btnRefreshRooms) {
    btnRefreshRooms.addEventListener('click', () => {
      playSound('click');
      sendAction('GET_ROOMS');
    });
  }

  // Copy Invite Link Buttons
  const btnCopyInvite = document.getElementById('btn-copy-invite');
  if (btnCopyInvite) {
    btnCopyInvite.addEventListener('click', () => {
      playSound('click');
      const roomId = (gameState && gameState.room_id) ? gameState.room_id : savedRoomId;
      copyInviteLink(roomId);
    });
  }

  const btnCopyHeader = document.getElementById('btn-copy-header-code');
  if (btnCopyHeader) {
    btnCopyHeader.addEventListener('click', () => {
      playSound('click');
      const roomId = (gameState && gameState.room_id) ? gameState.room_id : savedRoomId;
      copyInviteLink(roomId);
    });
  }

  // Leave Room Buttons
  const btnLeaveWaiting = document.getElementById('btn-leave-room-waiting');
  if (btnLeaveWaiting) {
    btnLeaveWaiting.addEventListener('click', () => {
      leaveCurrentRoom();
    });
  }

  const btnHeaderLeave = document.getElementById('btn-header-leave');
  if (btnHeaderLeave) {
    btnHeaderLeave.addEventListener('click', () => {
      leaveCurrentRoom();
    });
  }

  // Check URL Invitation Parameter: ?room=XYZ
  const urlParams = new URLSearchParams(window.location.search);
  const inviteRoom = urlParams.get('room');
  if (inviteRoom) {
    const inputJoin = document.getElementById('input-room-id');
    if (inputJoin) inputJoin.value = inviteRoom.toUpperCase();
    const tabJoinBtn = document.getElementById('tab-btn-join');
    if (tabJoinBtn) tabJoinBtn.click();
  } else {
    // Generate a starter room code in create room input
    const createInput = document.getElementById('input-create-room-id');
    if (createInput) {
      createInput.value = 'SOL-' + Math.floor(1000 + Math.random() * 9000);
    }
  }

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
    autoFillClaim();
    renderPlayerHand();
  });

  // Call Bluff Button
  document.getElementById('btn-call').addEventListener('click', () => {
    playSound('call_slam');
    sendAction('CALL_BLUFF');
  });

  // Clear Selection Button (Bỏ chọn tất cả / Rút bài về)
  const btnClearSelection = document.getElementById('btn-clear-selection');
  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', () => {
      playSound('click');
      selectedCards.clear();
      faceUpMap = {};
      autoFillClaim();
      renderPlayerHand();
      renderActionControls();
    });
  }

  // Quick Start Next Round Button (from Game Over modal)
  const btnQuickStartNow = document.getElementById('btn-quick-start-now');
  if (btnQuickStartNow) {
    btnQuickStartNow.addEventListener('click', () => {
      playSound('click');
      closeModal('modal-game-over');
      sendAction('START_GAME');
    });
  }

  // Play Again Button (from Game Over modal -> back to lobby)
  const btnPlayAgain = document.getElementById('btn-play-again');
  if (btnPlayAgain) {
    btnPlayAgain.addEventListener('click', () => {
      playSound('click');
      closeModal('modal-game-over');
      sendAction('RESTART_GAME');
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
