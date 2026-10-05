import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { JoinResult, RoomView, Stroke } from '../shared/protocol';

type Session = { code: string; name: string; reconnectToken: string; playerId: string };
const STORAGE_KEY = 'quickdraw-session-v1';
const colors = ['#111827', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];

function savedSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { return null; }
}

export function App() {
  const socketRef = useRef<Socket | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<Session | null>(savedSession);
  const [connected, setConnected] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // In development Vite runs on 5173 while the game server runs on 3001.
    // Production serves both from the same origin.
    const socket = io(import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3001` : undefined);
    socketRef.current = socket;
    const reconnect = () => {
      setConnected(true);
      const current = savedSession();
      if (current) socket.emit('room:join', current, (result: JoinResult) => handleJoinResult(result, current.name));
    };
    socket.on('connect', reconnect);
    socket.on('disconnect', () => setConnected(false));
    socket.on('room:state', (nextRoom: RoomView) => {
      setRoom(nextRoom);
      const current = savedSession();
      if (nextRoom.status !== 'drawing' || nextRoom.drawerId !== current?.playerId) setSecret(null);
    });
    socket.on('round:secret', ({ word }: { word: string }) => setSecret(word));
    return () => { socket.disconnect(); };
  }, []);

  const handleJoinResult = (result: JoinResult, fallbackName: string) => {
    if (!result.ok || !result.room || !result.playerId || !result.reconnectToken) {
      setError(result.error ?? 'Could not join the room.'); return;
    }
    const nextSession = { code: result.room.code, name: fallbackName, playerId: result.playerId, reconnectToken: result.reconnectToken };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession); setRoom(result.room); setError(null);
  };

  const createRoom = (name: string) => {
    socketRef.current?.emit('room:create', { name }, (result: JoinResult) => handleJoinResult(result, name));
  };
  const joinRoom = (code: string, name: string) => {
    socketRef.current?.emit('room:join', { code: code.toUpperCase(), name }, (result: JoinResult) => handleJoinResult(result, name));
  };
  const leave = () => {
    socketRef.current?.emit('room:leave');
    localStorage.removeItem(STORAGE_KEY); setSession(null); setRoom(null); setSecret(null); setError(null);
  };

  if (!room || !session) return <Home connected={connected} error={error} onCreate={createRoom} onJoin={joinRoom} />;
  const me = room.players.find((player) => player.id === session.playerId);
  if (!me) return <Home connected={connected} error="Your player session was not found. Please join again." onCreate={createRoom} onJoin={joinRoom} />;
  const isDrawer = room.status === 'drawing' && room.drawerId === me.id;
  return <GameRoom room={room} meId={me.id} connected={connected} isDrawer={isDrawer} secret={secret}
    socket={socketRef.current!} onLeave={leave} setError={setError} error={error} />;
}

function Home({ connected, error, onCreate, onJoin }: { connected: boolean; error: string | null; onCreate: (name: string) => void; onJoin: (code: string, name: string) => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState('');
  return <main className="home-shell">
    <section className="hero"><div className="logo-mark">✦</div><p className="eyebrow">LIVE MULTIPLAYER DRAWING</p><h1>Quick<span>Draw</span></h1><p>Draw fast. Guess faster. No accounts, no downloads—just share a room code.</p></section>
    <section className="entry-card">
      <div className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Ready to play' : 'Connecting…'}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <label>Display name<input maxLength={18} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sam" /></label>
      <button className="primary" disabled={!connected || !name.trim()} onClick={() => onCreate(name)}>Create a room <span>→</span></button>
      <div className="divider"><span>or join friends</span></div>
      <label>Room code<input className="code-input" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABCDE" /></label>
      <button className="secondary" disabled={!connected || !name.trim() || code.length < 4} onClick={() => onJoin(code, name)}>Join room</button>
      <p className="small">Works on phones, tablets, and laptops.</p>
    </section>
  </main>;
}

function GameRoom({ room, meId, connected, isDrawer, secret, socket, onLeave, setError, error }: {
  room: RoomView; meId: string; connected: boolean; isDrawer: boolean; secret: string | null; socket: Socket; onLeave: () => void; setError: (error: string | null) => void; error: string | null;
}) {
  const me = room.players.find((player) => player.id === meId)!;
  const isHost = me.isHost;
  const start = () => socket.emit('game:start', (result: { ok: boolean; error?: string }) => !result.ok && setError(result.error ?? 'Could not start.'));
  const sorted = useMemo(() => [...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)), [room.players]);
  const roundTitle = room.status === 'lobby' ? 'Lobby' : room.status === 'final' ? 'Final scores' : `Round ${room.round} of ${room.totalRounds}`;

  return <main className="game-shell">
    <header className="topbar"><a className="brand" onClick={onLeave}>✦ QuickDraw</a><div className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Live' : 'Reconnecting…'}</div><button className="text-button" onClick={onLeave}>Leave</button></header>
    {error && <p className="error floating" role="alert">{error}<button onClick={() => setError(null)}>×</button></p>}
    <section className="room-heading"><div><p className="eyebrow">ROOM CODE</p><strong>{room.code}</strong><button className="copy" onClick={() => navigator.clipboard?.writeText(room.code)}>Copy</button></div><h2>{roundTitle}</h2><Timer endsAt={room.roundEndsAt} /></section>
    {room.status === 'lobby' && <Lobby room={room} meId={meId} isHost={isHost} onStart={start} />}
    {room.status === 'drawing' && <section className="game-layout">
      <aside className="scores"><Players players={sorted} drawerId={room.drawerId} meId={meId} /></aside>
      <section className="canvas-column">
        {isDrawer ? <div className="drawer-prompt"><span>You are drawing</span><strong>{secret ?? 'Loading word…'}</strong><small>Draw it without letters or numbers.</small></div> : <div className="drawer-prompt viewer"><span>{room.players.find((player) => player.id === room.drawerId)?.name ?? 'A player'} is drawing</span><strong>Guess the word!</strong></div>}
        <DrawingCanvas strokes={room.strokes} enabled={isDrawer} socket={socket} setError={setError} />
        {isDrawer ? <p className="canvas-hint">Use the palette and draw on the canvas. Everyone sees your strokes live.</p> : <GuessBox socket={socket} setError={setError} />}
      </section>
      <aside className="activity"><GuessFeed guesses={room.recentGuesses} meId={meId} /></aside>
    </section>}
    {room.status === 'summary' && <Summary room={room} sorted={sorted} />}
    {room.status === 'final' && <Final room={room} sorted={sorted} isHost={isHost} onStart={start} onLeave={onLeave} />}
  </main>;
}

function Lobby({ room, meId, isHost, onStart }: { room: RoomView; meId: string; isHost: boolean; onStart: () => void }) {
  return <section className="lobby"><div className="lobby-main"><div className="lobby-icon">✎</div><h2>Invite your crew</h2><p>Share <strong>{room.code}</strong>. The host can start when at least two players are here.</p>{isHost ? <button className="primary big" disabled={room.players.filter((player) => player.connected).length < 2} onClick={onStart}>Start game <span>→</span></button> : <p className="waiting">Waiting for the host to start…</p>}</div><div className="player-card"><p className="eyebrow">PLAYERS · {room.players.filter((player) => player.connected).length}</p><Players players={room.players} drawerId={null} meId={meId} /></div></section>;
}

function DrawingCanvas({ strokes, enabled, socket, setError }: { strokes: Stroke[]; enabled: boolean; socket: Socket; setError: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState(colors[0]); const [width, setWidth] = useState(5);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#fffdf8'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) paint(context, stroke, canvas.width, canvas.height);
  }, [strokes]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }; };
  const send = (points: Stroke['points']) => socket.emit('draw:stroke', { points, color, width }, (result: { ok: boolean; error?: string }) => !result.ok && setError(result.error ?? 'Could not send stroke.'));
  return <div className={`canvas-wrap ${enabled ? 'active' : ''}`}>
    <canvas ref={canvasRef} width="1000" height="650" aria-label="Shared drawing canvas" onPointerDown={(event) => { if (!enabled) return; event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; lastPoint.current = point(event); send([lastPoint.current]); }} onPointerMove={(event) => { if (!enabled || !drawing.current || !lastPoint.current) return; const next = point(event); send([lastPoint.current, next]); lastPoint.current = next; }} onPointerUp={() => { drawing.current = false; lastPoint.current = null; }} onPointerCancel={() => { drawing.current = false; lastPoint.current = null; }} />
    {enabled && <div className="tools"><div>{colors.map((tone) => <button key={tone} className={`swatch ${color === tone ? 'selected' : ''}`} style={{ background: tone }} aria-label={`Choose ${tone}`} onClick={() => setColor(tone)} />)}</div><label>Brush<input type="range" min="2" max="14" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label></div>}
  </div>;
}

function paint(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) { const points = stroke.points; context.strokeStyle = stroke.color; context.lineWidth = stroke.width; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath(); context.moveTo(points[0].x * width, points[0].y * height); if (points.length === 1) context.lineTo(points[0].x * width + 0.1, points[0].y * height + 0.1); else points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height)); context.stroke(); }

function GuessBox({ socket, setError }: { socket: Socket; setError: (message: string) => void }) { const [guess, setGuess] = useState(''); const submit = (event: React.FormEvent) => { event.preventDefault(); if (!guess.trim()) return; socket.emit('guess:submit', guess, (result: { ok: boolean; error?: string; correct?: boolean }) => { if (!result.ok) setError(result.error ?? 'Could not submit guess.'); else setGuess(''); }); }; return <form className="guess-box" onSubmit={submit}><input value={guess} maxLength={40} onChange={(event) => setGuess(event.target.value)} placeholder="Type your guess…" aria-label="Your guess" /><button className="primary">Guess</button></form>; }

function Players({ players, drawerId, meId }: { players: RoomView['players']; drawerId: string | null; meId: string }) { return <ul className="players">{players.map((player, index) => <li key={player.id} className={!player.connected ? 'offline' : ''}><span className="rank">{index + 1}</span><span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="player-name">{player.name}{player.id === meId && ' (you)'}<small>{player.isHost ? 'HOST' : player.id === drawerId ? 'DRAWING' : player.hasGuessedCorrectly ? 'GOT IT!' : !player.connected ? 'RECONNECTING' : ''}</small></span><b>{player.score}</b></li>)}</ul> }
function GuessFeed({ guesses, meId }: { guesses: RoomView['recentGuesses']; meId: string }) { return <section className="guess-feed"><p className="eyebrow">GUESSES</p>{guesses.length ? guesses.map((guess, index) => <p key={`${guess.playerId}-${index}`} className={guess.correct ? 'correct' : ''}><strong>{guess.playerId === meId ? 'You' : guess.name}</strong>{guess.correct ? ' guessed it!' : `: ${guess.text}`}</p>) : <p className="muted">Guesses will appear here.</p>}</section> }
function Summary({ room, sorted }: { room: RoomView; sorted: RoomView['players'] }) { return <section className="summary"><p className="eyebrow">ROUND COMPLETE</p><h2>{room.message}</h2><p>Next round starts shortly. Get ready to draw or guess.</p><div className="summary-scores"><Players players={sorted} drawerId={null} meId="" /></div></section> }
function Final({ room, sorted, isHost, onStart, onLeave }: { room: RoomView; sorted: RoomView['players']; isHost: boolean; onStart: () => void; onLeave: () => void }) { return <section className="final"><div className="trophy">✦</div><p className="eyebrow">GAME COMPLETE</p><h2>{sorted[0]?.name ?? 'Nobody'} wins!</h2><p>Five rounds of excellent questionable artwork.</p><div className="final-scores"><Players players={sorted} drawerId={null} meId="" /></div>{isHost ? <button className="primary big" onClick={onStart}>Play again <span>↻</span></button> : <p className="waiting">Waiting for the host to start another game…</p>}<button className="text-button" onClick={onLeave}>Leave room</button></section> }
function Timer({ endsAt }: { endsAt: number | null }) { const [now, setNow] = useState(Date.now()); useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []); if (!endsAt) return <div className="timer muted">—</div>; return <div className="timer">{Math.max(0, Math.ceil((endsAt - now) / 1000))}s</div>; }
