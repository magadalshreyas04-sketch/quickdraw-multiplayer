export type GameStatus = 'lobby' | 'drawing' | 'summary' | 'final';

export type PlayerView = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  hasGuessedCorrectly: boolean;
};

export type Stroke = {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
};

// This type is deliberately safe to broadcast to every player: it has no secret word.
export type RoomView = {
  code: string;
  status: GameStatus;
  players: PlayerView[];
  round: number;
  totalRounds: number;
  drawerId: string | null;
  roundEndsAt: number | null;
  strokes: Stroke[];
  recentGuesses: Array<{ playerId: string; name: string; text: string; correct: boolean }>;
  message: string | null;
};

export type JoinResult = {
  ok: boolean;
  error?: string;
  room?: RoomView;
  playerId?: string;
  reconnectToken?: string;
};
