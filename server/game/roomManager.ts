import { randomBytes, randomUUID } from 'node:crypto';
import type { RoomView, Stroke } from '../../shared/protocol.js';
import { nextDrawer, normalizeText, pickWord, ROUND_LENGTH_MS, scoreForCorrectGuess, SUMMARY_LENGTH_MS, TOTAL_ROUNDS, uniqueName } from './gameEngine.js';
import type { Room, ServerPlayer } from './types.js';
import { WORDS } from './words.js';

const RECONNECT_GRACE_MS = 120_000;
const EMPTY_ROOM_TTL_MS = 15 * 60_000;
const MAX_PLAYERS = 12;
const MAX_STROKES = 1_200;

type RoomChanged = (room: Room) => void;
type SecretReady = (room: Room, drawerId: string, word: string) => void;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private roundTimers = new Map<string, NodeJS.Timeout>();
  private summaryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly onChanged: RoomChanged, private readonly onSecret: SecretReady) {}

  create(name: string, socketId: string) {
    const code = this.createCode();
    const player = this.newPlayer(name, socketId, []);
    const room: Room = {
      code, players: [player], hostId: player.id, status: 'lobby', round: 0,
      drawerId: null, secretWord: null, roundEndsAt: null, strokes: [], recentGuesses: [],
      message: null, createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    return { room, player, reconnectToken: player.token };
  }

  join(code: string, name: string, socketId: string, reconnectToken?: string) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'That room code does not exist.' };

    const reconnecting = reconnectToken ? room.players.find((player) => player.token === reconnectToken) : undefined;
    if (reconnecting) {
      reconnecting.socketId = socketId;
      reconnecting.connected = true;
      reconnecting.disconnectDeadline = null;
      this.onChanged(room);
      return { room, player: reconnecting, reconnectToken: reconnecting.token };
    }
    if (room.players.length >= MAX_PLAYERS) return { error: 'This room is full.' };
    const player = this.newPlayer(name, socketId, room.players);
    room.players.push(player);
    if (!this.player(room, room.hostId)?.connected) this.assignHost(room);
    this.onChanged(room);
    return { room, player, reconnectToken: player.token };
  }

  startGame(room: Room, playerId: string): string | undefined {
    if (room.hostId !== playerId) return 'Only the host can start the game.';
    if (room.status !== 'lobby' && room.status !== 'final') return 'A game is already running.';
    if (this.connectedPlayers(room).length < 2) return 'At least two players are needed.';
    for (const player of room.players) {
      player.score = 0;
      player.hasGuessedCorrectly = false;
    }
    room.round = 0;
    room.drawerId = null;
    this.startNextRound(room);
    return undefined;
  }

  addStroke(room: Room, playerId: string, stroke: Stroke): string | undefined {
    if (room.status !== 'drawing' || room.drawerId !== playerId) return 'Only the current drawer can draw.';
    if (room.strokes.length >= MAX_STROKES) return 'The drawing has reached its limit.';
    room.strokes.push(stroke);
    this.onChanged(room);
    return undefined;
  }

  submitGuess(room: Room, playerId: string, rawGuess: string): { error?: string; correct?: boolean } {
    if (room.status !== 'drawing') return { error: 'Wait for the next round.' };
    if (room.drawerId === playerId) return { error: 'The drawer cannot guess.' };
    const player = this.player(room, playerId);
    if (!player?.connected) return { error: 'You are not an active player.' };
    const text = rawGuess.trim().replace(/\s+/g, ' ');
    const correct = normalizeText(text) === normalizeText(room.secretWord ?? '');
    if (correct && !player.hasGuessedCorrectly) {
      player.hasGuessedCorrectly = true;
      const remainingMs = Math.max(0, (room.roundEndsAt ?? Date.now()) - Date.now());
      player.score += scoreForCorrectGuess(remainingMs);
      const drawer = this.player(room, room.drawerId);
      if (drawer) drawer.score += 50;
      room.recentGuesses.unshift({ playerId, name: player.name, text: 'Guessed it!', correct: true });
      if (this.eligibleGuessers(room).every((guesser) => guesser.hasGuessedCorrectly)) this.endRound(room);
    } else if (!correct) {
      room.recentGuesses.unshift({ playerId, name: player.name, text, correct: false });
      room.recentGuesses = room.recentGuesses.slice(0, 12);
    }
    this.onChanged(room);
    return { correct };
  }

  disconnect(room: Room, playerId: string) {
    const player = this.player(room, playerId);
    if (!player) return;
    player.connected = false;
    player.socketId = null;
    player.disconnectDeadline = Date.now() + RECONNECT_GRACE_MS;
    if (room.hostId === playerId) this.assignHost(room);
    if (room.status === 'drawing' && room.drawerId === playerId) this.endRound(room, 'The drawer left — round ended.');
    this.onChanged(room);
  }

  expirePlayers() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const playerCountBeforeExpiry = room.players.length;
      room.players = room.players.filter((player) => player.connected || (player.disconnectDeadline ?? now) > now);
      if (room.players.length === 0 && now - room.createdAt > EMPTY_ROOM_TTL_MS) this.destroy(room.code);
      else if (room.players.length) {
        if (!this.player(room, room.hostId)?.connected) this.assignHost(room);
        if (room.players.length !== playerCountBeforeExpiry) this.onChanged(room);
      }
    }
  }

  get(code: string) { return this.rooms.get(code); }

  getRoomForPlayer(playerId: string) {
    return [...this.rooms.values()].find((room) => room.players.some((player) => player.id === playerId));
  }

  view(room: Room): RoomView {
    return {
      code: room.code, status: room.status, round: room.round, totalRounds: TOTAL_ROUNDS,
      drawerId: room.drawerId, roundEndsAt: room.roundEndsAt, strokes: room.strokes,
      recentGuesses: room.recentGuesses, message: room.message,
      players: room.players.map((player) => ({
        id: player.id, name: player.name, score: player.score, connected: player.connected,
        isHost: player.id === room.hostId, hasGuessedCorrectly: player.hasGuessedCorrectly,
      })),
    };
  }

  private startNextRound(room: Room) {
    this.clearTimers(room.code);
    if (room.round >= TOTAL_ROUNDS) {
      room.status = 'final'; room.drawerId = null; room.secretWord = null; room.roundEndsAt = null;
      room.message = 'Game complete!'; this.onChanged(room); return;
    }
    const drawer = nextDrawer(room.players, room.drawerId);
    if (!drawer || this.connectedPlayers(room).length < 2) {
      room.status = 'lobby'; room.message = 'Waiting for at least two connected players.'; this.onChanged(room); return;
    }
    room.round += 1;
    room.drawerId = drawer.id;
    room.secretWord = pickWord(WORDS, room.secretWord);
    room.status = 'drawing'; room.roundEndsAt = Date.now() + ROUND_LENGTH_MS;
    room.strokes = []; room.recentGuesses = []; room.message = null;
    for (const player of room.players) player.hasGuessedCorrectly = false;
    this.roundTimers.set(room.code, setTimeout(() => this.endRound(room), ROUND_LENGTH_MS));
    this.onChanged(room);
    this.onSecret(room, drawer.id, room.secretWord);
  }

  private endRound(room: Room, extraMessage?: string) {
    if (room.status !== 'drawing') return;
    const answer = room.secretWord ?? 'Unknown';
    room.status = 'summary'; room.roundEndsAt = null; room.secretWord = null;
    room.message = extraMessage ?? `The word was “${answer}”.`;
    const timer = this.roundTimers.get(room.code);
    if (timer) clearTimeout(timer);
    this.roundTimers.delete(room.code);
    this.onChanged(room);
    this.summaryTimers.set(room.code, setTimeout(() => this.startNextRound(room), SUMMARY_LENGTH_MS));
  }

  private newPlayer(name: string, socketId: string, players: ServerPlayer[]): ServerPlayer {
    return {
      id: randomUUID(), token: randomBytes(24).toString('base64url'), socketId,
      name: uniqueName(name, players), score: 0, joinedAt: Date.now(), connected: true,
      disconnectDeadline: null, hasGuessedCorrectly: false,
    };
  }

  private createCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    while (this.rooms.has(code));
    return code;
  }

  private connectedPlayers(room: Room) { return room.players.filter((player) => player.connected); }
  private eligibleGuessers(room: Room) { return this.connectedPlayers(room).filter((player) => player.id !== room.drawerId); }
  private player(room: Room, id: string | null) { return room.players.find((player) => player.id === id); }
  private assignHost(room: Room) { room.hostId = [...room.players].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? ''; }
  private clearTimers(code: string) { for (const timer of [this.roundTimers.get(code), this.summaryTimers.get(code)]) if (timer) clearTimeout(timer); this.roundTimers.delete(code); this.summaryTimers.delete(code); }
  private destroy(code: string) { this.clearTimers(code); this.rooms.delete(code); }
}
