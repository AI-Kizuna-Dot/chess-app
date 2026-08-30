// Pure chess rules engine. No DOM. Board index 0 = a1 ... 63 = h8 (index = rank*8 + file).

export const FILES = 'abcdefgh';

const KNIGHT_OFFSETS = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const KING_OFFSETS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
const BISHOP_DIRS = [[1,1],[1,-1],[-1,1],[-1,-1]];
const ROOK_DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const QUEEN_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

export function fileOf(i) { return i % 8; }
export function rankOf(i) { return Math.floor(i / 8); }
export function sq(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
  return rank * 8 + file;
}
export function squareName(i) { return FILES[fileOf(i)] + (rankOf(i) + 1); }

function backRank(color) { return color === 'w' ? 0 : 7; }
function pawnStartRank(color) { return color === 'w' ? 1 : 6; }
function pawnPromoteRank(color) { return color === 'w' ? 7 : 0; }
function pawnDir(color) { return color === 'w' ? 1 : -1; }
function other(color) { return color === 'w' ? 'b' : 'w'; }

export function createInitialState() {
  const board = new Array(64).fill(null);
  const order = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[sq(f, 0)] = { type: order[f], color: 'w' };
    board[sq(f, 1)] = { type: 'p', color: 'w' };
    board[sq(f, 6)] = { type: 'p', color: 'b' };
    board[sq(f, 7)] = { type: order[f], color: 'b' };
  }
  const state = {
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    epTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    positionHistory: [],
    moveHistory: [],
  };
  state.positionHistory.push(positionKey(state));
  return state;
}

export function cloneState(state) {
  return {
    board: state.board.slice(),
    turn: state.turn,
    castling: { ...state.castling },
    epTarget: state.epTarget,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
    positionHistory: state.positionHistory.slice(),
    moveHistory: state.moveHistory.slice(),
  };
}

function isSquareAttacked(board, target, byColor) {
  const tf = fileOf(target), tr = rankOf(target);

  for (const [df, dr] of KNIGHT_OFFSETS) {
    const i = sq(tf + df, tr + dr);
    if (i >= 0) {
      const p = board[i];
      if (p && p.color === byColor && p.type === 'n') return true;
    }
  }

  for (const [df, dr] of KING_OFFSETS) {
    const i = sq(tf + df, tr + dr);
    if (i >= 0) {
      const p = board[i];
      if (p && p.color === byColor && p.type === 'k') return true;
    }
  }

  const pawnRankOffset = byColor === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const i = sq(tf + df, tr + pawnRankOffset);
    if (i >= 0) {
      const p = board[i];
      if (p && p.color === byColor && p.type === 'p') return true;
    }
  }

  for (const [df, dr] of ROOK_DIRS) {
    let f = tf + df, r = tr + dr;
    while (true) {
      const i = sq(f, r);
      if (i < 0) break;
      const p = board[i];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      f += df; r += dr;
    }
  }

  for (const [df, dr] of BISHOP_DIRS) {
    let f = tf + df, r = tr + dr;
    while (true) {
      const i = sq(f, r);
      if (i < 0) break;
      const p = board[i];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      f += df; r += dr;
    }
  }

  return false;
}

function findKing(board, color) {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === color && p.type === 'k') return i;
  }
  return -1;
}

export function isInCheck(state, color) {
  const kingSq = findKing(state.board, color);
  if (kingSq < 0) return false;
  return isSquareAttacked(state.board, kingSq, other(color));
}

export function getThreatenedSquares(state) {
  const threatened = [];
  for (let i = 0; i < 64; i++) {
    const piece = state.board[i];
    if (piece && isSquareAttacked(state.board, i, other(piece.color))) {
      threatened.push(i);
    }
  }
  return threatened;
}

function genPseudoMoves(state) {
  const { board, turn } = state;
  const moves = [];

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || piece.color !== turn) continue;
    const f = fileOf(from), r = rankOf(from);

    if (piece.type === 'p') {
      const dir = pawnDir(turn);
      const oneRank = r + dir;
      const oneSq = sq(f, oneRank);
      if (oneSq >= 0 && !board[oneSq]) {
        addPawnMove(moves, from, oneSq, turn);
        const startRank = pawnStartRank(turn);
        if (r === startRank) {
          const twoSq = sq(f, r + 2 * dir);
          if (twoSq >= 0 && !board[twoSq]) {
            moves.push({ from, to: twoSq, doublePawn: true });
          }
        }
      }
      for (const df of [-1, 1]) {
        const capSq = sq(f + df, oneRank);
        if (capSq < 0) continue;
        const target = board[capSq];
        if (target && target.color !== turn) {
          addPawnMove(moves, from, capSq, turn, target);
        } else if (capSq === state.epTarget) {
          moves.push({ from, to: capSq, enPassant: true, captured: { type: 'p', color: other(turn) } });
        }
      }
    } else if (piece.type === 'n') {
      for (const [df, dr] of KNIGHT_OFFSETS) {
        const to = sq(f + df, r + dr);
        if (to < 0) continue;
        const target = board[to];
        if (!target || target.color !== turn) moves.push({ from, to, captured: target || undefined });
      }
    } else if (piece.type === 'k') {
      for (const [df, dr] of KING_OFFSETS) {
        const to = sq(f + df, r + dr);
        if (to < 0) continue;
        const target = board[to];
        if (!target || target.color !== turn) moves.push({ from, to, captured: target || undefined });
      }
      addCastlingMoves(state, moves);
    } else {
      const dirs = piece.type === 'b' ? BISHOP_DIRS : piece.type === 'r' ? ROOK_DIRS : QUEEN_DIRS;
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (true) {
          const to = sq(nf, nr);
          if (to < 0) break;
          const target = board[to];
          if (!target) {
            moves.push({ from, to });
          } else {
            if (target.color !== turn) moves.push({ from, to, captured: target });
            break;
          }
          nf += df; nr += dr;
        }
      }
    }
  }

  return moves;
}

function addPawnMove(moves, from, to, color, captured) {
  if (rankOf(to) === pawnPromoteRank(color)) {
    for (const promo of ['q', 'r', 'b', 'n']) {
      moves.push({ from, to, captured, promotion: promo });
    }
  } else {
    moves.push({ from, to, captured });
  }
}

function addCastlingMoves(state, moves) {
  const { board, turn, castling } = state;
  const color = turn;
  const rank = backRank(color);
  const kingFrom = sq(4, rank);
  if (board[kingFrom]?.type !== 'k' || board[kingFrom]?.color !== color) return;
  const opp = other(color);
  if (isSquareAttacked(board, kingFrom, opp)) return;

  const kSideRight = color === 'w' ? castling.wK : castling.bK;
  if (kSideRight && !board[sq(5, rank)] && !board[sq(6, rank)] &&
      board[sq(7, rank)]?.type === 'r' && board[sq(7, rank)]?.color === color &&
      !isSquareAttacked(board, sq(5, rank), opp) && !isSquareAttacked(board, sq(6, rank), opp)) {
    moves.push({ from: kingFrom, to: sq(6, rank), castle: 'K' });
  }

  const qSideRight = color === 'w' ? castling.wQ : castling.bQ;
  if (qSideRight && !board[sq(3, rank)] && !board[sq(2, rank)] && !board[sq(1, rank)] &&
      board[sq(0, rank)]?.type === 'r' && board[sq(0, rank)]?.color === color &&
      !isSquareAttacked(board, sq(3, rank), opp) && !isSquareAttacked(board, sq(2, rank), opp)) {
    moves.push({ from: kingFrom, to: sq(2, rank), castle: 'Q' });
  }
}

function applyMoveToBoard(board, move, color) {
  const piece = board[move.from];
  board[move.from] = null;
  if (move.enPassant) {
    const capSq = move.to + (color === 'w' ? -8 : 8);
    board[capSq] = null;
  }
  board[move.to] = move.promotion ? { type: move.promotion, color } : piece;
  if (move.castle === 'K') {
    const rank = backRank(color);
    board[sq(5, rank)] = board[sq(7, rank)];
    board[sq(7, rank)] = null;
  } else if (move.castle === 'Q') {
    const rank = backRank(color);
    board[sq(3, rank)] = board[sq(0, rank)];
    board[sq(0, rank)] = null;
  }
}

export function generateLegalMoves(state) {
  const pseudo = genPseudoMoves(state);
  const legal = [];
  for (const move of pseudo) {
    const board = state.board.slice();
    applyMoveToBoard(board, move, state.turn);
    if (!isSquareAttacked(board, findKing(board, state.turn), other(state.turn))) {
      legal.push(move);
    }
  }
  return legal;
}

function positionKey(state) {
  let s = '';
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    s += p ? p.color + p.type : '.';
  }
  const c = state.castling;
  s += '|' + (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '');
  s += '|' + state.turn;
  s += '|' + (state.epTarget ?? '-');
  return s;
}

function pieceLetter(type) {
  return type === 'n' ? 'N' : type.toUpperCase();
}

function toSAN(state, move, legalMoves, resultingState) {
  if (move.castle) {
    let san = move.castle === 'K' ? 'O-O' : 'O-O-O';
    san += checkSuffix(resultingState);
    return san;
  }
  const piece = state.board[move.from];
  const isCapture = !!move.captured;
  let san;
  if (piece.type === 'p') {
    san = isCapture ? FILES[fileOf(move.from)] + 'x' + squareName(move.to) : squareName(move.to);
    if (move.promotion) san += '=' + pieceLetter(move.promotion);
  } else {
    const letter = pieceLetter(piece.type);
    const sameTypeMoves = legalMoves.filter(m =>
      m.to === move.to && m.from !== move.from &&
      state.board[m.from] && state.board[m.from].type === piece.type
    );
    let disambig = '';
    if (sameTypeMoves.length > 0) {
      const sameFile = sameTypeMoves.some(m => fileOf(m.from) === fileOf(move.from));
      const sameRank = sameTypeMoves.some(m => rankOf(m.from) === rankOf(move.from));
      if (!sameFile) disambig = FILES[fileOf(move.from)];
      else if (!sameRank) disambig = String(rankOf(move.from) + 1);
      else disambig = squareName(move.from);
    }
    san = letter + disambig + (isCapture ? 'x' : '') + squareName(move.to);
  }
  san += checkSuffix(resultingState);
  return san;
}

function checkSuffix(resultingState) {
  if (!isInCheck(resultingState, resultingState.turn)) return '';
  const legal = generateLegalMoves(resultingState);
  return legal.length === 0 ? '#' : '+';
}

export function makeMove(state, move) {
  const legalMoves = generateLegalMoves(state);
  const color = state.turn;
  const next = cloneState(state);
  applyMoveToBoard(next.board, move, color);

  const rank = backRank(color);
  if (next.board[sq(4, rank)]?.type !== 'k') {
    if (color === 'w') { next.castling.wK = false; next.castling.wQ = false; }
    else { next.castling.bK = false; next.castling.bQ = false; }
  }
  if (move.from === sq(0, rank) || move.to === sq(0, rank)) {
    if (color === 'w') next.castling.wQ = false; else next.castling.bQ = false;
  }
  if (move.from === sq(7, rank) || move.to === sq(7, rank)) {
    if (color === 'w') next.castling.wK = false; else next.castling.bK = false;
  }
  const oppRank = backRank(other(color));
  if (move.to === sq(0, oppRank)) { if (other(color) === 'w') next.castling.wQ = false; else next.castling.bQ = false; }
  if (move.to === sq(7, oppRank)) { if (other(color) === 'w') next.castling.wK = false; else next.castling.bK = false; }

  next.epTarget = move.doublePawn ? (move.from + move.to) / 2 : null;

  const movedPiece = state.board[move.from];
  next.halfmoveClock = (movedPiece.type === 'p' || move.captured) ? 0 : state.halfmoveClock + 1;
  if (color === 'b') next.fullmoveNumber += 1;

  next.turn = other(color);

  const san = toSAN(state, move, legalMoves, next);
  next.moveHistory.push({ san, move, color });
  next.positionHistory.push(positionKey(next));

  return next;
}

function insufficientMaterial(state) {
  const pieces = state.board.filter(Boolean);
  if (pieces.length <= 2) return true;
  if (pieces.length === 3) {
    return pieces.some(p => p.type === 'b' || p.type === 'n');
  }
  if (pieces.length === 4) {
    const nonKings = pieces.filter(p => p.type !== 'k');
    if (nonKings.length === 2 && nonKings.every(p => p.type === 'b')) {
      const bishopSquares = [];
      for (let i = 0; i < 64; i++) {
        if (state.board[i] && state.board[i].type === 'b') bishopSquares.push(i);
      }
      const colorOf = i => (fileOf(i) + rankOf(i)) % 2;
      if (bishopSquares.length === 2 && colorOf(bishopSquares[0]) === colorOf(bishopSquares[1]) &&
          nonKings[0].color !== nonKings[1].color) {
        return true;
      }
    }
  }
  return false;
}

export function getGameStatus(state) {
  const legal = generateLegalMoves(state);
  const inCheck = isInCheck(state, state.turn);
  if (legal.length === 0) {
    return inCheck ? { status: 'checkmate', winner: other(state.turn) } : { status: 'stalemate' };
  }
  if (state.halfmoveClock >= 100) return { status: 'draw-50move' };
  const key = positionKey(state);
  const count = state.positionHistory.filter(k => k === key).length;
  if (count >= 3) return { status: 'draw-repetition' };
  if (insufficientMaterial(state)) return { status: 'draw-insufficient' };
  return { status: 'ongoing', inCheck };
}
