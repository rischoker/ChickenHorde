// Chicken Horde server — Express + Socket.IO (Render Web Service).
// - Serves the game from public/ (all libraries are local in public/vendor, no CDNs).
// - Relays messages between the host screen (projector) and the phones through rooms.
// - Phones and host reconnect automatically; the room survives short host drops.
// - Proxies the global leaderboard to Supabase so only this domain needs to be reachable.
// - GET /healthz for Render health checks.
'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://vjbcqhkfvctzwecmzcqa.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_mJlZ7Ym9LXAhTkWncksX6A_Czg0mbv6';
const HOST_GRACE_MS = 3 * 60 * 1000;   // keep a room alive this long after the host screen drops
const MAX_PLAYERS = 32;          // classroom rooms (projector + phones)
const MAX_ONLINE_SOCKETS = 12;   // online rooms: the host caps the squad at 6 chicks; this only stops socket spam
const started = Date.now();

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '32kb' }));

app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, uptime: Math.round((Date.now() - started) / 1000), rooms: rooms.size, sockets: io.engine.clientsCount });
});
app.get('/host', (req, res) => res.redirect('/?host=1'));

// ---- Global leaderboard proxy (Supabase REST) -------------------------------
const sbHeaders = () => Object.assign({ apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, SUPABASE_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SUPABASE_KEY } : {});
let scoreCache = { all: null, week: null };
app.get('/api/scores', async (req, res) => {
  const mode = req.query.mode === 'week' ? 'week' : 'all';
  const hit = scoreCache[mode];
  if (hit && Date.now() - hit.at < 15000) return res.json(hit.rows);
  try {
    let q = `${SUPABASE_URL}/rest/v1/scores?select=name,score,wave,kills,players,created_at&order=score.desc&limit=60`;
    if (mode === 'week') q += '&created_at=gte.' + new Date(Date.now() - 7 * 864e5).toISOString();
    const r = await fetch(q, { headers: sbHeaders() });
    if (!r.ok) throw new Error('Supabase HTTP ' + r.status);
    const seen = new Set(), rows = [];
    for (const s of await r.json()) { const k = String(s.name).trim().toUpperCase(); if (seen.has(k)) continue; seen.add(k); rows.push(s); if (rows.length >= 10) break; }
    scoreCache[mode] = { at: Date.now(), rows };
    res.json(rows);
  } catch (e) { console.warn('[scores] read failed:', e.message); res.status(503).json({ error: 'leaderboard unavailable' }); }
});
app.post('/api/scores', async (req, res) => {
  const list = (Array.isArray(req.body) ? req.body : []).slice(0, MAX_PLAYERS).map(s => ({
    name: String(s.name || 'CHICK').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12) || 'CHICK',
    score: Math.max(0, Math.floor(+s.score || 0)), wave: Math.max(1, Math.floor(+s.wave || 1)),
    kills: Math.max(0, Math.floor(+s.kills || 0)), players: Math.min(MAX_PLAYERS, Math.max(1, Math.floor(+s.players || 1))), version: String(s.version || '8').slice(0, 10)
  })).filter(s => s.score > 0);
  if (!list.length) return res.json({ ok: true, saved: 0 });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/scores`, { method: 'POST', headers: Object.assign(sbHeaders(), { Prefer: 'return=minimal' }), body: JSON.stringify(list) });
    if (!r.ok) throw new Error('Supabase HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
    scoreCache = { all: null, week: null };
    res.json({ ok: true, saved: list.length });
  } catch (e) { console.warn('[scores] write failed:', e.message); res.status(503).json({ error: 'leaderboard unavailable' }); }
});

// ---- Static game ----------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|webmanifest)$/.test(file) || /sw\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(glb|gltf|bin|png|mp3|obj|mtl)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// ---- Rooms ---------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000, pingTimeout: 12000, maxHttpBufferSize: 512 * 1024,
  cors: { origin: true }
});
// code -> { code, token, mode, hostId, clients: Map<sid, {socketId, clientId}>, hostGoneTimer }
const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = Array.from(crypto.randomBytes(5), b => ALPHABET[b % ALPHABET.length]).join(''); } while (rooms.has(c)); return c; }
function closeRoom(room) { for (const c of room.clients.values()) io.to(c.socketId).emit('c:hostgone', { closed: true }); rooms.delete(room.code); }

io.on('connection', socket => {
  // Host screen creates a room (or reclaims it after a reconnect using its token).
  socket.on('h:create', (msg, ack) => {
    if (typeof ack !== 'function') return;
    let room = msg && rooms.get(String(msg.room || '').toUpperCase());
    const mode = msg && msg.mode === 'online' ? 'online' : 'class';
    if (room && room.token === msg.token) {
      clearTimeout(room.hostGoneTimer); room.hostGoneTimer = null;
      room.hostId = socket.id; room.mode = mode;
    } else {
      // After a server restart the room no longer exists: give the host its old code back (if free)
      // so the phones that keep retrying that code can join again without scanning a new QR.
      const wanted = String(msg?.room || '').toUpperCase();
      const code = /^[A-Z0-9]{5}$/.test(wanted) && !rooms.has(wanted) ? wanted : newCode();
      room = { code, token: crypto.randomBytes(16).toString('hex'), mode, hostId: socket.id, clients: new Map(), hostGoneTimer: null };
      rooms.set(room.code, room);
    }
    socket.data.role = 'host'; socket.data.room = room.code;
    socket.join('host:' + room.code);
    ack({ ok: true, room: room.code, token: room.token, mode: room.mode });
    // Phones that stayed connected while the host was away are re-announced and asked to re-join.
    for (const [sid, c] of room.clients) { socket.emit('h:open', { sid }); io.to(c.socketId).emit('c:rejoin'); }
    console.log(`[room ${room.code}] ${room.mode} host connected (${room.clients.size} clients)`);
  });

  // Phone joins a room.
  socket.on('c:join', (msg, ack) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(String(msg?.room || '').toUpperCase().trim());
    if (!room) return ack({ ok: false, error: 'no-room' });
    const max = room.mode === 'online' ? MAX_ONLINE_SOCKETS : MAX_PLAYERS;
    const clientIdIn = String(msg.clientId || '').slice(0, 80);
    const returning = [...room.clients.values()].some(c => clientIdIn && c.clientId === clientIdIn);
    if (!room.clients.has(socket.id) && !returning && room.clients.size >= max) return ack({ ok: false, error: 'full', mode: room.mode });
    // A phone that reconnects with the same clientId replaces its old socket.
    const clientId = String(msg.clientId || '').slice(0, 80);
    for (const [sid, c] of room.clients) if (clientId && c.clientId === clientId && sid !== socket.id) { room.clients.delete(sid); io.to(room.hostId).emit('h:close', { sid }); io.sockets.sockets.get(c.socketId)?.disconnect(true); }
    room.clients.set(socket.id, { socketId: socket.id, clientId });
    socket.data.role = 'client'; socket.data.room = room.code;
    socket.join('room:' + room.code);
    ack({ ok: true, hostOnline: !room.hostGoneTimer, mode: room.mode });
    if (!room.hostGoneTimer) io.to(room.hostId).emit('h:open', { sid: socket.id });
  });

  // Data: phone -> host, host -> one phone.
  socket.on('c:d', d => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.data.role !== 'client' || room.hostGoneTimer) return;
    io.to(room.hostId).emit('h:d', { sid: socket.id, d });
  });
  socket.on('h:d', msg => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id || !msg || !room.clients.has(msg.sid)) return;
    io.to(msg.sid).emit('c:d', msg.d);
  });
  // Online rooms: the host's browser runs the game and broadcasts compact snapshots to every guest screen.
  socket.on('h:bc', d => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id || room.mode !== 'online') return;
    socket.to('room:' + room.code).emit('c:snap', d);
  });
  socket.on('h:kick', msg => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id || !msg) return;
    const c = room.clients.get(msg.sid);
    if (c) { room.clients.delete(msg.sid); io.sockets.sockets.get(c.socketId)?.disconnect(true); }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    if (socket.data.role === 'client' && room.clients.get(socket.id)) {
      room.clients.delete(socket.id);
      io.to(room.hostId).emit('h:close', { sid: socket.id });
    } else if (socket.data.role === 'host' && room.hostId === socket.id) {
      for (const c of room.clients.values()) io.to(c.socketId).emit('c:hostgone', { closed: false });
      room.hostGoneTimer = setTimeout(() => closeRoom(room), HOST_GRACE_MS);
      console.log(`[room ${room.code}] host disconnected — waiting ${HOST_GRACE_MS / 1000}s`);
    }
  });
});

server.listen(PORT, () => console.log(`Chicken Horde server on :${PORT}`));
