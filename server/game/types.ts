import type { GameStatus, Stroke } from '../../shared/protocol.js';

export type ServerPlayer = {
  id: string;
  token: string;
  socketId: string | null;
  name: string;
  score: number;
  joinedAt: number;
  connected: boolean;
  disconnectDeadline: number | null;
  hasGuessedCorrectly: boolean;
};

export type Room = {
  code: string;
  players: ServerPlayer[];
  hostId: string;
  status: GameStatus;
  round: number;
  drawerId: string | null;
  secretWord: string | null;
  roundEndsAt: number | null;
  strokes: Stroke[];
  recentGuesses: Array<{ playerId: string; name: string; text: string; correct: boolean }>;
  message: string | null;
  createdAt: number;
};
