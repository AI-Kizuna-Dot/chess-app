import { fileOf, rankOf, squareName, FILES, sq } from './engine.js';

const GLYPHS = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' },
};

export function pieceGlyph(piece) {
  return GLYPHS[piece.color][piece.type];
}

// flipped = White's point of view: White's rank 1 at the bottom, files unmirrored (a on the left).
// unflipped = Black's point of view: Black's rank 8 at the bottom, files mirrored (h on the left).
function boardToVisual(boardIndex, flipped) {
  const file = fileOf(boardIndex), rank = rankOf(boardIndex);
  return flipped ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}

function visualToBoard(col, row, flipped) {
  return flipped ? sq(col, 7 - row) : sq(7 - col, row);
}

function slidePieceIn(boardEl, fromIndex, toIndex, flipped, squareSize) {
  const pieceEl = boardEl.querySelector(`.square[data-index="${toIndex}"] .piece`);
  if (!pieceEl) return;
  const fromPos = boardToVisual(fromIndex, flipped);
  const toPos = boardToVisual(toIndex, flipped);
  const dx = (fromPos.col - toPos.col) * squareSize;
  const dy = (fromPos.row - toPos.row) * squareSize;
  if (dx === 0 && dy === 0) return;

  pieceEl.style.transition = 'none';
  pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
  pieceEl.getBoundingClientRect(); // force reflow so the start position takes effect before animating
  requestAnimationFrame(() => {
    pieceEl.style.transition = 'transform 0.18s ease-out';
    pieceEl.style.transform = 'translate(0, 0)';
  });
  pieceEl.addEventListener('transitionend', () => {
    pieceEl.style.transition = '';
    pieceEl.style.transform = '';
  }, { once: true });
}

export function renderBoard({ board, selected, legalTargets, lastMove, animateMove, checkSquare, threatenedSquares, flipped, onSquareClick }) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  const targetSet = new Set((legalTargets || []).map(m => m.to));
  const captureTargets = new Set((legalTargets || []).filter(m => m.captured).map(m => m.to));
  const threatSet = new Set(threatenedSquares || []);

  for (let visualIndex = 0; visualIndex < 64; visualIndex++) {
    const col = visualIndex % 8, row = Math.floor(visualIndex / 8);
    const boardIndex = visualToBoard(col, row, flipped);
    const file = fileOf(boardIndex), rank = rankOf(boardIndex);
    const squareEl = document.createElement('div');
    squareEl.className = 'square ' + ((file + rank) % 2 === 0 ? 'light' : 'dark');
    squareEl.dataset.index = String(boardIndex);

    if (selected === boardIndex) squareEl.classList.add('is-selected');
    if (lastMove && (lastMove.from === boardIndex || lastMove.to === boardIndex)) squareEl.classList.add('is-last-move');
    if (checkSquare === boardIndex) squareEl.classList.add('is-check');
    if (threatSet.has(boardIndex)) squareEl.classList.add('is-threatened');

    const piece = board[boardIndex];
    if (piece) {
      const pieceEl = document.createElement('span');
      pieceEl.className = `piece color-${piece.color}`;
      pieceEl.textContent = pieceGlyph(piece);
      squareEl.appendChild(pieceEl);
    }

    if (targetSet.has(boardIndex)) {
      const dot = document.createElement('span');
      dot.className = 'legal-dot' + (captureTargets.has(boardIndex) ? ' capture-ring' : '');
      squareEl.appendChild(dot);
    }

    if (file === 0 || rank === 0) {
      const coord = document.createElement('span');
      coord.className = 'square-coord';
      coord.textContent = rank === 0 ? FILES[file] : '';
      if (file === 0 && rank !== 0) coord.textContent = String(rank + 1);
      squareEl.appendChild(coord);
    }

    squareEl.addEventListener('click', () => onSquareClick(boardIndex));
    boardEl.appendChild(squareEl);
  }

  if (animateMove && lastMove) {
    const squareSize = boardEl.clientWidth / 8;
    slidePieceIn(boardEl, lastMove.from, lastMove.to, flipped, squareSize);
    if (lastMove.castle) {
      const movedPiece = board[lastMove.to];
      const rank = movedPiece.color === 'w' ? 0 : 7;
      const [rookFrom, rookTo] = lastMove.castle === 'K'
        ? [sq(7, rank), sq(5, rank)]
        : [sq(0, rank), sq(3, rank)];
      slidePieceIn(boardEl, rookFrom, rookTo, flipped, squareSize);
    }
  }
}

export function renderCaptured(capturedByWhite, capturedByBlack) {
  document.getElementById('captured-white').textContent =
    capturedByWhite.length ? capturedByWhite.map(p => GLYPHS.b[p.type]).join(' ') : '';
  document.getElementById('captured-black').textContent =
    capturedByBlack.length ? capturedByBlack.map(p => GLYPHS.w[p.type]).join(' ') : '';
}

export function renderStatus(main, sub) {
  const el = document.getElementById('status');
  el.innerHTML = '';
  const mainSpan = document.createElement('span');
  mainSpan.textContent = main;
  el.appendChild(mainSpan);
  if (sub) {
    const subSpan = document.createElement('span');
    subSpan.className = 'status-sub';
    subSpan.textContent = sub;
    el.appendChild(subSpan);
  }
}

export function renderMoveList(moveHistory, { currentPly, onJump } = {}) {
  const listEl = document.getElementById('move-list');
  listEl.innerHTML = '';

  function addMoveCell(ply, san) {
    const cell = document.createElement('span');
    cell.className = 'move-san';
    if (san) {
      cell.textContent = san;
      cell.classList.add('is-clickable');
      if (ply === currentPly) cell.classList.add('is-current-ply');
      cell.addEventListener('click', () => onJump && onJump(ply));
    }
    listEl.appendChild(cell);
  }

  for (let i = 0; i < moveHistory.length; i += 2) {
    const num = document.createElement('span');
    num.className = 'move-number';
    num.textContent = String(i / 2 + 1) + '.';
    listEl.appendChild(num);

    addMoveCell(i + 1, moveHistory[i]?.san);
    addMoveCell(i + 2, moveHistory[i + 1]?.san);
  }

  const currentRow = listEl.querySelector('.is-current-ply');
  if (currentRow) {
    // Scroll only the move list's own internal scrollbar into position — never
    // scrollIntoView, which can bubble up and scroll the whole page too.
    const rowTop = currentRow.offsetTop;
    const rowBottom = rowTop + currentRow.offsetHeight;
    if (rowTop < listEl.scrollTop) listEl.scrollTop = rowTop;
    else if (rowBottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = rowBottom - listEl.clientHeight;
  } else {
    listEl.scrollTop = listEl.scrollHeight;
  }
}

export function showPromotionModal(onChoose) {
  const modal = document.getElementById('promotion-modal');
  modal.classList.remove('hidden');
  const options = document.getElementById('promotion-options');
  const handler = (event) => {
    const btn = event.target.closest('.promotion-option');
    if (!btn) return;
    modal.classList.add('hidden');
    options.removeEventListener('click', handler);
    onChoose(btn.dataset.piece);
  };
  options.addEventListener('click', handler);
}

export function showGameOverModal(title, detail, onReview, onNewGame) {
  const modal = document.getElementById('gameover-modal');
  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-detail').textContent = detail;
  modal.classList.remove('hidden');

  const reviewBtn = document.getElementById('gameover-review-btn');
  const reviewHandler = () => {
    reviewBtn.removeEventListener('click', reviewHandler);
    newGameBtn.removeEventListener('click', newGameHandler);
    onReview();
  };
  reviewBtn.addEventListener('click', reviewHandler);

  const newGameBtn = document.getElementById('gameover-newgame-btn');
  const newGameHandler = () => {
    reviewBtn.removeEventListener('click', reviewHandler);
    newGameBtn.removeEventListener('click', newGameHandler);
    onNewGame();
  };
  newGameBtn.addEventListener('click', newGameHandler);
}

export function hideGameOverModal() {
  document.getElementById('gameover-modal').classList.add('hidden');
}

export { squareName };
