import * as E from './engine.js';
import * as UI from './ui.js';

const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });

let state = E.createInitialState();
let history = [];
let humanColor = 'w';
let difficulty = 'medium';
let manualFlip = false;
let selected = null;
let legalMovesForSelected = [];
let aiThinking = false;
let aiRequestId = 0;
let reviewPly = 0; // 0..history.length; equals history.length when at the live position
let showThreats = false;
let gameOverHandled = false;

function isAtLive() { return reviewPly === history.length; }
function displayedState() { return isAtLive() ? state : history[reviewPly]; }

function capturedPieces(shownState) {
  const startCounts = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const onBoard = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const piece of shownState.board) {
    if (piece && piece.type !== 'k') onBoard[piece.color][piece.type]++;
  }
  const missing = (color) => {
    const list = [];
    for (const type of ['q', 'r', 'b', 'n', 'p']) {
      const count = startCounts[type] - onBoard[color][type];
      for (let i = 0; i < count; i++) list.push({ type });
    }
    return list;
  };
  return { capturedByWhite: missing('b'), capturedByBlack: missing('w') };
}

function render({ animateMove = false } = {}) {
  const shown = displayedState();
  const live = isAtLive();
  const liveStatus = E.getGameStatus(state);
  const shownStatus = live ? liveStatus : E.getGameStatus(shown);

  let checkSquare = null;
  if (shownStatus.inCheck || shownStatus.status === 'checkmate') {
    const kingColor = shownStatus.status === 'checkmate' ? other(shownStatus.winner) : shown.turn;
    for (let i = 0; i < 64; i++) {
      const p = shown.board[i];
      if (p && p.type === 'k' && p.color === kingColor) { checkSquare = i; break; }
    }
  }
  const lastMove = shown.moveHistory.length ? shown.moveHistory[shown.moveHistory.length - 1].move : null;

  UI.renderBoard({
    board: shown.board,
    selected,
    legalTargets: legalMovesForSelected,
    lastMove,
    animateMove: animateMove && live,
    checkSquare,
    threatenedSquares: showThreats ? E.getThreatenedSquares(shown) : [],
    flipped: boardIsFlipped(),
    onSquareClick: handleSquareClick,
  });

  const { capturedByWhite, capturedByBlack } = capturedPieces(shown);
  UI.renderCaptured(capturedByWhite, capturedByBlack);
  UI.renderMoveList(state.moveHistory, { currentPly: reviewPly, onJump: jumpToPly });

  if (!live) {
    const turnLabel = shown.turn === 'w' ? 'White' : 'Black';
    const positionLabel = reviewPly === 0 ? 'Starting position' : `Move ${reviewPly} of ${history.length}`;
    UI.renderStatus(`Reviewing — ${positionLabel}`, `${turnLabel} to move${shownStatus.inCheck ? ' — check' : ''} · Click Live to resume`);
  } else {
    const turnLabel = state.turn === 'w' ? 'White' : 'Black';
    if (aiThinking) {
      UI.renderStatus(`${turnLabel} to move`, 'Hyoujin is thinking…');
    } else if (liveStatus.status === 'ongoing') {
      UI.renderStatus(`${turnLabel} to move`, liveStatus.inCheck ? 'Check' : '');
    } else {
      UI.renderStatus(gameOverMainText(liveStatus), '');
    }
  }

  document.getElementById('undo-btn').disabled = history.length === 0 || !live;
  document.getElementById('back-btn').disabled = reviewPly === 0;
  document.getElementById('forward-btn').disabled = live;
  document.getElementById('live-btn').disabled = live;

  if (liveStatus.status !== 'ongoing' && !gameOverHandled) {
    gameOverHandled = true;
    const { title, detail } = gameOverModalText(liveStatus);
    UI.showGameOverModal(title, detail, reviewGame, startNewGame);
  }
}

function jumpToPly(ply) {
  if (ply < 0 || ply > history.length) return;
  reviewPly = ply;
  selected = null;
  legalMovesForSelected = [];
  render();
}

function reviewGame() {
  UI.hideGameOverModal();
  render();
}

function other(color) { return color === 'w' ? 'b' : 'w'; }

function boardIsFlipped() {
  // Default orientation (unflipped) shows Black's home rank at the bottom,
  // so White's perspective needs a flip; manual flip toggles on top of that.
  return (humanColor === 'w') !== manualFlip;
}

function gameOverMainText(status) {
  switch (status.status) {
    case 'checkmate': return `Checkmate — ${status.winner === 'w' ? 'White' : 'Black'} wins`;
    case 'stalemate': return 'Draw — stalemate';
    case 'draw-50move': return 'Draw — 50-move rule';
    case 'draw-repetition': return 'Draw — threefold repetition';
    case 'draw-insufficient': return 'Draw — insufficient material';
    default: return '';
  }
}

function gameOverModalText(status) {
  if (status.status === 'checkmate') {
    const winnerIsHuman = status.winner === humanColor;
    return { title: 'Checkmate', detail: winnerIsHuman ? 'You won.' : 'Hyoujin wins.' };
  }
  const detailMap = {
    stalemate: 'No legal moves and no check — the game is a draw.',
    'draw-50move': '50 moves passed with no capture or pawn move.',
    'draw-repetition': 'The same position occurred three times.',
    'draw-insufficient': 'Neither side has enough material to checkmate.',
  };
  return { title: 'Draw', detail: detailMap[status.status] || '' };
}

function handleSquareClick(index) {
  if (!isAtLive()) return;
  if (aiThinking) return;
  if (state.turn !== humanColor) return;
  const status = E.getGameStatus(state);
  if (status.status !== 'ongoing') return;

  const piece = state.board[index];

  if (selected !== null) {
    const move = legalMovesForSelected.find(m => m.to === index);
    if (move) {
      performMove(move);
      return;
    }
  }

  if (piece && piece.color === state.turn) {
    selected = index;
    legalMovesForSelected = E.generateLegalMoves(state).filter(m => m.from === index);
  } else {
    selected = null;
    legalMovesForSelected = [];
  }
  render();
}

function performMove(move) {
  if (move.promotion) {
    const candidates = legalMovesForSelected.filter(m => m.from === move.from && m.to === move.to);
    selected = null;
    legalMovesForSelected = [];
    render();
    UI.showPromotionModal((pieceType) => {
      const chosen = candidates.find(m => m.promotion === pieceType);
      commitMove(chosen);
    });
    return;
  }
  commitMove(move);
}

function commitMove(move) {
  history.push(state);
  state = E.makeMove(state, move);
  reviewPly = history.length; // handleSquareClick only allows this while already at live edge
  selected = null;
  legalMovesForSelected = [];
  render({ animateMove: true });
  maybeTriggerAI();
}

function maybeTriggerAI() {
  if (aiThinking) return;
  const status = E.getGameStatus(state);
  if (status.status !== 'ongoing') return;
  if (state.turn === humanColor) return;
  aiRequestId += 1;
  aiThinking = true;
  render();
  worker.postMessage({ state, difficulty, token: aiRequestId });
}

worker.onmessage = (event) => {
  const { move, token } = event.data;
  if (token !== aiRequestId) return; // stale reply for a side that's no longer AI-controlled
  aiThinking = false;
  if (!move) { render(); return; }
  const wasLive = isAtLive();
  history.push(state);
  state = E.makeMove(state, move);
  if (wasLive) reviewPly = history.length; // don't yank the view if the player was mid-review
  render({ animateMove: wasLive });
};

function startNewGame() {
  UI.hideGameOverModal();
  aiRequestId += 1; // invalidate any AI reply still in flight for the previous game
  state = E.createInitialState();
  history = [];
  reviewPly = 0;
  gameOverHandled = false;
  selected = null;
  legalMovesForSelected = [];
  aiThinking = false;
  render();
  maybeTriggerAI();
}

function undo() {
  if (!isAtLive() || aiThinking || history.length === 0) return;
  state = history.pop();
  while (history.length > 0 && state.turn !== humanColor) {
    state = history.pop();
  }
  reviewPly = history.length;
  selected = null;
  legalMovesForSelected = [];
  render();
}

function setupSegmented(containerId, onChange) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', (event) => {
    const btn = event.target.closest('.segmented-option');
    if (!btn) return;
    for (const el of container.querySelectorAll('.segmented-option')) el.classList.remove('is-selected');
    btn.classList.add('is-selected');
    onChange(btn.dataset.value);
  });
}

setupSegmented('color-select', (value) => {
  if (value === humanColor) return;
  humanColor = value;
  selected = null;
  legalMovesForSelected = [];
  if (aiThinking && state.turn === humanColor) {
    // The in-flight AI move was for a side the player just took over — drop it.
    aiRequestId += 1;
    aiThinking = false;
  }
  render();
  maybeTriggerAI(); // no-op unless control was just handed to the AI for the side on move
});
setupSegmented('difficulty-select', (value) => { difficulty = value; });

document.getElementById('new-game-btn').addEventListener('click', startNewGame);
document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('flip-btn').addEventListener('click', () => { manualFlip = !manualFlip; render(); });
document.getElementById('threats-btn').addEventListener('click', () => {
  showThreats = !showThreats;
  document.getElementById('threats-btn').classList.toggle('is-active', showThreats);
  render();
});

document.getElementById('back-btn').addEventListener('click', () => jumpToPly(reviewPly - 1));
document.getElementById('forward-btn').addEventListener('click', () => jumpToPly(reviewPly + 1));

// Press-and-hold auto-repeat, layered on top of the click handlers above (which already
// cover a single tap, and keyboard/programmatic activation, which never fire pointer events).
function bindHoldRepeat(button, step) {
  const REPEAT_DELAY_MS = 400; // pause before auto-repeat kicks in
  const REPEAT_INTERVAL_MS = 100;
  let timeoutId = null;
  let intervalId = null;

  function stop() {
    clearTimeout(timeoutId);
    clearInterval(intervalId);
    timeoutId = null;
    intervalId = null;
  }

  function tick() {
    if (button.disabled) { stop(); return; }
    step();
  }

  button.addEventListener('pointerdown', () => {
    if (button.disabled) return;
    // The plain 'click' listener already fires the first step; only arm the
    // repeat timer here so a quick click isn't doubled up.
    timeoutId = setTimeout(() => {
      intervalId = setInterval(tick, REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointercancel', stop);
}

bindHoldRepeat(document.getElementById('back-btn'), () => jumpToPly(reviewPly - 1));
bindHoldRepeat(document.getElementById('forward-btn'), () => jumpToPly(reviewPly + 1));
document.getElementById('live-btn').addEventListener('click', () => jumpToPly(history.length));

document.addEventListener('click', (event) => {
  // Board squares already handle their own selection/deselection; this only
  // covers clicks elsewhere on the page (toolbar, side panel, empty space).
  // Runs in the capture phase, before a board click's own handler rebuilds
  // the square elements — otherwise event.target could already be detached
  // by the time this listener ran, making the containment check unreliable.
  if (selected === null) return;
  if (document.getElementById('board').contains(event.target)) return;
  selected = null;
  legalMovesForSelected = [];
  render();
}, true);

render();
