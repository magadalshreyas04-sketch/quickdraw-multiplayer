# QuickDraw

QuickDraw is a browser-based multiplayer drawing and guessing game. Players create or join a room using a short code—there are no accounts or app installs.

## Core gameplay

1. Create a room and share its five-character code.
2. Players join with a display name.
3. The host starts once two people are connected.
4. Across five rounds, one player privately receives a word and draws it.
5. Everyone else sees the live drawing and races to guess.
6. A correct guess earns `100 + whole seconds remaining`; the drawer earns 50 points for each correct player.
7. The server reveals each answer, rotates the drawer, and shows a final scoreboard. The host can replay in the same room.

## Stack and architecture

- **React + Vite + TypeScript** renders the responsive phone/laptop UI.
- **Express + Socket.IO + TypeScript** serve the app and real-time events from one Node process.
- **RoomManager** in `server/game/roomManager.ts` owns all room state in memory. It is the authority for names, host permissions, rounds, words, timers, accepted strokes, guesses, and scores.

The client only sends intent events (`game:start`, `draw:stroke`, `guess:submit`). It cannot send a score, change a timer, select a word, or advance a round. `RoomView` in `shared/protocol.ts` is intentionally safe to send to every player and does not contain the secret word. The server sends `round:secret` directly to the drawer socket only.

## Project map

```text
client/             React UI and canvas
server/game/        Authoritative rooms, rules, validation, words
server/index.ts     HTTP server and Socket.IO event handlers
shared/protocol.ts  Shared safe client/server message types
test/               Server-side game-rule tests
render.yaml         Render deployment setup
```

## Run locally

Prerequisite: Node.js 20+ (Node 26 was used during development).

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. During development the browser connects to the Node/Socket.IO server on port 3001.

To make a production build and run it locally:

```bash
npm run build
npm start
```

Then open `http://localhost:3001`.

## Test multiplayer locally

1. Open the URL in two normal/incognito browser windows. Incognito creates a separate anonymous browser identity.
2. In one window create a room, then join it from the second window using the code.
3. Start a game, draw in the drawer window, and guess in the other window.
4. Test five rounds, replay, closing/reopening a player window, and copying the room code.
5. To use a phone on the same Wi-Fi, run the production server and open `http://YOUR_COMPUTER_LAN_IP:3001` from the phone. Allow the Node process through the local firewall if prompted.

## Automated tests

```bash
npm test
```

The tests cover normalization used for guess matching, duplicate display names, time-based score calculation, connected-player drawer rotation, and word selection.

## Deploy on Render

1. Push this repository to GitHub.
2. In Render, create a **Web Service** from the repository. Render detects `render.yaml`, or use build command `npm ci && npm run build`, start command `npm start`, and health check `/health`.
3. Deploy. Render assigns a public `https://YOUR-SERVICE.onrender.com` URL.
4. Open that exact HTTPS URL from two separate devices, ideally one on Wi-Fi and one on mobile data, then complete a full game. This is the required final deployment acceptance test.

The MVP deliberately uses a single in-memory server instance. Active rooms disappear after a service restart, which is acceptable for short replayable games. Do not scale this service to multiple instances without first adding shared room storage and a Socket.IO adapter.

## Reconnection and validation

Each browser stores an anonymous reconnect token in local storage. For two minutes after a disconnect, reconnecting with that token restores the same player and score. Names, room codes, guesses, strokes, sender roles, host actions, and canvas limits are validated server-side. If the drawer disconnects, the server ends the round cleanly and continues after the summary.
