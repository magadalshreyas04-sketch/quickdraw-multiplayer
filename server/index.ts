import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './game/roomManager.js';
import { validCode, validGuess, validName, validStroke } from './game/validation.js';

const app = express();
app.get('/health', (_request, response) => response.json({ ok: true }));

const httpServer = createServer(app);
// Cap every Socket.IO message before it reaches game validation. A normal stroke is tiny.
const io = new Server(httpServer, {
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 100_000,
});

function acknowledge(reply: unknown) {
  return typeof reply === 'function' ? reply as (result: unknown) => void : () => undefined;
}

const rooms = new RoomManager(
  (room) => io.to(room.code).emit('room:state', rooms.view(room)),
  (room, drawerId, word) => {
    const drawer = room.players.find((player) => player.id === drawerId);
    const socket = drawer?.socketId ? io.sockets.sockets.get(drawer.socketId) : undefined;
    socket?.emit('round:secret', { word });
  },
);

setInterval(() => rooms.expirePlayers(), 30_000).unref();

io.on('connection', (socket) => {
  socket.on('room:create', (payload, reply) => {
    const respond = acknowledge(reply);
    if (!validName(payload?.name)) return respond({ ok: false, error: 'Use a display name between 1 and 18 characters.' });
    const result = rooms.create(payload.name, socket.id);
    socket.data.playerId = result.player.id;
    socket.join(result.room.code);
    respond({ ok: true, room: rooms.view(result.room), playerId: result.player.id, reconnectToken: result.reconnectToken });
  });

  socket.on('room:join', (payload, reply) => {
    const respond = acknowledge(reply);
    const code = typeof payload?.code === 'string' ? payload.code.toUpperCase().trim() : '';
    if (!validCode(code) || !validName(payload?.name)) return respond({ ok: false, error: 'Enter a valid room code and display name.' });
    const result = rooms.join(code, payload.name, socket.id, typeof payload?.reconnectToken === 'string' ? payload.reconnectToken : undefined);
    if ('error' in result) return respond({ ok: false, error: result.error });
    socket.data.playerId = result.player.id;
    socket.join(result.room.code);
    respond({ ok: true, room: rooms.view(result.room), playerId: result.player.id, reconnectToken: result.reconnectToken });
  });

  socket.on('game:start', (reply) => {
    const room = rooms.getRoomForPlayer(socket.data.playerId);
    if (!room) return reply?.({ ok: false, error: 'Join a room first.' });
    const error = rooms.startGame(room, socket.data.playerId);
    reply?.(error ? { ok: false, error } : { ok: true });
  });

  socket.on('draw:stroke', (stroke, reply) => {
    if (!validStroke(stroke)) return reply?.({ ok: false, error: 'Invalid drawing data.' });
    const room = rooms.getRoomForPlayer(socket.data.playerId);
    const lastStrokeAt = socket.data.lastStrokeAt ?? 0;
    if (Date.now() - lastStrokeAt < 10) return reply?.({ ok: false, error: 'Drawing too quickly.' });
    socket.data.lastStrokeAt = Date.now();
    const error = room ? rooms.addStroke(room, socket.data.playerId, stroke) : 'Join a room first.';
    reply?.(error ? { ok: false, error } : { ok: true });
  });

  socket.on('guess:submit', (guess, reply) => {
    if (!validGuess(guess)) return reply?.({ ok: false, error: 'Guesses must be between 1 and 40 characters.' });
    const room = rooms.getRoomForPlayer(socket.data.playerId);
    const result = room ? rooms.submitGuess(room, socket.data.playerId, guess) : { error: 'Join a room first.' };
    reply?.(result.error ? { ok: false, error: result.error } : { ok: true, correct: result.correct });
  });

  socket.on('room:leave', () => {
    const room = rooms.getRoomForPlayer(socket.data.playerId);
    if (room) {
      rooms.disconnect(room, socket.data.playerId);
      socket.leave(room.code);
    }
    socket.data.playerId = undefined;
  });

  socket.on('disconnect', () => {
    const room = rooms.getRoomForPlayer(socket.data.playerId);
    if (room) rooms.disconnect(room, socket.data.playerId);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(here, '../../dist');
app.use(express.static(clientDirectory));
app.use((_request, response) => response.sendFile(path.join(clientDirectory, 'index.html')));

const port = Number(process.env.PORT) || 3001;
httpServer.listen(port, '0.0.0.0', () => console.log(`QuickDraw is listening on port ${port}`));
