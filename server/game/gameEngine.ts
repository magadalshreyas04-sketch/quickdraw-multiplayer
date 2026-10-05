import type { ServerPlayer } from './types.js';

export const TOTAL_ROUNDS = 5;
export const ROUND_LENGTH_MS = 60_000;
export const SUMMARY_LENGTH_MS = 5_000;

export function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function uniqueName(requestedName: string, players: ServerPlayer[], ignoreId?: string): string {
  const base = requestedName.trim().replace(/\s+/g, ' ');
  const names = new Set(players.filter((player) => player.id !== ignoreId).map((player) => normalizeText(player.name)));
  if (!names.has(normalizeText(base))) return base;
  let number = 2;
  while (names.has(normalizeText(`${base} ${number}`))) number += 1;
  return `${base} ${number}`;
}

export function scoreForCorrectGuess(remainingMs: number): number {
  return 100 + Math.max(0, Math.ceil(remainingMs / 1000));
}

export function nextDrawer(players: ServerPlayer[], currentDrawerId: string | null): ServerPlayer | undefined {
  const eligible = players.filter((player) => player.connected);
  if (!eligible.length) return undefined;
  const currentIndex = eligible.findIndex((player) => player.id === currentDrawerId);
  return eligible[(currentIndex + 1 + eligible.length) % eligible.length];
}

export function pickWord(words: string[], previousWord: string | null, random = Math.random): string {
  const choices = words.filter((word) => word !== previousWord);
  return choices[Math.floor(random() * choices.length)] ?? words[0];
}
