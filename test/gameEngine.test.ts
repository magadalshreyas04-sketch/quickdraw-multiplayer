import assert from 'node:assert/strict';
import test from 'node:test';
import { nextDrawer, normalizeText, pickWord, scoreForCorrectGuess, uniqueName } from '../server/game/gameEngine.js';
import { RoomManager } from '../server/game/roomManager.js';
import type { ServerPlayer } from '../server/game/types.js';

function player(id: string, name: string, connected = true): ServerPlayer {
  return { id, name, connected, token: id, socketId: id, score: 0, joinedAt: 0, disconnectDeadline: null, hasGuessedCorrectly: false };
}

test('normalizes guesses without changing the secret comparison rules', () => {
  assert.equal(normalizeText('  Ice   CREAM '), 'ice cream');
  assert.equal(normalizeText('ROBOT'), 'robot');
});

test('adds a clear suffix to duplicate display names', () => {
  const players = [player('1', 'Sam'), player('2', 'sam 2')];
  assert.equal(uniqueName(' Sam ', players), 'Sam 3');
  assert.equal(uniqueName('Riley', players), 'Riley');
});

test('awards more points for faster correct guesses', () => {
  assert.equal(scoreForCorrectGuess(59_100), 160);
  assert.equal(scoreForCorrectGuess(1), 101);
  assert.equal(scoreForCorrectGuess(-10), 100);
});

test('rotates to the next connected player and skips disconnected players', () => {
  const players = [player('a', 'A'), player('b', 'B', false), player('c', 'C')];
  assert.equal(nextDrawer(players, 'a')?.id, 'c');
  assert.equal(nextDrawer(players, 'c')?.id, 'a');
  assert.equal(nextDrawer(players, null)?.id, 'a');
});

test('does not deliberately repeat the previous word when alternatives exist', () => {
  assert.equal(pickWord(['cat', 'dog'], 'cat', () => 0), 'dog');
  assert.equal(pickWord(['cat'], 'cat', () => 0), 'cat');
});

test('the public room view never includes the server-only secret word', () => {
  const manager = new RoomManager(() => undefined, () => undefined);
  const created = manager.create('Host', 'socket-1');
  created.room.secretWord = 'unicorn';
  const view = manager.view(created.room);
  assert.equal('secretWord' in view, false);
  assert.equal(JSON.stringify(view).includes('unicorn'), false);
});

test('reconnect restores the same anonymous player and score during the grace period', () => {
  const manager = new RoomManager(() => undefined, () => undefined);
  const created = manager.create('Host', 'socket-1');
  created.player.score = 230;
  manager.disconnect(created.room, created.player.id);
  const rejoined = manager.join(created.room.code, 'Different name', 'socket-2', created.reconnectToken);
  assert.equal('error' in rejoined, false);
  if ('error' in rejoined) throw new Error(rejoined.error);
  assert.equal(rejoined.player.id, created.player.id);
  assert.equal(rejoined.player.score, 230);
  assert.equal(rejoined.player.connected, true);
});

test('host transfers to a connected player and recovers when a new player joins an empty room', () => {
  const manager = new RoomManager(() => undefined, () => undefined);
  const host = manager.create('Host', 'socket-1');
  const guest = manager.join(host.room.code, 'Guest', 'socket-2');
  if ('error' in guest) throw new Error(guest.error);
  manager.disconnect(host.room, host.player.id);
  assert.equal(host.room.hostId, guest.player.id);
  manager.disconnect(host.room, guest.player.id);
  assert.equal(host.room.hostId, '');
  const newcomer = manager.join(host.room.code, 'New host', 'socket-3');
  if ('error' in newcomer) throw new Error(newcomer.error);
  assert.equal(host.room.hostId, newcomer.player.id);
});

test('empty expired rooms are removed', () => {
  const manager = new RoomManager(() => undefined, () => undefined);
  const created = manager.create('Host', 'socket-1');
  manager.disconnect(created.room, created.player.id);
  created.room.createdAt = 0;
  created.player.disconnectDeadline = 0;
  manager.expirePlayers();
  assert.equal(manager.get(created.room.code), undefined);
});
