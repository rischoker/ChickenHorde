// Chicken Horde relay server.
// - WebSocket relay used when P2P/WebRTC is blocked (school proxies, strict firewalls, CGNAT).
//   Everything travels over a normal HTTPS/WSS connection on port 443, which proxies almost always allow.
// - Optionally serves the game itself (static files from the parent folder), so one deployment is enough:
//   open https://<your-relay>/?host=1 and set relayUrl: 'same-origin' in index.html.
//
// Run locally:   cd server && npm install && npm start      (PORT defaults to 8080)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..'));
const MAX_MSG = 16 * 1024;           // bytes per message
const MAX_PLAYERS_PER_ROOM = 32;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.obj': 'text/plain', '.mtl': 'text/plain', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() | 0 })); }
  let file = path.normalize(path.join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR) || file.includes(`${path.sep}server${path.sep}`) || file.includes(`${path.sep}node_modules${path.sep}`)) { res.writeHead(403); return res.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
  });
});

// room code -> { host: ws, clients: Map<sid, ws> }
const rooms = new Map();
let nextSid = 1;
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    ws.alive = true;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') return;
    if (m.t === 'host') {
      const code = String(m.room || '').toUpperCase().slice(0, 16);
      if (!/^[A-Z0-9-]{3,16}$/.test(code)) return send(ws, { t: 'error', reason: 'bad-room' });
      const existing = rooms.get(code);
      if (existing && existing.host !== ws && existing.host.readyState === 1) return send(ws, { t: 'error', reason: 'taken' });
      const roomObj = existing || { host: ws, clients: new Map() };
      roomObj.host = ws; rooms.set(code, roomObj);
      ws.role = 'host'; ws.room = code;
      send(ws, { t: 'hosted', room: code });
      // Re-announce clients that stayed connected while the host was reconnecting.
      for (const [sid, c] of roomObj.clients) { send(ws, { t: 'open', sid }); send(c, { t: 'rejoin' }); }
      return;
    }
    if (m.t === 'join') {
      const code = String(m.room || '').toUpperCase().slice(0, 16), roomObj = rooms.get(code);
      if (!roomObj || roomObj.host.readyState !== 1) return send(ws, { t: 'error', reason: 'no-room' });
      if (roomObj.clients.size >= MAX_PLAYERS_PER_ROOM) return send(ws, { t: 'error', reason: 'room-full' });
      ws.role = 'client'; ws.room = code; ws.sid = nextSid++;
      roomObj.clients.set(ws.sid, ws);
      send(ws, { t: 'joined' });
      send(roomObj.host, { t: 'open', sid: ws.sid });
      return;
    }
    const roomObj = rooms.get(ws.room);
    if (!roomObj) return;
    if (m.t === 'd') {
      if (ws.role === 'client') send(roomObj.host, { t: 'd', sid: ws.sid, d: m.d });
      else if (ws.role === 'host') send(roomObj.clients.get(Number(m.sid)), { t: 'd', d: m.d });
    } else if (m.t === 'kick' && ws.role === 'host') {
      const c = roomObj.clients.get(Number(m.sid));
      if (c) { roomObj.clients.delete(c.sid); try { c.close(4000, 'kicked'); } catch {} }
    }
  });
  ws.on('close', () => {
    const roomObj = rooms.get(ws.room);
    if (!roomObj) return;
    if (ws.role === 'client') { roomObj.clients.delete(ws.sid); send(roomObj.host, { t: 'close', sid: ws.sid }); }
    else if (ws.role === 'host' && roomObj.host === ws) {
      // Keep the room for 60 s so the host can reconnect without everyone rejoining.
      setTimeout(() => {
        const r = rooms.get(ws.room);
        if (r && r.host === ws) { for (const c of r.clients.values()) try { c.close(4001, 'host-left'); } catch {} rooms.delete(ws.room); }
      }, 60000);
    }
  });
});

// Heartbeat: drop dead sockets (and keep free hosting tiers from idling the connection).
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 25000);

server.listen(PORT, () => console.log(`Chicken Horde relay listening on :${PORT} (static files: ${STATIC_DIR})`));
