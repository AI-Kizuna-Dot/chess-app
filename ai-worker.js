import { generateLegalMoves, makeMove, getGameStatus, fileOf, rankOf } from './engine.js';

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const PAWN_PST = [
  0,  0,  0,  0,  0,  0,  0,  0,
  5, 10, 10,-20,-20, 10, 10,  5,
  5, -5,-10,  0,  0,-10, -5,  5,
  0,  0,  0, 20, 20,  0,  0,  0,
  5,  5, 10, 25, 25, 10,  5,  5,
 10, 10, 20, 30, 30, 20, 10, 10,
 50, 50, 50, 50, 50, 50, 50, 50,
  0,  0,  0,  0,  0,  0,  0,  0,
];
const KNIGHT_PST = [
 -50,-40,-30,-30,-30,-30,-40,-50,
 -40,-20,  0,  5,  5,  0,-20,-40,
 -30,  5, 10, 15, 15, 10,  5,-30,
 -30,  0, 15, 20, 20, 15,  0,-30,
 -30,  5, 15, 20, 20, 15,  5,-30,
 -30,  0, 10, 15, 15, 10,  0,-30,
 -40,-20,  0,  0,  0,  0,-20,-40,
 -50,-40,-30,-30,-30,-30,-40,-50,
];
const CENTER_PST = [
 -20,-10,-10,-10,-10,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5,  5,  5,  5,  0,-10,
 -10,  0,  5, 10, 10,  5,  0,-10,
 -10,  0,  5, 10, 10,  5,  0,-10,
 -10,  0,  5,  5,  5,  5,  0,-10,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -20,-10,-10,-10,-10,-10,-10,-20,
];
const PST = { p: PAWN_PST, n: KNIGHT_PST, b: CENTER_PST, r: null, q: null, k: null };

function pstValue(piece, squareIndex) {
  const table = PST[piece.type];
  if (!table) return 0;
  const idx = piece.color === 'w' ? squareIndex : (63 - squareIndex);
  return table[idx];
}

function evaluate(state) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (!p) continue;
    const value = VALUES[p.type] + pstValue(p, i);
    score += p.color === 'w' ? value : -value;
  }
  return score;
}

function orderMoves(moves) {
  return moves.slice().sort((a, b) => {
    const av = a.captured ? VALUES[a.captured.type] : 0;
    const bv = b.captured ? VALUES[b.captured.type] : 0;
    return bv - av;
  });
}

const MATE_SCORE = 1000000;

function negamax(state, depth, alpha, beta) {
  const status = getGameStatus(state);
  if (status.status === 'checkmate') return -(MATE_SCORE - depth);
  if (status.status !== 'ongoing') return 0;
  if (depth === 0) {
    const e = evaluate(state);
    return state.turn === 'w' ? e : -e;
  }
  const moves = orderMoves(generateLegalMoves(state));
  let best = -Infinity;
  for (const move of moves) {
    const child = makeMove(state, move);
    const score = -negamax(child, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

const DIFFICULTY = {
  beginner: { depth: 1, topK: 6 },
  easy: { depth: 2, topK: 3 },
  medium: { depth: 3, topK: 1 },
  hard: { depth: 4, topK: 1 },
  master: { depth: 5, topK: 1 },
};

export function findBestMove(state, difficulty) {
  const config = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const moves = orderMoves(generateLegalMoves(state));
  if (moves.length === 0) return null;

  const scored = moves.map(move => ({
    move,
    score: -negamax(makeMove(state, move), config.depth - 1, -Infinity, Infinity),
  }));
  scored.sort((a, b) => b.score - a.score);

  const k = Math.min(config.topK, scored.length);
  const pickIndex = Math.floor(Math.random() * k);
  return scored[pickIndex].move;
}

if (typeof self !== 'undefined' && typeof self.onmessage !== 'undefined') {
  self.onmessage = (event) => {
    const { state, difficulty, token } = event.data;
    const move = findBestMove(state, difficulty);
    self.postMessage({ move, token });
  };
}
