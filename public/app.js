(() => {
  "use strict";
  const $ = (s) => document.querySelector(s), params = new URLSearchParams(location.search), hostMode = params.get("host") === "1", room = (params.get("room") || "").trim();
  const ioOptions = { transports: ["polling", "websocket"], reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 4e3, timeout: 15e3 };
  class Emitter {
    constructor() {
      this.h = {};
    }
    on(t, f) {
      (this.h[t] = this.h[t] || []).push(f);
      return this;
    }
    emit(t, ...a) {
      for (const f of this.h[t] || [])
        try {
          f(...a);
        } catch (e) {
          console.error(e);
        }
    }
  }
  function setupHowTo() {
    const box = $("#howto");
    if (!box) return;
    const open = () => {
      box.classList.remove("hidden");
      box.scrollTop = 0;
    }, close = () => box.classList.add("hidden");
    for (const b of document.querySelectorAll(".howto-btn"))
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.currentTarget.blur();
        open();
      });
    box.addEventListener("click", (e) => {
      if (e.target === box || e.target.closest(".howto-close")) close();
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }
  setupHowTo();
  if (hostMode) {
    $("#host").classList.remove("hidden");
    import("./renderer3d.mjs?v=10.0.0").then(({ createGameRenderer }) => initHost(createGameRenderer)).catch((error) => {
      console.error(error);
      $("#assetLoadStatus").textContent = "Could not start 3D rendering. Check your connection and reload.";
      $("#startBtn").disabled = true;
    });
  } else if (room) {
    $("#controller").classList.remove("hidden");
    initController(room);
  } else {
    $("#landing").classList.remove("hidden");
    $("#landingJoin").addEventListener("submit", (e) => {
      e.preventDefault();
      const c = $("#landingCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c.length >= 4) location.search = "?room=" + encodeURIComponent(c);
    });
  }
  function initHost(createGameRenderer) {
    let timeShift = 0, paused = false, godMode = false;
    const clock = () => performance.now() + timeShift;
    const canvas = $("#game"), lobby = $("#lobby"), roster = $("#roster"), players = /* @__PURE__ */ new Map();
    let started = false, gameOver = false, wave = 0, farmHp = 100, shots = [], carrots = [], enemyBeams = [], fireballs = [], enemies = [], drops = [], last = performance.now(), spawn = 0, remainingToSpawn = 0, elitesToSpawn = [], spawnGroups = [], tornadoesThisWave = 0, countdown = 0, audio = null, soundOn = false, lastShotSound = 0, henLastHit = 0, lastHenCry = 0, bloodSplats = [], musicOn = false, musicStarted = false, laserWave = 0, waveGroups = 0, waveElites = 0, fx = [], fxId = 0, dropId = 0;
    const reconnectGrace = 45e3, kickedIds = /* @__PURE__ */ new Set();
    const turret = { active: false, angle: Math.PI / 2, lastShot: 0, target: null, shotAt: 0 };
    let hulkWave = 0;
    const SEEKER_RATE = 260, SEEKER_RATE_RAPID = 150;
    const superChicken = { used: false, launchAt: 0, boomAt: 0, x: 900, y: 600 };
    const world = { w: 1800, h: 1200, home: { x: 900, y: 650 } };
    const assetStatus = $("#assetLoadStatus"), startButton = $("#startBtn"), obstacleCell = 240, obstacleGrid = /* @__PURE__ */ new Map();
    startButton.disabled = true;
    assetStatus.textContent = "Preloading 3D models\u2026";
    const trees = [], decor = [], H = world.home;
    let fenceId = 0;
    const addOb = (o) => {
      trees.push(o);
      return o;
    };
    const free = (x, y, r) => x > r + 40 && y > r + 40 && x < world.w - r - 40 && y < world.h - r - 40 && !trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.radius + r + 12);
    function fence(cx, cy, angle, len) {
      const id = fenceId++, n = Math.max(2, Math.round(len / 24));
      for (let i = 0; i <= n; i++) {
        const f = i / n - 0.5;
        addOb({ kind: "fence", x: cx + Math.cos(angle) * len * f, y: cy + Math.sin(angle) * len * f, radius: 10, low: true, fenceId: id, idx: i, angle });
      }
    }
    function hayRow(cx, cy, angle, count) {
      for (let i = 0; i < count; i++) {
        const f = i - (count - 1) / 2;
        addOb({ kind: "hay", x: cx + Math.cos(angle) * f * 44, y: cy + Math.sin(angle) * f * 44, radius: 21, low: true, angle });
      }
    }
    function log(cx, cy, angle) {
      addOb({ kind: "log", x: cx, y: cy, radius: 16, low: true, angle, len: 3 });
      for (const f of [-1, 1]) addOb({ kind: "logpart", x: cx + Math.cos(angle) * f * 30, y: cy + Math.sin(angle) * f * 30, radius: 15, low: true });
    }
    function rock(x, y, r, cover = false) {
      if (free(x, y, r)) addOb({ kind: "rock", x, y, radius: r, s: r * 1.4, cover, seed: (x * 7 + y * 13) % 17 });
    }
    function tree(x, y, s = 1) {
      if (free(x, y, 14)) addOb({ kind: "tree", x, y, radius: 14, s, seed: (x * 3 + y * 11) % 23, variant: Math.floor((x + y) / 37) % 3 });
    }
    for (const [dx, dy] of [
      [-38, -32],
      [38, -32],
      [-38, 30],
      [38, 30]
    ])
      addOb({ kind: "coop", x: H.x + dx, y: H.y + dy, radius: 40, low: true });
    const COOP_REACH = 84;
    for (const [dx, dy] of [
      [-165, -130],
      [165, -130],
      [-165, 135],
      [165, 135]
    ])
      rock(H.x + dx, H.y + dy, 20, true);
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4])
      hayRow(H.x + Math.cos(a) * 500, H.y + Math.sin(a) * 500 * 0.82, a + Math.PI / 2, 3);
    for (const side of [-1, 1]) {
      const cx = H.x + side * 585, cy = H.y - 20;
      rock(cx, cy - 70, 26);
      rock(cx + side * 22, cy + 8, 22);
      rock(cx - side * 8, cy + 82, 24);
    }
    for (const [x, y, a] of [
      [H.x - 260, H.y - 470, 0.2],
      [H.x + 270, H.y - 460, -0.25],
      [H.x - 300, H.y + 420, -0.15],
      [H.x + 310, H.y + 410, 0.3]
    ])
      log(x, y, a);
    for (const [x, y] of [
      [380, 380],
      [1420, 400],
      [400, 880],
      [1410, 860],
      [700, 300],
      [1100, 290],
      [560, 640],
      [1250, 700]
    ])
      tree(x, y, 0.85 + (x + y) % 5 * 0.08);
    for (const [x, y, r] of [
      [520, 560, 18],
      [1290, 560, 17],
      [760, 980, 16],
      [1050, 990, 18],
      [640, 240, 15],
      [1170, 220, 16]
    ])
      rock(x, y, r);
    for (let i = 0; i < 70; i++) {
      const x = (97 + i * 263) % world.w, y = (61 + i * 389) % world.h;
      if (Math.hypot(x - H.x, y - H.y) > 200 && free(x, y, 8))
        decor.push({ kind: i % 5 === 0 ? "pumpkin" : i % 3 === 0 ? "mushroom" : "flowers", x, y, seed: i });
    }
    for (const [dx, dy] of [
      [-120, 40],
      [120, 40],
      [-95, -60],
      [105, -55]
    ])
      decor.push({ kind: "pumpkin", x: H.x + dx, y: H.y + dy, seed: dx + dy });
    const grassTufts = [];
    for (let i = 0; i < 420; i++) {
      const x = (100 + i * 617 % 3400) * 0.5, y = (100 + i * 353 % 2200) * 0.5;
      if (Math.hypot(x - H.x, y - H.y) > 175 && !trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.radius + 14))
        grassTufts.push({ x, y, s: (34 + i * 13 % 24) * 0.5, r: i * 1.71 % 6.28 });
    }
    for (const t of trees) {
      const key = Math.floor(t.x / obstacleCell) + "," + Math.floor(t.y / obstacleCell), bucket = obstacleGrid.get(key) || [];
      bucket.push(t);
      obstacleGrid.set(key, bucket);
    }
    const game3d = createGameRenderer({ canvas, world, trees, decor, grassTufts, status: assetStatus, startButton });
    function send(p, force = false) {
      var _a;
      const now = clock();
      if (!force && now - (p.lastSend || 0) < 90) return;
      p.lastSend = now;
      try {
        if ((_a = p.conn) == null ? void 0 : _a.open)
          p.conn.send({
            type: "state",
            started,
            hp: Math.ceil(p.effects.HULK ? p.hulkHp : p.hp),
            color: p.color,
            name: p.name,
            revive: +(p.revive || 0).toFixed(2),
            laser: !!p.effects.LASER,
            seeker: !!p.effects.SEEKER,
            hulk: !!p.effects.HULK,
            wave
          });
      } catch {
      }
    }
    function rosterUpdate() {
      var _a;
      $("#playerCount").textContent = players.size;
      for (const target of [roster, $("#rosterInGame")]) {
        target.innerHTML = "";
        for (const p of players.values()) {
          const e = document.createElement("div");
          e.className = "roster-player" + (p.connected ? "" : " reconnecting");
          const avatar = document.createElement("span");
          avatar.className = "roster-avatar";
          avatar.style.setProperty("--chick", p.color);
          avatar.textContent = "\u{1F425}";
          const name = document.createElement("b");
          name.textContent = p.name;
          name.style.color = p.color;
          const status = document.createElement("small");
          status.textContent = p.connected ? "READY" : "RECONNECTING\u2026";
          const kick = document.createElement("button");
          kick.className = "kick-button";
          kick.textContent = "KICK";
          kick.setAttribute("aria-label", "Kick " + p.name);
          kick.onclick = () => kickPlayer(p);
          e.append(avatar, name, status, kick);
          target.append(e);
        }
      }
      (_a = $("#lobbyEmpty")) == null ? void 0 : _a.classList.toggle("hidden", players.size > 0);
    }
    function kickPlayer(p) {
      var _a, _b;
      if (p.conn && p.conn.local) {
        toggleLocalPlayer();
        return;
      }
      kickedIds.add(p.clientId);
      try {
        (_a = p.conn) == null ? void 0 : _a.send({ type: "kicked" });
      } catch {
      }
      try {
        (_b = p.conn) == null ? void 0 : _b.close();
      } catch {
      }
      clearTimeout(p.expireTimer);
      players.delete(p.id);
      rosterUpdate();
      toast(p.name + " removed from the lobby");
    }
    function bindPlayer(conn, p) {
      if (p.conn && p.conn !== conn) {
        try {
          p.conn.close();
        } catch {
        }
      }
      p.conn = conn;
      p.connected = true;
      p.lastSeen = clock();
      clearTimeout(p.expireTimer);
      conn.on("data", (d) => {
        var _a, _b;
        if (p.conn !== conn) return;
        if (d && d.type === "input") {
          p.lastSeen = clock();
          if (d.world) {
            p.move = { x: +d.move.x || 0, y: +d.move.y || 0 };
            p.aim = +d.aim || 0;
          } else {
            p.move = screenVectorToWorld(+((_a = d.move) == null ? void 0 : _a.x) || 0, +((_b = d.move) == null ? void 0 : _b.y) || 0);
            p.aim = screenAngleToWorld(+d.aim || 0);
          }
          p.fire = !!d.fire;
        } else if (d && d.type === "ping") p.lastSeen = clock();
      });
      conn.on("close", () => {
        if (p.conn !== conn) return;
        p.connected = false;
        p.move = { x: 0, y: 0 };
        p.fire = false;
        rosterUpdate();
        p.expireTimer = setTimeout(() => {
          if (!p.connected) {
            players.delete(p.id);
            rosterUpdate();
          }
        }, reconnectGrace);
        toast(p.name + " connection lost \u2014 waiting to reconnect");
      });
      rosterUpdate();
      send(p, true);
    }
    const scoreKey = "chicken-horde-high-scores-v1";
    function readScores() {
      try {
        const v = JSON.parse(localStorage.getItem(scoreKey) || "[]");
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    }
    function renderScores(target) {
      const list = readScores().sort((a, b) => b.score - a.score).slice(0, 10);
      target.innerHTML = list.length ? '<table class="score-table"><thead><tr><th>#</th><th>PLAYER</th><th>BEST</th><th>WAVE</th></tr></thead><tbody>' + list.map((s, i) => "<tr><td>".concat(i + 1, "</td><td>").concat(escapeText(s.name), "</td><td>").concat(s.score, "</td><td>").concat(s.wave, "</td></tr>")).join("") + "</tbody></table>" : '<p class="empty-scores">No scores yet. Start a game!</p>';
    }
    function escapeText(s) {
      const el = document.createElement("span");
      el.textContent = String(s);
      return el.innerHTML;
    }
    const boardMode = { lobbyScores: "global", finalScores: "global" };
    let globalCache = {};
    async function fetchGlobal(mode) {
      const key = mode;
      if (globalCache[key] && Date.now() - globalCache[key].at < 2e4) return globalCache[key].rows;
      const r = await fetch("/api/scores?mode=" + (mode === "week" ? "week" : "all"), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const rows = await r.json();
      globalCache[key] = { at: Date.now(), rows };
      return rows;
    }
    async function submitGlobal(list) {
      if (!list.length) return;
      try {
        const r = await fetch("/api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(list) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        globalCache = {};
        toast("Scores sent to the GLOBAL leaderboard \u{1F30E}");
        refreshScoreboards();
      } catch (e) {
        console.warn("Global leaderboard upload failed", e);
        toast("Could not reach the global leaderboard \u2014 scores saved on this PC");
      }
    }
    function tableHtml(list, global) {
      return list.length ? '<table class="score-table"><thead><tr><th>#</th><th>PLAYER</th><th>BEST</th><th>WAVE</th></tr></thead><tbody>' + list.map(
        (s, i) => "<tr".concat(i < 3 ? ' class="top'.concat(i + 1, '"') : "", "><td>").concat(["\u{1F947}", "\u{1F948}", "\u{1F949}"][i] || i + 1, "</td><td>").concat(escapeText(s.name), "</td><td>").concat(s.score, "</td><td>").concat(s.wave, "</td></tr>")
      ).join("") + "</tbody></table>" : '<p class="empty-scores">'.concat(global ? "No global scores yet \u2014 be the first!" : "No scores yet. Start a game!", "</p>");
    }
    async function renderBoard(id) {
      const target = $("#" + id);
      if (!target) return;
      const mode = boardMode[id], note = target.parentElement.querySelector(".board-note"), tabs = target.parentElement.querySelectorAll(".board-tabs button");
      tabs.forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === mode);
      });
      if (mode === "local") {
        renderScores(target);
        note.textContent = "Saved in this host browser";
        return;
      }
      note.textContent = "Loading global scores\u2026";
      try {
        const rows = await fetchGlobal(mode);
        if (boardMode[id] !== mode) return;
        target.innerHTML = tableHtml(rows, true);
        note.textContent = mode === "week" ? "Best players worldwide in the last 7 days" : "Best players worldwide \xB7 all time";
      } catch (e) {
        renderScores(target);
        note.textContent = "Global leaderboard unavailable \u2014 showing this PC";
      }
    }
    document.querySelectorAll(".board-tabs").forEach(
      (t) => t.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || b.disabled) return;
        boardMode[t.dataset.board] = b.dataset.mode;
        renderBoard(t.dataset.board);
      })
    );
    function refreshScoreboards() {
      renderBoard("lobbyScores");
      renderBoard("finalScores");
    }
    setInterval(() => {
      if (!started) refreshScoreboards();
    }, 6e4);
    function saveRun() {
      const scores = readScores();
      for (const p of players.values()) {
        const key = p.name.trim().toUpperCase(), row = scores.find((s) => s.key === key);
        if (row) {
          if (p.score > row.score) {
            row.score = p.score;
            row.wave = wave;
          }
          row.kills = Math.max(row.kills || 0, p.kills);
        } else scores.push({ key, name: p.name, score: p.score, wave, kills: p.kills });
      }
      scores.sort((a, b) => b.score - a.score);
      try {
        localStorage.setItem(scoreKey, JSON.stringify(scores.slice(0, 100)));
      } catch {
      }
      $("#runSummary").textContent = "The farm fell in wave ".concat(wave, ". Farm health: ").concat(Math.ceil(farmHp), "%.");
      $("#runScores").innerHTML = '<table class="score-table"><thead><tr><th>PLAYER</th><th>SCORE</th><th>KILLS</th></tr></thead><tbody>' + [...players.values()].sort((a, b) => b.score - a.score).map((p) => "<tr><td>".concat(escapeText(p.name), "</td><td>").concat(p.score, "</td><td>").concat(p.kills, "</td></tr>")).join("") + "</tbody></table>";
      refreshScoreboards();
      $("#gameOver").classList.remove("hidden");
      submitGlobal(
        [...players.values()].filter((p) => p.score > 0).map((p) => ({
          name: p.name.slice(0, 12),
          score: Math.floor(p.score),
          wave: Math.max(1, wave),
          kills: p.kills,
          players: Math.max(1, players.size),
          version: "10.0"
        }))
      );
    }
    function screenVectorToWorld(x, y) {
      return { x, y: y / 0.82 };
    }
    function screenAngleToWorld(a) {
      const v = screenVectorToWorld(Math.cos(a), Math.sin(a));
      return Math.atan2(v.y, v.x);
    }
    function hslHex(h, s, l) {
      s /= 100;
      l /= 100;
      const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return "#" + [f(0), f(8), f(4)].map(
        (v) => Math.round(v * 255).toString(16).padStart(2, "0")
      ).join("");
    }
    function choosePlayerColor() {
      const used = [...players.values()].map((p) => p.hue).filter((h) => h != null);
      let best = Math.random() * 360, bestD = -1;
      for (let i = 0; i < 36; i++) {
        const h = Math.random() * 360, d = used.length ? Math.min(...used.map((u) => Math.min(Math.abs(u - h), 360 - Math.abs(u - h)))) : 360;
        if (d > bestD) {
          bestD = d;
          best = h;
        }
      }
      const s = 72 + Math.random() * 18, l = 56 + Math.random() * 8;
      return { hue: best, color: hslHex(best, s, l) };
    }
    function addPlayer(conn, msg) {
      if (!msg || msg.type !== "join") return;
      const clientId = String(msg.clientId || conn.peer).slice(0, 80);
      if (kickedIds.has(clientId)) {
        try {
          conn.send({ type: "kicked" });
        } catch {
        }
        try {
          conn.close();
        } catch {
        }
        return;
      }
      let p = [...players.values()].find((v) => v.clientId === clientId);
      const name = String(msg.name || "CHICK").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 12) || "CHICK";
      if (!p) {
        const n = players.size, c = choosePlayerColor();
        p = {
          id: clientId,
          clientId,
          name,
          x: H.x - 75 + n % 4 * 50,
          y: H.y + 190 + Math.floor(n / 4) * 38,
          aim: 0,
          move: { x: 0, y: 0 },
          fire: false,
          hp: 100,
          effects: {},
          score: 0,
          kills: 0,
          lastHit: 0,
          conn: null,
          connected: false,
          color: c.color,
          hue: c.hue,
          revive: 0,
          joinedAt: clock()
        };
        players.set(p.id, p);
        if (!started) pushFx("join", p.x, p.y, { playerId: p.id });
      } else p.name = name;
      bindPlayer(conn, p);
    }
    let roomCode = "", hostToken = "";
    const net = { server: "connecting" }, conns = /* @__PURE__ */ new Map();
    try {
      const saved = JSON.parse(sessionStorage.getItem("chicken-horde-host") || "null");
      if (saved) {
        roomCode = saved.room || "";
        hostToken = saved.token || "";
      }
    } catch {
    }
    const socket = io(ioOptions);
    function onIncoming(conn) {
      conn.on("data", (d) => {
        if (d && d.type === "join") addPlayer(conn, d);
      });
    }
    function updateNet() {
      const label = { online: "\u2713 ONLINE", connecting: "\u2026 CONNECTING", reconnecting: "\u21BB RECONNECTING" }[net.server] || net.server;
      const el = $("#netStatus");
      if (el)
        el.innerHTML = '<span class="net-'.concat(net.server, '">SERVER ').concat(label, '</span><span class="net-online">\u{1F4F1} ').concat(conns.size, " PHONE").concat(conns.size === 1 ? "" : "S", "</span>");
      const sig = net.server;
      if (sig === updateNet.last) return;
      updateNet.last = sig;
      if (net.server === "reconnecting") toast("Connection to the server lost \u2014 reconnecting\u2026");
      else if (net.server === "online" && updateNet.wasDown) toast("Server connection restored");
      if (net.server !== "online") updateNet.wasDown = true;
    }
    function updateJoinInfo() {
      const u = new URL(location.origin + location.pathname);
      u.search = "?room=" + encodeURIComponent(roomCode);
      $("#roomCode").textContent = roomCode;
      $("#joinUrl").textContent = u.href;
      let qr = "";
      try {
        const q = window.qrcode(0, "M");
        q.addData(u.href);
        q.make();
        qr = q.createDataURL(8, 2);
      } catch (e) {
        console.warn("QR failed", e);
      }
      $("#qr").src = qr;
      $("#qrLarge").src = qr;
      $("#qrZoom img").src = qr;
      $("#qrZoom b").textContent = roomCode;
      $("#joinQrBtn").disabled = false;
    }
    function makeConn(sid) {
      var _a;
      (_a = conns.get(sid)) == null ? void 0 : _a.emit("close");
      const c = new Emitter();
      c.peer = sid;
      c.open = true;
      c.send = (d) => {
        if (c.open && socket.connected) socket.emit("h:d", { sid, d });
      };
      c.close = () => {
        if (!c.open) return;
        c.open = false;
        socket.emit("h:kick", { sid });
        conns.delete(sid);
        c.emit("close");
        updateNet.last = null;
        updateNet();
      };
      conns.set(sid, c);
      onIncoming(c);
      updateNet.last = null;
      updateNet();
      return c;
    }
    socket.on("connect", () => {
      socket.emit("h:create", { room: roomCode, token: hostToken }, (res) => {
        if (!res || !res.ok) {
          toast("The server could not open a room \u2014 retrying\u2026");
          setTimeout(() => socket.connected && socket.disconnect().connect(), 2e3);
          return;
        }
        const changed = res.room !== roomCode || !$("#qr").getAttribute("src");
        roomCode = res.room;
        hostToken = res.token;
        try {
          sessionStorage.setItem("chicken-horde-host", JSON.stringify({ room: roomCode, token: hostToken }));
        } catch {
        }
        if (changed) updateJoinInfo();
        net.server = "online";
        updateNet();
      });
    });
    socket.on("disconnect", () => {
      net.server = "reconnecting";
      for (const c of conns.values()) {
        c.open = false;
        c.emit("close");
      }
      conns.clear();
      updateNet();
    });
    socket.on("connect_error", () => {
      if (net.server !== "online") {
        net.server = "reconnecting";
        updateNet();
      }
    });
    socket.on("h:open", ({ sid }) => makeConn(sid));
    socket.on("h:d", ({ sid, d }) => {
      var _a;
      return (_a = conns.get(sid)) == null ? void 0 : _a.emit("data", d);
    });
    socket.on("h:close", ({ sid }) => {
      const c = conns.get(sid);
      if (c) {
        c.open = false;
        conns.delete(sid);
        c.emit("close");
        updateNet.last = null;
        updateNet();
      }
    });
    updateNet();
    {
      const z = $("#qrZoom"), q = $("#qr"), show = (v) => z.classList.toggle("show", v);
      q.addEventListener("mouseenter", () => show(true));
      q.addEventListener("mouseleave", () => show(false));
      q.addEventListener("click", () => show(!z.classList.contains("show")));
      z.addEventListener("click", () => show(false));
      $("#startBtn").addEventListener("click", () => show(false));
    }
    function startMatch() {
      var _a;
      if (started) return;
      (_a = $("#qrZoom")) == null ? void 0 : _a.classList.remove("show");
      startMusic();
      gameOver = false;
      $("#gameOver").classList.add("hidden");
      lobby.classList.add("hidden");
      $("#startBtn").disabled = true;
      $("#startBtn").textContent = "MATCH IN PROGRESS";
      farmHp = 100;
      wave = 0;
      shots = [];
      carrots = [];
      enemyBeams = [];
      fireballs = [];
      enemies = [];
      drops = [];
      bloodSplats = [];
      fx = [];
      remainingToSpawn = 0;
      pendingSpawns = [];
      laserWave = 0;
      turret.active = false;
      turret.angle = Math.PI / 2;
      Object.assign(superChicken, { used: false, launchAt: 0, boomAt: 0, boomed: false });
      hulkWave = 0;
      for (const p of players.values()) {
        p.hp = 100;
        p.effects = {};
        p.score = 0;
        p.kills = 0;
        p.revive = 0;
        p.deathAt = 0;
        p.move = { x: 0, y: 0 };
        p.fire = false;
        p.x = H.x - 90 + [...players.keys()].indexOf(p.id) % 4 * 60 + (Math.random() - 0.5) * 20;
        p.y = H.y + 190 + (Math.random() - 0.5) * 30;
        send(p, true);
      }
      startWave(1);
    }
    $("#startBtn").onclick = startMatch;
    $("#playAgain").onclick = () => {
      gameOver = false;
      $("#gameOver").classList.add("hidden");
      lobby.classList.remove("hidden");
      $("#startBtn").disabled = false;
      $("#startBtn").textContent = "START GAME";
      turret.active = false;
      drops = [];
      fx = [];
      for (const [i, p] of [...players.values()].entries()) {
        p.hp = 100;
        p.effects = {};
        p.deathAt = 0;
        p.revive = 0;
        p.move = { x: 0, y: 0 };
        p.fire = false;
        p.x = H.x - 75 + i % 4 * 50;
        p.y = H.y + 190 + Math.floor(i / 4) * 38;
        send(p, true);
      }
      rosterUpdate();
    };
    $("#joinQrBtn").onclick = () => {
      const panel = $("#joinQrPanel"), show = panel.classList.toggle("open");
      $("#joinQrBtn").setAttribute("aria-expanded", String(show));
    };
    $("#playersBtn").onclick = () => {
      const panel = $("#playersPanel"), show = panel.classList.toggle("open");
      $("#playersBtn").setAttribute("aria-expanded", String(show));
    };
    refreshScoreboards();
    rosterUpdate();
    let toastTimer = 0;
    function toast(t) {
      const el = $("#toast");
      el.textContent = t;
      el.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
    }
    function pushFx(kind, x, y, extra = {}) {
      fx.push({ id: ++fxId, kind, x, y, at: clock(), ...extra });
    }
    function tone(freq = 440, duration = 0.1, type = "sine", volume = 0.035) {
      if (!soundOn || !audio) return;
      try {
        const o = audio.createOscillator(), g = audio.createGain(), now = audio.currentTime;
        o.type = type;
        o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(Math.min(0.15, volume * 2.2), now);
        g.gain.exponentialRampToValueAtTime(1e-3, now + duration);
        o.connect(g);
        g.connect(audio.destination);
        o.start(now);
        o.stop(now + duration);
      } catch {
      }
    }
    function sweep(f1, f2, duration = 0.3, type = "sine", volume = 0.05) {
      if (!soundOn || !audio) return;
      try {
        const now = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1, now);
        o.frequency.exponentialRampToValueAtTime(f2, now + duration);
        g.gain.setValueAtTime(volume, now);
        g.gain.exponentialRampToValueAtTime(1e-3, now + duration);
        o.connect(g);
        g.connect(audio.destination);
        o.start(now);
        o.stop(now + duration + 0.02);
      } catch {
      }
    }
    function peep() {
      if (!soundOn || !audio) return;
      try {
        const now = audio.currentTime;
        for (const [at, f] of [
          [0, 2600],
          [0.13, 2900]
        ]) {
          const o = audio.createOscillator(), g = audio.createGain();
          o.type = "triangle";
          o.frequency.setValueAtTime(f, now + at);
          o.frequency.exponentialRampToValueAtTime(f * 0.72, now + at + 0.08);
          g.gain.setValueAtTime(1e-3, now + at);
          g.gain.linearRampToValueAtTime(0.07, now + at + 0.012);
          g.gain.exponentialRampToValueAtTime(1e-3, now + at + 0.09);
          o.connect(g);
          g.connect(audio.destination);
          o.start(now + at);
          o.stop(now + at + 0.1);
        }
      } catch {
      }
    }
    function teleportSound() {
      if (!soundOn || !audio) return;
      try {
        const now = audio.currentTime;
        const o = audio.createOscillator(), g = audio.createGain(), lfo = audio.createOscillator(), lg = audio.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(1600, now);
        o.frequency.exponentialRampToValueAtTime(220, now + 0.18);
        o.frequency.exponentialRampToValueAtTime(1900, now + 0.42);
        lfo.frequency.value = 38;
        lg.gain.value = 90;
        lfo.connect(lg);
        lg.connect(o.frequency);
        g.gain.setValueAtTime(1e-3, now);
        g.gain.linearRampToValueAtTime(0.06, now + 0.03);
        g.gain.exponentialRampToValueAtTime(1e-3, now + 0.48);
        o.connect(g);
        g.connect(audio.destination);
        o.start(now);
        lfo.start(now);
        o.stop(now + 0.5);
        lfo.stop(now + 0.5);
        [1318, 1760, 2349, 2637].forEach((f, i) => {
          const b = audio.createOscillator(), bg = audio.createGain(), t = now + 0.22 + i * 0.045;
          b.type = "triangle";
          b.frequency.value = f;
          bg.gain.setValueAtTime(1e-3, t);
          bg.gain.linearRampToValueAtTime(0.03, t + 0.01);
          bg.gain.exponentialRampToValueAtTime(1e-3, t + 0.25);
          b.connect(bg);
          bg.connect(audio.destination);
          b.start(t);
          b.stop(t + 0.27);
        });
      } catch {
      }
    }
    function chickDeathSound() {
      if (!soundOn || !audio) return;
      try {
        const now = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(920, now);
        o.frequency.exponentialRampToValueAtTime(370, now + 0.18);
        o.frequency.exponentialRampToValueAtTime(160, now + 0.62);
        g.gain.setValueAtTime(1e-3, now);
        g.gain.linearRampToValueAtTime(0.09, now + 0.04);
        g.gain.exponentialRampToValueAtTime(1e-3, now + 0.66);
        o.connect(g);
        g.connect(audio.destination);
        o.start(now);
        o.stop(now + 0.67);
      } catch {
      }
    }
    function henCry() {
      if (!soundOn || !audio) return;
      try {
        const now = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(720, now);
        o.frequency.exponentialRampToValueAtTime(1180, now + 0.08);
        o.frequency.exponentialRampToValueAtTime(560, now + 0.2);
        o.frequency.exponentialRampToValueAtTime(860, now + 0.28);
        o.frequency.exponentialRampToValueAtTime(430, now + 0.46);
        g.gain.setValueAtTime(1e-3, now);
        g.gain.linearRampToValueAtTime(0.045, now + 0.035);
        g.gain.setValueAtTime(0.04, now + 0.24);
        g.gain.exponentialRampToValueAtTime(1e-3, now + 0.48);
        o.connect(g);
        g.connect(audio.destination);
        o.start(now);
        o.stop(now + 0.49);
      } catch {
      }
    }
    const bgMusic = $("#bgMusic"), musicVolume = $("#musicVolume");
    bgMusic.volume = 0.32;
    function setMusic(enabled) {
      musicOn = enabled;
      $("#musicBtn").textContent = musicOn ? "\u266B MUSIC ON" : "\u266B MUSIC OFF";
      if (musicOn) {
        musicStarted = true;
        const playing = bgMusic.play();
        if (playing == null ? void 0 : playing.catch) playing.catch(() => toast("Tap MUSIC again if playback was blocked"));
      } else bgMusic.pause();
    }
    function startMusic() {
      if (!musicStarted) setMusic(true);
    }
    musicVolume.oninput = () => {
      bgMusic.volume = Number(musicVolume.value) / 100;
      $("#musicVolumeLabel").textContent = musicVolume.value + "%";
    };
    $("#musicBtn").onclick = () => setMusic(!musicOn);
    $("#soundBtn").onclick = async () => {
      soundOn = !soundOn;
      if (soundOn) {
        const Audio2 = window.AudioContext || window.webkitAudioContext;
        if (!Audio2) {
          soundOn = false;
          toast("Audio is not supported in this browser");
        } else {
          audio = audio || new Audio2();
          if (audio.state === "suspended") await audio.resume();
        }
      }
      $("#soundBtn").textContent = soundOn ? "SFX ON" : "SFX OFF";
      tone(620, 0.12, "triangle");
    };
    function collidesTree(x, y, r, shot = false) {
      const gx = Math.floor(x / obstacleCell), gy = Math.floor(y / obstacleCell), reach = Math.ceil((r + 90) / obstacleCell);
      for (let cx = gx - reach; cx <= gx + reach; cx++)
        for (let cy = gy - reach; cy <= gy + reach; cy++)
          for (const t of obstacleGrid.get(cx + "," + cy) || []) {
            if (shot && t.low) continue;
            if (Math.hypot(x - t.x, y - t.y) < (t.radius || t.s) + r + (shot ? 0 : 6)) return true;
          }
      return false;
    }
    function pathBlocked(x, y, nx, ny, r, shot = false) {
      const steps = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / 8));
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        if (collidesTree(x + (nx - x) * f, y + (ny - y) * f, r, shot)) return true;
      }
      return false;
    }
    function moveCircle(o, dx, dy, r) {
      const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8)), sx = dx / count, sy = dy / count;
      let x = o.x, y = o.y;
      for (let i = 0; i < count; i++) {
        const nx = Math.max(r, Math.min(world.w - r, x + sx));
        if (!collidesTree(nx, y, r)) x = nx;
        const ny = Math.max(r, Math.min(world.h - r, y + sy));
        if (!collidesTree(x, ny, r)) y = ny;
      }
      return { x, y };
    }
    function findSpawnPosition(radius) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const side = Math.floor(Math.random() * 4), x = side === 0 ? 90 : side === 1 ? world.w - 90 : 90 + Math.random() * (world.w - 180), y = side === 2 ? 90 : side === 3 ? world.h - 90 : 90 + Math.random() * (world.h - 180);
        if (!collidesTree(x, y, radius)) return { x, y };
      }
      return { x: H.x + 650, y: H.y + 450 };
    }
    function moveEnemy(e, dx, dy, r) {
      const clamp = (v, max) => Math.max(r, Math.min(max - r, v)), x = clamp(e.x + dx, world.w), y = clamp(e.y + dy, world.h);
      if (!pathBlocked(e.x, e.y, x, y, r)) {
        e.routeAngle = null;
        e.stuck = 0;
        return { x, y };
      }
      const base = Math.atan2(dy, dx), turns = [0, -0.42, 0.42, -0.82, 0.82, -1.25, 1.25, -1.72, 1.72, -2.35, 2.35, Math.PI], step = Math.max(12, Math.hypot(dx, dy));
      let best = null, bestScore = -Infinity;
      for (const turn of turns) {
        const a = base + turn, ux = Math.cos(a), uy = Math.sin(a), nx = clamp(e.x + ux * step, world.w), ny = clamp(e.y + uy * step, world.h);
        if (pathBlocked(e.x, e.y, nx, ny, r)) continue;
        let open = 0;
        for (const ahead of [24, 52]) if (!collidesTree(clamp(nx + ux * ahead, world.w), clamp(ny + uy * ahead, world.h), r)) open++;
        const score = Math.cos(turn) + open * 0.13 + (e.routeAngle == null ? 0 : Math.cos(a - e.routeAngle) * 0.16);
        if (score > bestScore) {
          bestScore = score;
          best = { x: nx, y: ny, angle: a };
        }
      }
      if (!best) {
        e.stuck = (e.stuck || 0) + 1;
        if (e.stuck > 20) {
          const obstacle = trees.reduce((a, t) => !a || Math.hypot(t.x - e.x, t.y - e.y) < Math.hypot(a.x - e.x, a.y - e.y) ? t : a, null);
          if (obstacle) {
            const away = Math.atan2(e.y - obstacle.y, e.x - obstacle.x);
            for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
              const a = away + turn, nx = clamp(obstacle.x + Math.cos(a) * ((obstacle.radius || obstacle.s) + r + 10), world.w), ny = clamp(obstacle.y + Math.sin(a) * ((obstacle.radius || obstacle.s) + r + 10), world.h);
              if (!collidesTree(nx, ny, r)) {
                e.stuck = 0;
                e.routeAngle = a;
                return { x: nx, y: ny };
              }
            }
          }
        }
        return { x: e.x, y: e.y };
      }
      e.stuck = 0;
      e.routeAngle = best.angle;
      return best;
    }
    let enemyGrid = /* @__PURE__ */ new Map();
    function buildEnemyGrid() {
      enemyGrid.clear();
      for (const e of enemies) {
        const key = Math.floor(e.x / 240) + "," + Math.floor(e.y / 240), bucket = enemyGrid.get(key) || [];
        bucket.push(e);
        enemyGrid.set(key, bucket);
      }
    }
    function nearbyEnemies(e, radius) {
      const out = [], gx = Math.floor(e.x / 240), gy = Math.floor(e.y / 240), reach = Math.ceil(radius / 240);
      for (let x = gx - reach; x <= gx + reach; x++)
        for (let y = gy - reach; y <= gy + reach; y++)
          for (const o of enemyGrid.get(x + "," + y) || []) if (o !== e && Math.hypot(o.x - e.x, o.y - e.y) < radius) out.push(o);
      return out;
    }
    const dropTypes = {
      SHIELD: "SHIELD",
      MEDKIT: "MEDKIT",
      DOUBLE: "DOUBLE SHOT",
      RAPID: "RAPID FIRE",
      TURRET: "CHICKEN TURRET",
      LASER: "CHICKEN LASER",
      SEEKER: "CHICKEN SEEKER",
      HULK: "CHICKEN HULK"
    };
    const pickupSounds = {
      SHIELD: new Audio("./assets/audio/powerup-shield.mp3"),
      DOUBLE: new Audio("./assets/audio/powerup-double-shot.mp3"),
      RAPID: new Audio("./assets/audio/powerup-rapid-fire.mp3"),
      LASER: new Audio("./assets/audio/powerup-laser.mp3"),
      TURRET: new Audio("./assets/audio/powerup-turret.mp3"),
      MEDKIT: new Audio("./assets/audio/powerup-medkit.mp3"),
      NEXTWAVE: new Audio("./assets/audio/next-wave.mp3"),
      SUPER: new Audio("./assets/audio/super-chicken.mp3"),
      SEEKER: new Audio("./assets/audio/powerup-seeker.mp3"),
      HULK: new Audio("./assets/audio/powerup-hulk.mp3")
    };
    const voiceSrc = { SMASH: "./assets/audio/hulk-smash.mp3" };
    function playVoice(k) {
      if (!soundOn) return;
      try {
        const a = new Audio(voiceSrc[k]);
        a.volume = 0.95;
        const pr = a.play();
        if (pr && pr.catch) pr.catch(() => {
        });
      } catch {
      }
    }
    const missingSounds = /* @__PURE__ */ new Set();
    for (const [k, a] of Object.entries(pickupSounds)) a.addEventListener("error", () => missingSounds.add(k));
    for (const sound of Object.values(pickupSounds)) {
      sound.preload = "auto";
      sound.volume = 0.85;
    }
    function playPickupSound(type) {
      if (!soundOn) return;
      const sound = pickupSounds[type];
      if (!sound || missingSounds.has(type)) {
        if (type === "SEEKER") {
          sweep(300, 1400, 0.25, "square", 0.05);
          setTimeout(() => sweep(500, 1800, 0.2, "square", 0.04), 180);
        } else if (type === "HULK") {
          sweep(90, 40, 0.7, "sawtooth", 0.12);
          setTimeout(() => sweep(160, 60, 0.5, "square", 0.08), 250);
        }
        return;
      }
      try {
        sound.pause();
        sound.currentTime = 0;
        const playing = sound.play();
        if (playing == null ? void 0 : playing.catch) playing.catch(() => {
        });
      } catch {
      }
    }
    const ELITE_NAMES = { BOSS: "CHUPACABRAS", MUSHROOM: "MUSHROOM KING", ALIENBOSS: "ALIEN OVERLORD", FIRELORD: "FIRE LORD", RABBIT: "CRAZY RABBIT" };
    const TAUNTS = {
      BOSS: ["GRRR... CHICKEN DINNER!", "I SMELL EGGS!", "NOBODY ESCAPES THE CHUPACABRAS!", "FEATHERS FOR BREAKFAST!", "HERE I COME!"],
      MUSHROOM: ["BOW TO THE FUNGUS KING!", "SPREAD THE SPORES!", "MY KINGDOM GROWS!", "MUSH... MUSH... CRUSH!", "ARISE, MY SPORELINGS!"],
      ALIENBOSS: [
        "RESISTANCE IS FUTILE, EARTHLINGS.",
        "TAKE ME TO YOUR HEN.",
        "PROBING SEQUENCE INITIATED.",
        "WHICH ONE IS REAL? HA HA HA!",
        "SHIELDS UP, PUNY CHICKENS."
      ],
      FIRELORD: ["YOU CANNOT SEE ME... BUT I SEE THE HEN.", "BURN, LITTLE FEATHERS!", "SILENCE BEFORE THE SCREAM...", "MAMA HEN WILL ROAST!"],
      RABBIT: ["CATCH ME IF YOU CAN! HEHEHE!", "SPECIAL DELIVERY! CARROTS!", "TOO SLOW, CHICKENS!", "BOOM-BOOM CARROTS!", "ZOOOOM!"]
    };
    const playerCount = () => Math.max(1, [...players.values()].filter((p) => p.connected).length || players.size);
    const bossHpScale = () => 1 + (playerCount() - 1) * 0.32;
    function raiseShield(e, now, dur, red, perPlayer) {
      e.shieldUntil = now + dur;
      e.shieldRed = red;
      e.shieldHp = e.shieldMax = perPlayer ? perPlayer * playerCount() : null;
      pushFx("shieldUp", e.x, e.y, { type: e.type });
    }
    function say(e, text, now) {
      e.say = { text, at: now };
    }
    function showWaveBanner() {
      const cd = $("#countdown");
      if (!cd) return;
      cd.dataset.v = "";
      cd.innerHTML = "WAVE ".concat(wave, "<small>").concat(wave === 5 ? "CHUPACABRAS \u2014 it drops the CHICKEN TURRET" : wave >= 13 ? "FIRE LORD + CRAZY RABBIT + MORE" : wave >= 11 ? "BEWARE THE INVISIBLE FIRE LORD" : wave >= 10 ? "MUSHROOM KING + ALIEN OVERLORD" : wave >= 8 ? "MUSHROOM KING INCOMING" : wave >= 6 ? "1 CHICKEN LASER hidden in this wave" : "DEFEND MAMA HEN!", "</small>");
      cd.classList.remove("pop");
      void cd.offsetWidth;
      cd.classList.add("show", "banner");
      setTimeout(() => {
        if (cd.classList.contains("banner")) cd.classList.remove("show", "banner");
      }, 1600);
    }
    function launchSuperChicken(now) {
      superChicken.used = true;
      superChicken.boomed = false;
      superChicken.launchAt = now;
      superChicken.boomAt = now + 1800;
      superChicken.x = world.w / 2;
      superChicken.y = world.h / 2;
      pushFx("superLaunch", H.x, H.y + 116, { to: { x: superChicken.x, y: superChicken.y }, flight: 1800 });
      superChicken.cluckAt = now;
      henCry();
      setTimeout(henCry, 260);
      setTimeout(henCry, 560);
      playPickupSound("SUPER");
      toast("MAMA HEN USED SUPER CHICKEN!");
    }
    function updateSuperChicken(now) {
      if (!superChicken.launchAt || superChicken.boomed || now < superChicken.boomAt) return;
      superChicken.boomed = true;
      pushFx("superBoom", superChicken.x, superChicken.y);
      let n = 0;
      for (const e of enemies)
        if (e.hp > 0) {
          e.hp = 0;
          n++;
          bloodSplats.push({ x: e.x, y: e.y, life: 7, size: 14, seed: Math.random() * 1e3, elite: !!e.elite });
          if (e.elite) pushFx("eliteDeath", e.x, e.y, { type: e.type });
        }
      fireballs = [];
      enemyBeams = [];
      sweep(120, 30, 1.2, "sawtooth", 0.12);
      const fl = $("#flash");
      if (fl) {
        fl.classList.remove("go");
        void fl.offsetWidth;
        fl.classList.add("go");
      }
      toast("BOOM! Super Chicken wiped out " + n + " enemies!");
    }
    function isNight(w = wave) {
      return w >= 10 && Math.floor(w / 10) % 2 === 1;
    }
    function endHulk(p, why) {
      if (!p.effects.HULK) return;
      const pre = p.preHulk || { hp: p.hp, effects: {} };
      const shield = p.effects.SHIELD;
      p.effects = Object.assign({}, pre.effects);
      if (shield) p.effects.SHIELD = Math.max(shield, clock() + 1500);
      else p.effects.SHIELD = clock() + 1500;
      p.hp = Math.max(1, pre.hp);
      p.hulkHp = 0;
      p.preHulk = null;
      pushFx("hulkEnd", p.x, p.y, { playerId: p.id });
      toast(why === "broken" ? p.name + " ran out of HULK power \u2014 back to normal!" : p.name + " is back to normal");
      send(p, true);
    }
    function startWave(next) {
      for (const p of players.values()) endHulk(p, "wave");
      const wasNight = isNight(wave);
      wave = next;
      if (isNight(next) !== wasNight && next > 1) nightBanner(isNight(next));
      const base = Math.ceil((6 + wave * 3 + Math.floor(Math.pow(wave, 1.35))) * 1.5), playerScale = 1 + Math.max(0, players.size - 1) * 0.25, regular = Math.ceil(base * playerScale), blocks = Math.ceil(regular * 4.5 / 20);
      spawnGroups = [];
      tornadoesThisWave = 0;
      for (let i = 0; i < blocks; i++) spawnGroups.push(...Math.random() < 0.5 ? [4, 4, 4, 4, 4] : [5, 5, 5, 5]);
      elitesToSpawn = [];
      if (wave === 5) elitesToSpawn.push("BOSS");
      if (wave >= 8) elitesToSpawn.push("MUSHROOM");
      if (wave >= 10) elitesToSpawn.push("ALIENBOSS");
      if (wave >= 11) elitesToSpawn.push("FIRELORD");
      if (wave >= 13) elitesToSpawn.push("RABBIT");
      remainingToSpawn = spawnGroups.reduce((sum, n) => sum + n, 0) + elitesToSpawn.length;
      waveGroups = spawnGroups.length;
      waveElites = elitesToSpawn.length;
      countdown = 3;
      started = true;
      spawn = 0.35;
      $("#wave").textContent = wave;
      tone(520, 0.16, "triangle");
    }
    function chooseEnemyType() {
      const available = ["FOX", "WOLF", "EAGLE"];
      if (wave >= 2) available.push("SNAKE");
      if (wave >= 3) available.push("MOLE");
      if (wave >= 4) available.push("TORNADO");
      if (wave >= 6) available.push("ALIEN");
      if (wave >= 7) available.push("MAGE");
      if (wave >= 8) available.push("GHOST");
      if (wave >= 9) available.push("PLANT");
      if (wave > 10) available.push("MECHAFROG");
      return available[Math.floor(Math.random() * available.length)];
    }
    function makeEnemy(type, x, y, p, now) {
      const difficulty = 1 + (wave - 1) * 0.11, speedScale = 1.3 * 0.87 * 0.85;
      let stats = {
        type,
        x,
        y,
        hitAt: 0,
        phase: Math.random() * 6.28,
        side: Math.random() < 0.5 ? -1 : 1,
        targetId: null,
        nextAbility: now + 2400 + Math.random() * 2200,
        nextFire: now + 1800 + Math.random() * 1e3,
        dashUntil: 0,
        jumpUntil: 0,
        bornAt: now
      };
      if (type === "WOLF")
        Object.assign(stats, { hp: Math.ceil(8 * difficulty), speed: 34 * speedScale, damage: 12 + Math.floor(p * 0.45), r: 30, icon: "\u{1F43A}" });
      else if (type === "EAGLE")
        Object.assign(stats, { hp: Math.ceil(3 * difficulty), speed: 85 * speedScale, damage: 3 + Math.floor(p * 0.18), r: 19, icon: "\u{1F985}" });
      else if (type === "SNAKE")
        Object.assign(stats, { hp: Math.max(1, Math.ceil(2 * difficulty)), speed: 125 * speedScale, damage: 3 + Math.floor(p * 0.12), r: 17, icon: "\u{1F40D}" });
      else if (type === "MOLE")
        Object.assign(stats, {
          hp: Math.ceil(5 * difficulty),
          speed: 46 * speedScale,
          damage: 7 + Math.floor(p * 0.2),
          r: 23,
          icon: "\u{1F439}",
          burrowUntil: 0,
          emergeAt: now + 1700 + Math.random() * 500,
          nextAbility: now + 4600
        });
      else if (type === "TORNADO")
        Object.assign(stats, {
          hp: Math.ceil(10 * difficulty),
          speed: 240 * speedScale,
          damage: 9 + Math.floor(p * 0.3),
          r: 29,
          icon: "\u{1F32A}\uFE0F",
          launchAt: now + 1500,
          travelAngle: Math.atan2(H.y - y, H.x - x),
          visualScale: 0.35
        });
      else if (type === "ALIEN")
        Object.assign(stats, { hp: Math.ceil(5 * difficulty), speed: 27 * speedScale, damage: 5 + Math.floor(p * 0.2), r: 24, icon: "\u{1F47D}" });
      else if (type === "MAGE")
        Object.assign(stats, { hp: Math.ceil(6 * difficulty), speed: 42 * speedScale, damage: 7 + Math.floor(p * 0.25), r: 23, icon: "\u{1F9D9}" });
      else if (type === "GHOST")
        Object.assign(stats, {
          hp: Math.ceil(4 * difficulty),
          speed: 52 * speedScale,
          damage: 8 + Math.floor(p * 0.25),
          r: 25,
          icon: "\u{1F47B}",
          nextEthereal: now + 1800 + Math.random() * 2500
        });
      else if (type === "PLANT")
        Object.assign(stats, {
          hp: Math.ceil(10 * difficulty),
          speed: 0,
          damage: (5 + Math.floor(p * 0.2)) * 0.9,
          r: 27,
          icon: "\u{1F331}",
          emergeAt: now + 1900 + Math.random() * 500
        });
      else if (type === "FOX")
        Object.assign(stats, { hp: Math.ceil(3 * difficulty), speed: 53 * speedScale, damage: 5 + Math.floor(p * 0.25), r: 23, icon: "\u{1F98A}" });
      else if (type === "MECHAFROG")
        Object.assign(stats, {
          hp: Math.ceil(22 * difficulty),
          speed: 30 * speedScale,
          shieldUntil: now + 6e3,
          shieldRed: 0.35,
          shieldHp: 10,
          shieldMax: 10,
          damage: 9 + Math.floor(p * 0.3),
          r: 30,
          icon: "\u{1F438}",
          nextAbility: now + 3e3 + Math.random() * 2e3,
          nextFire: now + 2500 + Math.random() * 1500
        });
      else if (type === "MUSHNUB") Object.assign(stats, { hp: 1, speed: 240 * speedScale, damage: 12, r: 15, icon: "\u{1F344}", nextAbility: now + 99999 });
      stats.damage = (stats.damage || 1) * 0.4;
      if (type === "TORNADO") {
        stats.damage = 2;
        stats.fire = isNight();
      }
      stats.maxHp = stats.hp;
      return stats;
    }
    function findHomeSpawn(radius) {
      for (let i = 0; i < 48; i++) {
        const a = Math.random() * Math.PI * 2, r = 220 + Math.random() * 130, x = H.x + Math.cos(a) * r, y = H.y + Math.sin(a) * r;
        if (x > radius && y > radius && x < world.w - radius && y < world.h - radius && !collidesTree(x, y, radius)) return { x, y };
      }
      return findSpawnPosition(radius);
    }
    function makeElite(type, x, y, p, now) {
      const speed = 27 * 1.3 * 0.87 * 0.85, base = {
        x,
        y,
        type,
        elite: true,
        name: ELITE_NAMES[type],
        hitAt: 0,
        phase: Math.random() * 6.28,
        side: 1,
        targetId: null,
        nextAbility: now + 2600,
        nextFire: now + 1500,
        dashUntil: 0,
        jumpUntil: 0,
        bornAt: now
      };
      if (type === "MUSHROOM") {
        const hp2 = Math.ceil(190 * (1 + p * 0.1) * 2 * bossHpScale());
        return Object.assign(base, {
          hp: hp2,
          maxHp: hp2,
          bars: 2,
          resist: 0.6,
          speed: speed * 0.82,
          damage: (22 + Math.floor(p * 0.6)) * 0.4,
          r: 44,
          icon: "\u{1F344}",
          nextAbility: now + 3200
        });
      }
      if (type === "ALIENBOSS") {
        const hp2 = Math.ceil(165 * (1 + p * 0.1) * 2 * bossHpScale());
        return Object.assign(base, {
          hp: hp2,
          maxHp: hp2,
          bars: 2,
          resist: 0.6,
          speed: speed * 1.1,
          damage: (18 + Math.floor(p * 0.5)) * 0.4,
          r: 40,
          icon: "\u{1F47D}",
          nextAbility: now + 5200,
          nextFire: now + 2200
        });
      }
      if (type === "FIRELORD") {
        const hp2 = Math.ceil(40 * (1 + p * 0.08) * (1 + (playerCount() - 1) * 0.15));
        return Object.assign(base, { hp: hp2, maxHp: hp2, speed: speed * 1.5, damage: 4, r: 34, icon: "\u{1F608}", revealUntil: 0, nextScream: now + 4e3 });
      }
      if (type === "RABBIT") {
        const hp2 = Math.ceil(80 * (1 + p * 0.09) * (1 + (playerCount() - 1) * 0.25));
        return Object.assign(base, { hp: hp2, maxHp: hp2, speed: 360, damage: 0, r: 28, icon: "\u{1F430}", mode: "in", modeUntil: 0, goal: null });
      }
      const hp = Math.ceil(115 * (1 + p * 0.11));
      return Object.assign(base, {
        type: "BOSS",
        hp,
        maxHp: hp,
        speed,
        damage: (24 + Math.floor(p * 0.7)) * 0.4,
        r: 46,
        icon: "\u{1F479}",
        nextAbility: now + 2200,
        nextFire: now + 1300
      });
    }
    function spawnElite(type, now) {
      const p = wave - 1, { x, y } = findSpawnPosition(46), e = makeElite(type, x, y, p, now);
      if (type === "BOSS" && wave === 5 && !turret.active) e.turretDrop = true;
      if (type === "MUSHROOM" && wave >= 8 && (wave - 8) % 5 === 0) e.seekerDrop = true;
      e.spawnUntil = now + (type === "BOSS" || type === "RABBIT" || type === "FIRELORD" ? 1300 : 2300);
      e.spawnAt = now;
      e.nextAbility = Math.max(e.nextAbility, e.spawnUntil + 1500);
      e.nextFire = Math.max(e.nextFire, e.spawnUntil + 800);
      if (type === "ALIENBOSS") {
        e.nextIllusion = e.spawnUntil + 6e3;
        e.nextShield = e.spawnUntil + 15e3 + 12e3;
        e.nextBlink = e.spawnUntil + 3500;
      }
      if (type === "ALIENBOSS" || type === "MUSHROOM") {
        raiseShield(e, e.spawnUntil, 15e3, type === "ALIENBOSS" ? 0.75 : 0.7, 30);
        e.shieldUntil = e.spawnUntil + 15e3;
      }
      if (type === "MUSHROOM") {
        e.nextSpores = e.spawnUntil + 250;
        e.nextShield = e.spawnUntil + 15e3 + 14e3;
      }
      if (type === "FIRELORD") e.nextScream = e.spawnUntil + 3500;
      if (type === "BOSS") e.nextLeap = e.spawnUntil + 3e3;
      e.nextTaunt = e.spawnUntil + 500;
      enemies.push(e);
      pushFx("eliteSpawn", x, y, { type });
      toast(e.name + " ELITE INCOMING!");
      tone(type === "MUSHROOM" ? 70 : type === "ALIENBOSS" ? 160 : 95, 0.55, "sawtooth", 0.065);
    }
    function spawnEnemy() {
      const p = wave - 1, now = clock();
      if (elitesToSpawn.length && waveGroups - spawnGroups.length >= waveGroups * (waveElites - elitesToSpawn.length + 1) / (waveElites + 1)) {
        spawnElite(elitesToSpawn.shift(), now);
        remainingToSpawn--;
        return;
      }
      if (wave >= 6 && Math.random() < 0.08 && !enemies.some((e) => e.type === "BOSS")) spawnElite("BOSS", now);
      let amount = spawnGroups.shift() || Math.min(4, remainingToSpawn - elitesToSpawn.length);
      if (amount <= 0) return;
      const type = chooseEnemyType();
      if ((type === "ALIEN" || type === "MECHAFROG") && amount > (type === "ALIEN" ? 3 : 2)) {
        const cap = type === "ALIEN" ? 3 : 2;
        spawnGroups.unshift(amount - cap);
        amount = cap;
      }
      const tornadoCount = type === "TORNADO" ? Math.min(amount, (wave > 10 ? 4 : 2) - tornadoesThisWave) : 0;
      if (tornadoCount) tornadoesThisWave += tornadoCount;
      const center = type === "MOLE" || type === "PLANT" ? findHomeSpawn(type === "PLANT" ? 34 : 26) : findSpawnPosition(28), { x, y } = center;
      for (let i = 0; i < amount; i++) {
        const enemyType = type === "TORNADO" && i >= tornadoCount ? "FOX" : type, angle = i / amount * Math.PI * 2 + Math.random() * 0.3, offset = i === 0 ? 0 : 58 + Math.random() * 46;
        let ex = x + Math.cos(angle) * offset, ey = y + Math.sin(angle) * offset, stats = makeEnemy(enemyType, ex, ey, p, now);
        if (i > 0 && collidesTree(ex, ey, stats.r)) {
          const spot = enemyType === "MOLE" || enemyType === "PLANT" ? findHomeSpawn(stats.r) : findSpawnPosition(stats.r);
          stats.x = spot.x;
          stats.y = spot.y;
        }
        enemies.push(stats);
      }
      remainingToSpawn -= amount;
    }
    function aimTarget(e) {
      let best = null, bestD = 780;
      for (const p of players.values()) {
        if (p.hp <= 0) continue;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      }
      const homeD = Math.hypot(H.x - e.x, H.y - e.y);
      return best && bestD < homeD + 240 ? { obj: best, type: "player" } : { obj: H, type: "farm" };
    }
    function reachable(x, y) {
      x = Math.max(70, Math.min(world.w - 70, x));
      y = Math.max(70, Math.min(world.h - 70, y));
      if (!collidesTree(x, y, 30)) return { x, y };
      for (let r = 30; r < 300; r += 20)
        for (let k = 0; k < 12; k++) {
          const a = k / 12 * Math.PI * 2, nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
          if (nx > 70 && ny > 70 && nx < world.w - 70 && ny < world.h - 70 && !collidesTree(nx, ny, 30)) return { x: nx, y: ny };
        }
      return { x: H.x, y: H.y + 200 };
    }
    function pushDrop(x, y, type, life) {
      ({ x, y } = reachable(x, y));
      drops.push({ id: ++dropId, x, y, type, label: dropTypes[type], life, maxLife: life, bornAt: clock() });
    }
    function dropPower(x, y, guaranteed = false) {
      if (wave >= 8 && wave % 8 === 0 && hulkWave !== wave && !drops.some((d) => d.type === "HULK")) {
        const late = remainingToSpawn === 0 && enemies.filter((e) => e.hp > 0).length <= 6;
        if (late || Math.random() < 0.035) {
          hulkWave = wave;
          pushDrop(x, y, "HULK", 45);
          toast("A unique CHICKEN HULK power-up appeared!");
          return;
        }
      }
      if (wave >= 6 && laserWave !== wave) {
        const nearEnd = remainingToSpawn === 0 && enemies.filter((e) => e.hp > 0).length <= 4;
        if (nearEnd || Math.random() < 0.045) {
          laserWave = wave;
          pushDrop(x, y, "LASER", 40);
          toast("A CHICKEN LASER dropped!");
          return;
        }
      }
      if (!guaranteed && Math.random() > 0.1) return;
      const roll = Math.random(), type = roll < 0.4 ? "SHIELD" : roll < 0.6 ? "MEDKIT" : roll < 0.85 ? "DOUBLE" : "RAPID";
      pushDrop(x, y, type, 24);
    }
    function awardKill(e, id) {
      if (e.scored) return;
      e.scored = true;
      const p = players.get(id);
      if (!p) return;
      const value = {
        FOX: 10,
        WOLF: 25,
        EAGLE: 15,
        SNAKE: 12,
        MOLE: 12,
        TORNADO: 22,
        ALIEN: 22,
        MAGE: 24,
        GHOST: 18,
        PLANT: 20,
        MECHAFROG: 30,
        MUSHNUB: 3,
        BOSS: 100,
        MUSHROOM: 150,
        ALIENBOSS: 175,
        FIRELORD: 120,
        RABBIT: 140
      }[e.type] || 10;
      p.kills++;
      p.score += value;
    }
    function damagePlayer(target, damage, now) {
      if (target.hp <= 0) return;
      if (now < (target.effects.SHIELD || 0)) return send(target);
      if (target.effects.HULK) {
        target.hulkHp = Math.max(0, (target.hulkHp || 100) - damage * 0.5);
        target.lastHit = now;
        if (target.hulkHp <= 0) endHulk(target, "broken");
        return send(target, true);
      }
      target.hp = Math.max(0, target.hp - damage);
      target.lastHit = now;
      if (target.hp === 0) {
        target.deathAt = now;
        target.revive = 0;
        if (target.effects.LASER || target.effects.SEEKER) {
          delete target.effects.LASER;
          delete target.effects.SEEKER;
          toast(target.name + " was knocked out and lost the special weapon");
        }
        chickDeathSound();
        pushFx("down", target.x, target.y, { playerId: target.id });
      } else if (now - (target.lastPeep || 0) > 320) {
        target.lastPeep = now;
        peep();
      }
      send(target, true);
    }
    function damageFarm(damage, now) {
      if (godMode || superChicken.launchAt && !superChicken.boomed) damage = 0;
      if (!superChicken.used && started && farmHp - damage <= 0) damage = Math.max(0, farmHp - 1);
      farmHp = Math.max(0, farmHp - damage);
      if (farmHp > 0 && farmHp <= 15 && !superChicken.used && started) launchSuperChicken(now);
      henLastHit = now;
      if (now - lastHenCry > 700) {
        lastHenCry = now;
        henCry();
      }
    }
    function applyEnemyDamage(choice, damage, now) {
      if (choice.type === "player") damagePlayer(choice.obj, damage, now);
      else damageFarm(damage, now);
    }
    const cloaked = (e, now) => e.type === "FIRELORD" && now >= (e.revealUntil || 0);
    function hittable(e, now) {
      return e.hp > 0 && !(now < (e.spawnUntil || 0)) && !(e.type === "PLANT" && now < (e.emergeAt || 0)) && !(e.type === "MOLE" && (now < e.burrowUntil || now < (e.emergeAt || 0))) && !(e.type === "ALIENBOSS" && now < (e.blinkUntil || 0));
    }
    function hitEnemy(e, damage, ownerId, now) {
      if (e.type === "GHOST" && now < (e.etherealUntil || 0)) {
        e.phaseHitAt = now;
        return;
      }
      if (e.resist) damage *= e.resist;
      if (e.type === "FIRELORD") e.revealUntil = Math.max(e.revealUntil || 0, now + 1200);
      if (now < (e.shieldUntil || 0)) {
        const red = e.shieldRed != null ? e.shieldRed : e.illusion ? 0.25 : 0.75;
        if (e.shieldHp != null) {
          e.shieldHp -= damage;
          if (e.shieldHp <= 0) {
            e.shieldUntil = now;
            pushFx("shieldBreak", e.x, e.y, { type: e.type });
            sweep(1400, 200, 0.35, "square", 0.05);
          }
        }
        damage *= 1 - red;
        e.shieldHitAt = now;
      }
      if (e.type === "MAGE" && players.has(ownerId) && !e.aggroId) {
        e.aggroId = ownerId;
        e.say = { text: "HOW DARE YOU!", at: now };
      }
      e.hp -= damage;
      e.lastHitBy = ownerId;
      e.hitUntil = now + 100;
      if (e.hp <= 0) {
        bloodSplats.push({ x: e.x, y: e.y, life: 7, size: 12 + Math.random() * 8, seed: Math.random() * 1e3, elite: !!e.elite });
        if (e.illusion) {
          pushFx("illusionPop", e.x, e.y);
          e.scored = true;
          const pl = players.get(ownerId);
          if (pl) pl.score += 10;
          return;
        }
        if (e.type === "ALIENBOSS") {
          for (const o of enemies)
            if (o.illusion && o.ownerRef === e && o.hp > 0) {
              o.hp = 0;
              pushFx("illusionPop", o.x, o.y);
            }
        }
        awardKill(e, ownerId);
        if (e.type === "MECHAFROG") mechExplode(e, now);
        if (e.turretDrop && !turret.active && !drops.some((d) => d.type === "TURRET")) {
          pushDrop(e.x, e.y, "TURRET", Infinity);
          toast("The Chupacabras dropped a CHICKEN TURRET! Grab it!");
        } else if (e.seekerDrop) {
          pushDrop(e.x, e.y, "SEEKER", Infinity);
          toast("The Mushroom King dropped the CHICKEN SEEKER! Homing missiles!");
        } else dropPower(e.x, e.y, !!e.elite);
        if (e.elite) pushFx("eliteDeath", e.x, e.y, { type: e.type });
        tone(125, 0.14, "sawtooth", 0.05);
        setTimeout(() => tone(70, 0.2, "triangle", 0.04), 45);
      } else tone(210, 0.035, "triangle", 0.012);
    }
    function beamHitsPoint(x1, y1, x2, y2, px, py, r) {
      const vx = x2 - x1, vy = y2 - y1, l2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2));
      return Math.hypot(x1 + vx * t - px, y1 + vy * t - py) < r;
    }
    function beamLength(x, y, a, max) {
      for (let step = 24; step < max; step += 12) if (collidesTree(x + Math.cos(a) * step, y + Math.sin(a) * step, 4, true)) return step;
      return max;
    }
    function updateEnemy(e, dt, now) {
      if (now < (e.spawnUntil || 0)) return;
      if ((e.type === "MOLE" || e.type === "PLANT") && now < (e.emergeAt || 0)) return;
      if (e.elite && !e.illusion && now >= (e.nextTaunt || 0)) {
        e.nextTaunt = now + 9e3 + Math.random() * 6e3;
        say(e, TAUNTS[e.type][Math.floor(Math.random() * TAUNTS[e.type].length)], now);
      }
      if (e.leapUntil && now < e.leapUntil) {
        const k = 1 - (e.leapUntil - now) / e.leapDur;
        e.x = e.leapFrom.x + (e.leapTo.x - e.leapFrom.x) * k;
        e.y = e.leapFrom.y + (e.leapTo.y - e.leapFrom.y) * k;
        return;
      }
      if (e.leapUntil && !e.landed) {
        e.landed = true;
        landLeap(e, now);
      }
      if (e.type === "TORNADO") {
        if (now < e.launchAt) {
          e.visualScale = 0.35 + 0.8 * Math.min(1, (now - e.bornAt) / 1500);
          return;
        }
        e.visualScale = 1.2;
        e.x += Math.cos(e.travelAngle) * e.speed * dt;
        e.y += Math.sin(e.travelAngle) * e.speed * dt;
        if (now - e.hitAt > 850) {
          for (const p of players.values())
            if (p.hp > 0 && Math.hypot(p.x - e.x, p.y - e.y) < e.r + 27) {
              e.hitAt = now;
              applyEnemyDamage({ obj: p, type: "player" }, e.damage, now);
              break;
            }
          if (now - e.hitAt > 850 && Math.hypot(H.x - e.x, H.y - e.y) < e.r + 65) {
            e.hitAt = now;
            applyEnemyDamage({ obj: H, type: "farm" }, e.damage, now);
          }
        }
        if (e.x < -100 || e.y < -100 || e.x > world.w + 100 || e.y > world.h + 100) e.hp = 0;
        return;
      }
      if (e.type === "GHOST" && now >= (e.nextEthereal || Infinity)) {
        e.etherealUntil = now + 1400;
        e.nextEthereal = now + 4200 + Math.random() * 2600;
      }
      if (e.type === "FIRELORD") return updateFireLord(e, dt, now);
      if (e.type === "RABBIT") return updateRabbit(e, dt, now);
      let choice = aimTarget(e);
      if (e.type === "MAGE") {
        const ag = e.aggroId && players.get(e.aggroId);
        choice = ag && ag.hp > 0 ? { obj: ag, type: "player" } : { obj: H, type: "farm" };
      }
      if (e.illusion) {
        const ps = [...players.values()].filter((p) => p.hp > 0);
        if (!e.fakeTarget || Math.random() < 4e-3)
          e.fakeTarget = Math.random() < 0.5 || !ps.length ? { x: H.x + (Math.random() - 0.5) * 500, y: H.y + (Math.random() - 0.5) * 400 } : ps[Math.floor(Math.random() * ps.length)];
        choice = { obj: e.fakeTarget, type: "decoy" };
      }
      const pack = nearbyEnemies(e, 240);
      if (e.type === "WOLF") {
        const focused = pack.find((o) => o.type === "WOLF" && o.targetId && players.has(o.targetId));
        if (focused) {
          const p = players.get(focused.targetId);
          if (p && p.hp > 0) choice = { obj: p, type: "player" };
        }
      }
      let target = choice.obj, dx = target.x - e.x, dy = target.y - e.y, d = Math.hypot(dx, dy) || 1;
      e.targetId = choice.type === "player" ? target.id : null;
      e.facing = Math.atan2(dy, dx);
      let vx = dx / d, vy = dy / d;
      if (e.type === "BOSS" && wave > 7 && now >= (e.nextLeap || 0)) {
        const tgt = [...players.values()].filter((p) => p.hp > 0).sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0];
        const dd = tgt ? Math.hypot(tgt.x - e.x, tgt.y - e.y) : 1e9;
        if (tgt && dd < 520 && dd > 120) {
          e.nextLeap = now + 6500 + Math.random() * 3500;
          startLeap(e, tgt.x, tgt.y, 700, now, "chupa");
          say(e, "POUNCE!", now);
          return;
        } else e.nextLeap = now + 1200;
      }
      if (e.type === "BOSS" && d < 760 && now >= (e.nextFire || 0)) {
        e.nextFire = now + 2600;
        e.attackAt = now;
        const angle = Math.atan2(dy, dx), speed2 = 310;
        fireballs.push({
          x: e.x + Math.cos(angle) * 32,
          y: e.y + Math.sin(angle) * 32,
          dx: Math.cos(angle) * speed2,
          dy: Math.sin(angle) * speed2,
          t: 3.2,
          damage: 5.6,
          kind: "fire"
        });
        tone(145, 0.24, "sawtooth", 0.045);
      }
      if (e.type === "MUSHROOM" && now >= (e.nextSpores || 0)) {
        e.nextSpores = now + 9500 + Math.random() * 3e3;
        e.attackAt = now;
        say(e, "ARISE, MY SPORELINGS!", now);
        const spots = [];
        const ps = [...players.values()].filter((p) => p.hp > 0);
        for (let i = 0; i < 5; i++) {
          const base = i < 2 && ps.length ? ps[Math.floor(Math.random() * ps.length)] : i % 2 ? H : e;
          const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 170, x = Math.max(60, Math.min(world.w - 60, base.x + Math.cos(a) * r)), y = Math.max(60, Math.min(world.h - 60, base.y + Math.sin(a) * r));
          if (!collidesTree(x, y, 16)) spots.push({ x, y });
        }
        pushFx("sporeRain", e.x, e.y, { spots });
        for (const sp of spots) pendingSpawns.push({ at: now + 1300, type: "MUSHNUB", x: sp.x, y: sp.y });
      }
      if (e.type === "MUSHROOM" && now >= (e.nextShield || Infinity)) {
        e.nextShield = now + 29e3;
        raiseShield(e, now, 15e3, 0.7, 30);
        say(e, "THE MYCELIUM PROTECTS ME!", now);
      }
      if (e.type === "MUSHROOM" && now >= e.nextAbility) {
        e.nextAbility = now + 4600;
        e.attackAt = now;
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2 + e.phase, speed2 = 200;
          fireballs.push({
            x: e.x + Math.cos(a) * 36,
            y: e.y + Math.sin(a) * 36,
            dx: Math.cos(a) * speed2,
            dy: Math.sin(a) * speed2,
            t: 2.6,
            damage: 4,
            kind: "spore"
          });
        }
        pushFx("sporeBurst", e.x, e.y);
        sweep(180, 60, 0.45, "triangle", 0.06);
      }
      if (e.type === "ALIENBOSS") {
        if (!e.illusion && now >= (e.nextShield || 0)) {
          e.nextShield = now + 27e3;
          raiseShield(e, now, 15e3, 0.75, 30);
          say(e, "SHIELDS UP, PUNY CHICKENS.", now);
          sweep(200, 1200, 0.5, "sine", 0.05);
        }
        if (e.illusion && now >= (e.nextShield || 0)) {
          e.nextShield = now + 14e3 + Math.random() * 6e3;
          e.shieldUntil = now + 5e3;
          e.shieldRed = 0.25;
          e.shieldHp = null;
        }
        if (!e.illusion && now >= (e.nextIllusion || 0) && enemies.filter((o) => o.illusion && o.ownerRef === e && o.hp > 0).length === 0) {
          e.nextIllusion = now + 2e4;
          say(e, "WHICH ONE IS REAL? HA HA HA!", now);
          const ratio = e.hp / e.maxHp;
          for (let i = 0; i < 3; i++) {
            const a = i / 3 * Math.PI * 2 + Math.random(), x = Math.max(80, Math.min(world.w - 80, e.x + Math.cos(a) * 140)), y = Math.max(80, Math.min(world.h - 80, e.y + Math.sin(a) * 140)), hp = Math.max(1, Math.ceil(e.hp * 0.25));
            const c = Object.assign(makeElite("ALIENBOSS", x, y, wave - 1, now), {
              illusion: true,
              shieldUntil: 0,
              shieldHp: null,
              ownerRef: e,
              hp,
              maxHp: Math.max(hp, Math.round(hp / Math.max(0.05, ratio))),
              nextShield: now + 2e3 + Math.random() * 4e3,
              nextBlink: now + 3e3 + Math.random() * 3e3,
              nextFire: now + 1500 + Math.random() * 1500,
              teleportAt: now,
              nextTaunt: Infinity
            });
            enemies.push(c);
            pushFx("teleport", e.x, e.y, { to: { x, y }, color: "#c46bff" });
          }
          sweep(600, 2400, 0.4, "sine", 0.04);
        }
        if (now >= (e.nextBlink || 0)) {
          e.nextBlink = now + (e.illusion ? 5500 : 7500) + Math.random() * 2500;
          const hd = Math.hypot(H.x - e.x, H.y - e.y), goal = e.illusion && e.fakeTarget ? e.fakeTarget : H, gd = Math.hypot(goal.x - e.x, goal.y - e.y);
          if (gd > 230) {
            const step = Math.min(gd - 170, 320), a = Math.atan2(goal.y - e.y, goal.x - e.x) + (Math.random() - 0.5) * 0.6, tx = Math.max(80, Math.min(world.w - 80, e.x + Math.cos(a) * step)), ty = Math.max(80, Math.min(world.h - 80, e.y + Math.sin(a) * step));
            if (!collidesTree(tx, ty, e.r)) {
              pushFx("ufoBlink", e.x, e.y, { to: { x: tx, y: ty } });
              e.x = tx;
              e.y = ty;
              e.blinkUntil = now + 300;
              e.teleportAt = now;
              if (!e.illusion) theremin();
            }
          }
        }
        if (d < 720 && now >= e.nextFire) {
          e.nextFire = now + (e.illusion ? 3600 : 3100);
          e.attackAt = now;
          for (const off of [-0.24, 0, 0.24]) {
            const a = Math.atan2(dy, dx) + off, len = beamLength(e.x, e.y, a, Math.min(640, d + 120)), x2 = e.x + Math.cos(a) * len, y2 = e.y + Math.sin(a) * len;
            enemyBeams.push({ x1: e.x + Math.cos(a) * 30, y1: e.y + Math.sin(a) * 30, x2, y2, t: 0.4, color: "#c46bff", width: 2 });
            if (e.illusion) continue;
            for (const p of players.values()) if (p.hp > 0 && beamHitsPoint(e.x, e.y, x2, y2, p.x, p.y, 28)) damagePlayer(p, 6, now);
            if (off === 0 && choice.type === "farm" && len >= d - 70) damageFarm(6, now);
          }
          if (!e.illusion) sweep(900, 300, 0.3, "sawtooth", 0.04);
        }
      }
      if (e.type === "MECHAFROG") {
        if (now >= e.nextAbility && d < 420 && d > 90) {
          e.nextAbility = now + 5200 + Math.random() * 2500;
          startLeap(e, target.x, target.y, 650, now, "frog");
          return;
        }
        if (now >= e.nextFire && d < 620) {
          e.nextFire = now + 4200 + Math.random() * 1200;
          e.attackAt = now;
          const base = Math.atan2(dy, dx);
          for (const off of [-0.35, 0, 0.35]) {
            const a = base + off;
            fireballs.push({
              x: e.x + Math.cos(a) * 30,
              y: e.y + Math.sin(a) * 30,
              dx: Math.cos(a) * 285,
              dy: Math.sin(a) * 285,
              t: 2.6,
              damage: 4,
              kind: "rocket",
              homing: choice.type === "player" ? target.id : "farm"
            });
          }
          tone(220, 0.12, "square", 0.03);
        }
      }
      const reach = choice.type === "farm" ? e.r + COOP_REACH : e.r + 31;
      if (e.type === "MUSHNUB" && d < (choice.type === "farm" ? reach : e.r + 34)) {
        explodeMushnub(e, now);
        return;
      }
      if (e.type === "ALIEN" && d < 335 && now >= e.nextFire) {
        e.nextFire = now + 3e3;
        let length = d, blocked = false;
        for (let step = 24; step < d; step += 20)
          if (collidesTree(e.x + vx * step, e.y + vy * step, 5, true)) {
            length = step;
            blocked = true;
            break;
          }
        enemyBeams.push({ x1: e.x + vx * 20, y1: e.y + vy * 20, x2: e.x + vx * length, y2: e.y + vy * length, t: 0.24, color: "#7cfff0" });
        if (!blocked) applyEnemyDamage(choice, e.damage * 1.5, now);
        tone(780, 0.12, "sawtooth", 0.035);
      }
      if (e.type === "PLANT" && d < 650 && now >= e.nextFire) {
        e.nextFire = now + 1950;
        e.attackAt = now;
        const angle = Math.atan2(dy, dx), speed2 = 260;
        fireballs.push({
          x: e.x + Math.cos(angle) * 28,
          y: e.y + Math.sin(angle) * 28,
          dx: Math.cos(angle) * speed2,
          dy: Math.sin(angle) * speed2,
          t: 3.1,
          damage: e.damage,
          kind: "seed"
        });
        tone(360, 0.07, "triangle", 0.025);
      }
      if (e.type === "MAGE" && d > 230 && now >= e.nextAbility) {
        e.nextAbility = now + 4200 + Math.random() * 1e3;
        const angle = Math.random() * Math.PI * 2, tx = Math.max(70, Math.min(world.w - 70, target.x + Math.cos(angle) * 190)), ty = Math.max(70, Math.min(world.h - 70, target.y + Math.sin(angle) * 190));
        if (!collidesTree(tx, ty, e.r)) {
          pushFx("teleport", e.x, e.y, { to: { x: tx, y: ty }, color: "#9d6bff" });
          e.x = tx;
          e.y = ty;
          e.teleportUntil = now + 450;
          e.teleportAt = now;
          teleportSound();
        }
      }
      if (e.type === "MOLE" && now >= e.nextAbility) {
        e.nextAbility = now + 5100;
        e.burrowUntil = now + 900;
      }
      const nearby = pack.filter((o) => Math.hypot(o.x - e.x, o.y - e.y) < 150).length, flank = Math.sin(now / 430 + e.phase) * (0.16 + Math.min(0.5, nearby * 0.08)) * e.side;
      vx += -dy / d * flank;
      vy += dx / d * flank;
      if (e.type === "FOX" && now > e.nextAbility && d > 145) {
        e.nextAbility = now + 3800 + Math.random() * 3e3;
        e.dashUntil = now + 360;
        e.jumpUntil = e.dashUntil;
      }
      if (e.type === "EAGLE" && now > e.nextAbility && d > 140) {
        e.nextAbility = now + 4200 + Math.random() * 2400;
        e.dashUntil = now + 850;
        e.dashX = target.x;
        e.dashY = target.y;
      }
      let speed = e.speed;
      if (e.type === "FOX" && now < e.dashUntil) speed *= 2.55;
      if (e.type === "EAGLE" && now < e.dashUntil) {
        const ddx = e.dashX - e.x, ddy = e.dashY - e.y, dd = Math.hypot(ddx, ddy) || 1;
        vx = ddx / dd;
        vy = ddy / dd;
        speed *= 2.8;
      }
      if (e.type === "PLANT") return;
      if (d > reach && speed > 0) {
        const dxm = vx / Math.hypot(vx, vy) * speed * dt, dym = vy / Math.hypot(vx, vy) * speed * dt;
        const oldX = e.x, oldY = e.y;
        let pos;
        if (e.type === "GHOST" || e.type === "EAGLE" || e.type === "MOLE" && now < e.burrowUntil) {
          pos = { x: Math.max(e.r, Math.min(world.w - e.r, e.x + dxm)), y: Math.max(e.r, Math.min(world.h - e.r, e.y + dym)) };
        } else pos = moveEnemy(e, dxm, dym, e.r);
        e.x = pos.x;
        e.y = pos.y;
        const moved = Math.hypot(e.x - oldX, e.y - oldY);
        e.moving = moved > 0.01;
        if (e.moving) e.facing = Math.atan2(e.y - oldY, e.x - oldX);
      } else {
        e.moving = false;
        if (now - e.hitAt > 780 && !e.illusion && choice.type !== "decoy") {
          e.hitAt = now;
          e.attackAt = now;
          applyEnemyDamage(choice, e.damage, now);
        }
      }
    }
    function startLeap(e, tx, ty, dur, now, kind) {
      const a = Math.atan2(ty - e.y, tx - e.x), dist = Math.min(Math.hypot(tx - e.x, ty - e.y), 520);
      let gx = e.x + Math.cos(a) * dist, gy = e.y + Math.sin(a) * dist;
      gx = Math.max(e.r, Math.min(world.w - e.r, gx));
      gy = Math.max(e.r, Math.min(world.h - e.r, gy));
      for (let k = 0; k < 6 && collidesTree(gx, gy, e.r); k++) {
        gx -= Math.cos(a) * 40;
        gy -= Math.sin(a) * 40;
      }
      e.leapFrom = { x: e.x, y: e.y };
      e.leapTo = { x: gx, y: gy };
      e.leapDur = dur;
      e.leapUntil = now + dur;
      e.leapAt = now;
      e.leapKind = kind;
      e.landed = false;
      e.facing = a;
      sweep(kind === "frog" ? 320 : 140, kind === "frog" ? 700 : 260, 0.25, "square", 0.04);
    }
    function landLeap(e, now) {
      const big = e.leapKind === "chupa", R = big ? 95 : 85, dmg = big ? e.damage * 1.4 : 6;
      pushFx("crater", e.x, e.y, { big });
      for (const p of players.values()) if (p.hp > 0 && Math.hypot(p.x - e.x, p.y - e.y) < R) damagePlayer(p, dmg, now);
      if (Math.hypot(H.x - e.x, H.y - e.y) < R + 80) damageFarm(dmg * 0.6, now);
      tone(60, 0.35, "sawtooth", 0.08);
    }
    function explodeMushnub(e, now) {
      if (e.hp <= 0) return;
      e.hp = 0;
      e.scored = true;
      pushFx("mushBoom", e.x, e.y);
      for (const p of players.values()) if (p.hp > 0 && Math.hypot(p.x - e.x, p.y - e.y) < 62) damagePlayer(p, e.damage, now);
      if (Math.hypot(H.x - e.x, H.y - e.y) < 125) damageFarm(e.damage * 0.5, now);
      tone(180, 0.12, "square", 0.05);
    }
    function mechExplode(e, now) {
      pushFx("mechBoom", e.x, e.y);
      for (const p of players.values()) if (p.hp > 0 && Math.hypot(p.x - e.x, p.y - e.y) < 78) damagePlayer(p, 8, now);
      if (Math.hypot(H.x - e.x, H.y - e.y) < COOP_REACH + 70) damageFarm(4, now);
      tone(90, 0.3, "sawtooth", 0.07);
    }
    const SCREAM_RANGE = 330, SCREAM_SPREAD = 0.55;
    function updateFireLord(e, dt, now) {
      const dx = H.x - e.x, dy = H.y - e.y, d = Math.hypot(dx, dy) || 1;
      if (e.screamFireAt) {
        e.moving = false;
        if (now >= e.screamFireAt) {
          const a = e.screamAngle;
          e.screamFireAt = 0;
          e.attackAt = now;
          pushFx("sonicScream", e.x, e.y, { a, range: SCREAM_RANGE, spread: SCREAM_SPREAD });
          const inCone = (x, y, r = 0) => {
            const dd = Math.hypot(x - e.x, y - e.y);
            if (dd > SCREAM_RANGE + r) return false;
            const da = Math.abs(Math.atan2(Math.sin(Math.atan2(y - e.y, x - e.x) - a), Math.cos(Math.atan2(y - e.y, x - e.x) - a)));
            return da < SCREAM_SPREAD + Math.atan2(r, Math.max(1, dd));
          };
          for (const p of players.values()) if (p.hp > 0 && inCone(p.x, p.y, 20)) damagePlayer(p, 34, now);
          if (inCone(H.x, H.y, COOP_REACH)) damageFarm(12, now);
          sweep(2200, 260, 0.7, "sawtooth", 0.09);
          sweep(1600, 120, 0.8, "square", 0.05);
        }
        return;
      }
      e.facing = Math.atan2(dy, dx);
      if (d < SCREAM_RANGE - 40 && now >= e.nextScream) {
        e.nextScream = now + 6500 + Math.random() * 1500;
        e.screamAngle = Math.atan2(dy, dx);
        e.screamFireAt = now + 750;
        e.revealUntil = now + 2200;
        e.chargeAt = now;
        say(e, "SCREEEEEEE!", now);
        pushFx("screamCharge", e.x, e.y, { a: e.screamAngle });
        sweep(200, 900, 0.7, "triangle", 0.05);
        return;
      }
      if (d > e.r + COOP_REACH + 120) {
        const ox = e.x, oy = e.y, pos = moveEnemy(e, dx / d * e.speed * dt, dy / d * e.speed * dt, e.r);
        e.x = pos.x;
        e.y = pos.y;
        e.moving = Math.hypot(e.x - ox, e.y - oy) > 0.01;
      } else e.moving = false;
    }
    function rabbitGoal(e, mode) {
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, r = mode === "in" ? COOP_REACH + 40 + Math.random() * 90 : 470 + Math.random() * 230, x = Math.max(70, Math.min(world.w - 70, H.x + Math.cos(a) * r)), y = Math.max(70, Math.min(world.h - 70, H.y + Math.sin(a) * r * 0.85));
        if (!collidesTree(x, y, e.r)) return { x, y };
      }
      return mode === "in" ? { x: H.x, y: H.y + 150 } : findSpawnPosition(e.r);
    }
    function updateRabbit(e, dt, now) {
      if (!e.goal) e.goal = rabbitGoal(e, e.mode);
      if (e.mode === "wait") {
        e.moving = false;
        if (now >= e.modeUntil) {
          e.mode = "in";
          e.goal = rabbitGoal(e, "in");
          if (Math.random() < 0.6) say(e, TAUNTS.RABBIT[Math.floor(Math.random() * TAUNTS.RABBIT.length)], now);
        }
        return;
      }
      const dx = e.goal.x - e.x, dy = e.goal.y - e.y, d = Math.hypot(dx, dy) || 1;
      if (d < 26 || (e.stuckFor || 0) > 1.2) {
        e.stuckFor = 0;
        if (e.mode === "in") {
          e.attackAt = now;
          const n = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 45;
            carrots.push({ id: ++fxId, x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, at: now, explodeAt: now + 1700 + i * 220 });
          }
          tone(520, 0.08, "square", 0.03);
          e.mode = "out";
          e.goal = rabbitGoal(e, "out");
        } else {
          e.mode = "wait";
          e.modeUntil = now + 1400 + Math.random() * 1800;
          e.goal = null;
        }
        return;
      }
      const ox = e.x, oy = e.y, sp = e.speed * (now < (e.hitUntil || 0) + 400 ? 1.15 : 1), pos = moveEnemy(e, dx / d * sp * dt, dy / d * sp * dt, e.r);
      e.x = pos.x;
      e.y = pos.y;
      const moved = Math.hypot(e.x - ox, e.y - oy);
      e.moving = moved > 0.01;
      if (e.moving) e.facing = Math.atan2(e.y - oy, e.x - ox);
      e.stuckFor = moved < sp * dt * 0.25 ? (e.stuckFor || 0) + dt : 0;
    }
    function updateCarrots(now) {
      if (!carrots.length) return;
      carrots = carrots.filter((c) => {
        if (now < c.explodeAt) return true;
        pushFx("carrotBoom", c.x, c.y);
        for (const p of players.values()) if (p.hp > 0 && Math.hypot(p.x - c.x, p.y - c.y) < 88) damagePlayer(p, 12, now);
        if (Math.hypot(H.x - c.x, H.y - c.y) < COOP_REACH + 90) damageFarm(5, now);
        tone(110, 0.22, "sawtooth", 0.06);
        return false;
      });
    }
    function theremin() {
      if (!soundOn || !audio) return;
      try {
        const now = audio.currentTime, o = audio.createOscillator(), g = audio.createGain(), l = audio.createOscillator(), lg = audio.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(420, now);
        o.frequency.exponentialRampToValueAtTime(1500, now + 0.35);
        o.frequency.exponentialRampToValueAtTime(700, now + 0.6);
        l.frequency.value = 7;
        lg.gain.value = 60;
        l.connect(lg);
        lg.connect(o.frequency);
        g.gain.setValueAtTime(1e-3, now);
        g.gain.linearRampToValueAtTime(0.07, now + 0.05);
        g.gain.exponentialRampToValueAtTime(1e-3, now + 0.65);
        o.connect(g);
        g.connect(audio.destination);
        o.start(now);
        l.start(now);
        o.stop(now + 0.7);
        l.stop(now + 0.7);
      } catch {
      }
    }
    let pendingSpawns = [];
    function processPendingSpawns(now) {
      if (!pendingSpawns.length) return;
      const keep = [];
      for (const ps of pendingSpawns) {
        if (now < ps.at) {
          keep.push(ps);
          continue;
        }
        const e = makeEnemy(ps.type, ps.x, ps.y, wave - 1, now);
        e.bornAt = now;
        enemies.push(e);
      }
      pendingSpawns = keep;
    }
    function makeShot(p, angle) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      shots.push({ x: p.x + dx * 34, y: p.y + dy * 34, dx: dx * 620, dy: dy * 620, t: 1.1, damage: 1, ownerId: p.id, color: p.color });
    }
    const LASER_RANGE = 250;
    function fireLaser(p, angle, now) {
      const x0 = p.x + Math.cos(angle) * 30, y0 = p.y + Math.sin(angle) * 30;
      let len = beamLength(x0, y0, angle, LASER_RANGE), hit = null;
      for (let s = 0; s <= len; s += 10) {
        const x = x0 + Math.cos(angle) * s, y = y0 + Math.sin(angle) * s;
        for (const e of enemies)
          if (hittable(e, now) && Math.hypot(e.x - x, e.y - y) < e.r + 6) {
            hit = e;
            break;
          }
        if (hit) {
          len = s;
          break;
        }
      }
      if (hit) hitEnemy(hit, 2, p.id, now);
      (p.beams = p.beams || []).push({ a: angle, len, until: now + 110, hit: !!hit });
    }
    function fireSeeker(p, angle) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      shots.push({
        x: p.x + dx * 34,
        y: p.y + dy * 34,
        dx: dx * 500,
        dy: dy * 500,
        t: 0.544,
        damage: 2.1,
        ownerId: p.id,
        color: "#ff8a3d",
        missile: true,
        speed: 500,
        target: null
      });
      tone(180, 0.09, "sawtooth", 0.03);
    }
    function steerMissile(b, dt, now) {
      if (!b.target || b.target.hp <= 0 || !hittable(b.target, now)) {
        let best = null, bd = 170;
        const a = Math.atan2(b.dy, b.dx);
        for (const e of enemies) {
          if (!hittable(e, now) || cloaked(e, now)) continue;
          const d = Math.hypot(e.x - b.x, e.y - b.y);
          if (d > bd) continue;
          const da = Math.abs(Math.atan2(Math.sin(Math.atan2(e.y - b.y, e.x - b.x) - a), Math.cos(Math.atan2(e.y - b.y, e.x - b.x) - a)));
          if (da < 1.2 && d < bd) {
            bd = d;
            best = e;
          }
        }
        b.target = best;
      }
      if (!b.target) return;
      const cur = Math.atan2(b.dy, b.dx), want = Math.atan2(b.target.y - b.y, b.target.x - b.x), diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), na = cur + Math.max(-6 * dt, Math.min(6 * dt, diff));
      b.dx = Math.cos(na) * b.speed;
      b.dy = Math.sin(na) * b.speed;
    }
    function tryHulkDash(p, now) {
      let best = null, bd = 260;
      for (const e of enemies) {
        if (!hittable(e, now) || cloaked(e, now)) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) - e.r;
        if (d < 70 || d > bd) continue;
        const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - p.aim), Math.cos(Math.atan2(dy, dx) - p.aim)));
        if (da < 0.7) {
          bd = d;
          best = e;
        }
      }
      if (!best) return;
      p.dashDir = Math.atan2(best.y - p.y, best.x - p.x);
      const dur = Math.min(260, (bd - 40) / 820 * 1e3);
      p.dashUntil = now + dur;
      p.lastShot = now + dur - 300;
      p.nextDash = now + 1100;
      p.dashAt = now;
      pushFx("hulkDash", p.x, p.y, { playerId: p.id, dir: p.dashDir });
      sweep(240, 90, 0.2, "sawtooth", 0.05);
    }
    function deepPeep() {
      if (!soundOn || !audio) return;
      try {
        const now = audio.currentTime;
        for (const [at, f] of [
          [0, 330],
          [0.16, 370]
        ]) {
          const o = audio.createOscillator(), o2 = audio.createOscillator(), g = audio.createGain();
          o.type = "sawtooth";
          o2.type = "triangle";
          o.frequency.setValueAtTime(f, now + at);
          o.frequency.exponentialRampToValueAtTime(f * 0.62, now + at + 0.12);
          o2.frequency.setValueAtTime(f / 2, now + at);
          o2.frequency.exponentialRampToValueAtTime(f * 0.31, now + at + 0.12);
          g.gain.setValueAtTime(1e-3, now + at);
          g.gain.linearRampToValueAtTime(0.11, now + at + 0.015);
          g.gain.exponentialRampToValueAtTime(1e-3, now + at + 0.14);
          o.connect(g);
          o2.connect(g);
          g.connect(audio.destination);
          o.start(now + at);
          o2.start(now + at);
          o.stop(now + at + 0.15);
          o2.stop(now + at + 0.15);
        }
      } catch {
      }
    }
    function hulkPunch(p, now) {
      const a = p.aim, reach = 88;
      let hits = 0;
      for (const e of enemies) {
        if (!hittable(e, now)) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
        if (d > reach + e.r) continue;
        const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - a), Math.cos(Math.atan2(dy, dx) - a)));
        if (da > 1.1 && d > e.r + 30) continue;
        hitEnemy(e, e.elite ? 9 : e.hp + 1, p.id, now);
        hits++;
        if (e.hp > 0 && e.type !== "TORNADO") {
          const k = Math.min(60, 40);
          const n = moveCircle(e, Math.cos(a) * k, Math.sin(a) * k, e.r);
          e.x = n.x;
          e.y = n.y;
        }
      }
      p.punchAt = now;
      pushFx("punch", p.x + Math.cos(a) * 50, p.y + Math.sin(a) * 50, { playerId: p.id, hits });
      if (hits && now - (p.lastSmash || 0) > 3500 && Math.random() < 0.4) {
        p.lastSmash = now;
        p.smashAt = now;
        playVoice("SMASH");
      } else deepPeep();
      if (hits) sweep(110, 45, 0.16, "square", 0.06);
    }
    function updateTurret(dt, now) {
      if (!turret.active) return;
      let best = null, bestD = 600;
      for (const e of enemies) {
        if (!hittable(e, now) || cloaked(e, now)) continue;
        const d = Math.hypot(e.x - H.x, e.y - H.y);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      if (!best) {
        turret.target = null;
        return;
      }
      turret.target = best;
      const desired = Math.atan2(best.y - H.y, best.x - H.x);
      let diff = Math.atan2(Math.sin(desired - turret.angle), Math.cos(desired - turret.angle));
      turret.angle += Math.max(-7 * dt, Math.min(7 * dt, diff));
      if (Math.abs(diff) < 0.25 && now - turret.lastShot > 120) {
        turret.lastShot = now;
        turret.shotAt = now;
        const a = turret.angle, dx = Math.cos(a), dy = Math.sin(a);
        shots.push({
          x: H.x + dx * 30,
          y: H.y + dy * 30,
          dx: dx * 680,
          dy: dy * 680,
          t: 1,
          damage: 1,
          ownerId: "TURRET",
          turret: true,
          startX: H.x,
          startY: H.y,
          color: "#ffd34d"
        });
      }
    }
    function updateRevives(dt, now) {
      for (const p of players.values()) {
        if (p.hp > 0 || !p.connected) {
          p.revive = 0;
          p.revivers = 0;
          continue;
        }
        let helpers = 0;
        for (const o of players.values()) if (o !== p && o.hp > 0 && o.connected && Math.hypot(o.x - p.x, o.y - p.y) < 52) helpers++;
        p.revivers = helpers;
        if (!helpers) {
          if (p.revive > 0) p.revive = 0;
          continue;
        }
        p.revive = (p.revive || 0) + dt;
        if (Math.floor((p.revive - dt) * 2) < Math.floor(p.revive * 2)) tone(500 + p.revive * 120, 0.06, "sine", 0.02);
        if (p.revive >= 5) {
          p.hp = 60;
          p.deathAt = 0;
          p.revive = 0;
          p.lastHit = 0;
          p.effects.SHIELD = now + 2500;
          for (const o of players.values()) if (o !== p && o.hp > 0 && Math.hypot(o.x - p.x, o.y - p.y) < 52) o.score += 30;
          pushFx("revive", p.x, p.y, { playerId: p.id });
          toast(p.name + " is back in the fight!");
          sweep(500, 1300, 0.45, "triangle", 0.06);
          send(p, true);
        }
      }
    }
    function tick(dt, now) {
      var _a, _b;
      if (!started || paused) return;
      if (countdown > 0) {
        const before = Math.ceil(countdown);
        countdown = Math.max(0, countdown - dt);
        if (countdown > 0 && Math.ceil(countdown) < before) tone(440 + before * 75, 0.08, "square", 0.025);
        if (countdown === 0) {
          spawn = 0.35;
          playPickupSound("NEXTWAVE");
          showWaveBanner();
        }
      }
      if (countdown === 0) {
        spawn -= dt;
        if (remainingToSpawn > 0 && spawn <= 0) {
          spawn = Math.max(0.32, 1.7 - wave * 0.055);
          spawnEnemy();
        }
      }
      buildEnemyGrid();
      for (const e of enemies) updateEnemy(e, dt, now);
      for (const p of players.values()) {
        if (p.beams) p.beams = p.beams.filter((b) => b.until > now);
        if (p.connected && now - (p.lastSeen || now) > 12e3) {
          try {
            (_a = p.conn) == null ? void 0 : _a.close();
          } catch {
          }
        }
        if (p.hp <= 0 || !p.connected) {
          send(p);
          continue;
        }
        const hs = p.effects.HULK ? 1.1 : 1, dashing = p.effects.HULK && now < (p.dashUntil || 0), mvx = dashing ? Math.cos(p.dashDir) * 820 : p.move.x * 207 * hs, mvy = dashing ? Math.sin(p.dashDir) * 820 : p.move.y * 207 * hs, ox = p.x, oy = p.y, pos = moveCircle(p, mvx * dt, mvy * dt, p.effects.HULK ? 32 : 25);
        p.x = pos.x;
        p.y = pos.y;
        p.speed = Math.hypot(p.x - ox, p.y - oy) / Math.max(dt, 1e-3);
        const hulk = !!p.effects.HULK;
        const rapid = !!p.effects.RAPID, double = !!p.effects.DOUBLE, laser = !!p.effects.LASER, seeker = !!p.effects.SEEKER;
        const rate = hulk ? 300 : seeker ? rapid ? SEEKER_RATE_RAPID : SEEKER_RATE : rapid ? 65 : 120;
        if (hulk && p.fire && now > (p.nextDash || 0) && now > (p.dashUntil || 0)) tryHulkDash(p, now);
        if (p.fire && now - (p.lastShot || 0) > rate) {
          p.lastShot = now;
          if (hulk) hulkPunch(p, now);
          else {
            const angles = double ? [p.aim - 0.13, p.aim + 0.13] : [p.aim];
            for (const a of angles) seeker ? fireSeeker(p, a) : laser ? fireLaser(p, a, now) : makeShot(p, a);
          }
        }
        for (const d of drops) {
          if (!d.taken && (!hulk || d.type === "MEDKIT") && Math.hypot(d.x - p.x, d.y - p.y) < 46) {
            d.taken = true;
            pushFx("pickup", d.x, d.y, { type: d.type, playerId: p.id });
            if (d.type === "MEDKIT") {
              if (hulk || p.hp >= 99) {
                farmHp = Math.min(100, farmHp + 20);
                pushFx("henHeal", H.x, H.y);
                toast(p.name + " was at full health \u2014 the medkit healed MAMA HEN +20%!");
              } else {
                p.hp = Math.min(100, p.hp + 35);
                toast(p.name + " picked up a medkit");
              }
            } else if (d.type === "SHIELD") {
              p.effects.SHIELD = now + 26e3;
              toast(p.name + " picked up a shield");
            } else if (d.type === "DOUBLE") {
              const already = p.effects.DOUBLE;
              p.effects.DOUBLE = true;
              toast(already ? "Double shot already unlocked" : p.name + " unlocked permanent double shot");
            } else if (d.type === "RAPID") {
              const already = p.effects.RAPID;
              p.effects.RAPID = true;
              toast(already ? "Rapid fire already unlocked" : p.name + " unlocked permanent rapid fire");
            } else if (d.type === "SEEKER") {
              p.effects.SEEKER = true;
              delete p.effects.LASER;
              toast(p.name + " equipped the CHICKEN SEEKER \u2014 homing missiles!");
            } else if (d.type === "HULK") {
              const pre = Object.assign({}, p.effects);
              delete pre.HULK;
              p.preHulk = { hp: p.hp, effects: pre };
              p.effects.HULK = true;
              p.hulkWave = wave;
              p.hulkHp = 100;
              pushFx("hulk", p.x, p.y, { playerId: p.id });
              toast(p.name + " became CHICKEN HULK until the end of the wave! SMASH!");
            } else if (d.type === "LASER") {
              delete p.effects.SEEKER;
              p.effects.LASER = true;
              toast(p.name + " equipped the CHICKEN LASER \u2014 short range, double damage!");
            } else if (d.type === "TURRET") {
              turret.active = true;
              toast(p.name + " deployed the CHICKEN TURRET on the farm!");
              pushFx("turretDeploy", H.x, H.y);
            }
            playPickupSound(d.type);
          }
        }
        send(p);
      }
      updateRevives(dt, now);
      updateTurret(dt, now);
      updateSuperChicken(now);
      processPendingSpawns(now);
      updateCarrots(now);
      for (const b of shots) {
        if (b.missile) steerMissile(b, dt, now);
        const ox = b.x, oy = b.y;
        b.x += b.dx * dt;
        b.y += b.dy * dt;
        b.t -= dt;
        if (!b.turret && !b.missile && pathBlocked(ox, oy, b.x, b.y, 5, true)) {
          b.t = 0;
          continue;
        }
        for (const e of enemies) {
          if (hittable(e, now) && Math.hypot(e.x - b.x, e.y - b.y) < e.r + 5) {
            hitEnemy(e, b.damage, b.ownerId, now);
            if (b.missile) pushFx("missileHit", b.x, b.y);
            b.t = 0;
            break;
          }
        }
      }
      if (soundOn && shots.length && now - lastShotSound > 220) {
        tone(320, 0.045, "square", 0.018);
        lastShotSound = now;
      }
      for (const b of fireballs) {
        if (b.homing) {
          const tg = b.homing === "farm" ? H : players.get(b.homing);
          if (tg && (tg === H || tg.hp > 0)) {
            const cur = Math.atan2(b.dy, b.dx), want = Math.atan2(tg.y - b.y, tg.x - b.x), df = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), na = cur + Math.max(-2.2 * dt, Math.min(2.2 * dt, df)), sp = Math.hypot(b.dx, b.dy);
            b.dx = Math.cos(na) * sp;
            b.dy = Math.sin(na) * sp;
          }
        }
        const ox = b.x, oy = b.y;
        b.x += b.dx * dt;
        b.y += b.dy * dt;
        b.t -= dt;
        if (b.x < 0 || b.y < 0 || b.x > world.w || b.y > world.h || pathBlocked(ox, oy, b.x, b.y, 10, true)) {
          b.t = 0;
          continue;
        }
        let hit = false;
        for (const p of players.values())
          if (p.hp > 0 && Math.hypot(p.x - b.x, p.y - b.y) < 32) {
            damagePlayer(p, b.damage, now);
            hit = true;
            break;
          }
        if (!hit && Math.hypot(H.x - b.x, H.y - b.y) < 125) {
          damageFarm(b.damage, now);
          hit = true;
        }
        if (hit) b.t = 0;
      }
      fireballs = fireballs.filter((b) => b.t > 0);
      shots = shots.filter((b) => b.t > 0);
      bloodSplats = bloodSplats.filter((s) => (s.life -= dt) > 0);
      enemyBeams = enemyBeams.filter((b) => (b.t -= dt) > 0);
      enemies = enemies.filter((e) => e.hp > 0);
      drops = drops.filter((d) => !d.taken && (d.life -= dt) > 0);
      fx = fx.filter((f) => now - f.at < 4e3);
      if (farmHp <= 0 && !gameOver) {
        started = false;
        gameOver = true;
        countdown = 0;
        saveRun();
        for (const p of players.values()) {
          if (p.hp > 0) {
            p.hp = 0;
            p.deathAt = now;
          }
          try {
            if ((_b = p.conn) == null ? void 0 : _b.open) p.conn.send({ type: "gameOver", started: false });
          } catch {
          }
          send(p, true);
        }
        $("#startBtn").disabled = false;
      } else if (remainingToSpawn === 0 && enemies.length === 0 && wave > 0 && countdown === 0) {
        farmHp = Math.min(100, farmHp + 8);
        startWave(wave + 1);
      }
      $("#farmHp").textContent = Math.ceil(farmHp) + "%";
      $("#enemyCount").textContent = remainingToSpawn + enemies.length;
    }
    function draw(frameTime) {
      const dt = Math.min(0.05, (frameTime - last) / 1e3);
      last = frameTime;
      const now = clock();
      tick(dt, now);
      if (!started) for (const p of players.values()) send(p);
      game3d.render(
        {
          night: started && isNight(),
          players,
          enemies,
          shots,
          fireballs,
          carrots,
          drops,
          enemyBeams,
          bloodSplats,
          farmHp,
          henLastHit,
          countdown,
          wave,
          turret,
          fx,
          superChicken,
          lobby: !started && !gameOver,
          gameOver
        },
        dt,
        now
      );
      $("#wave").textContent = wave;
      const cd = $("#countdown");
      if (cd) {
        const show = countdown > 0 && started;
        if (show) {
          const v = Math.ceil(countdown);
          if (cd.dataset.v !== wave + ":" + v) {
            cd.dataset.v = wave + ":" + v;
            cd.textContent = v;
            cd.classList.remove("pop", "banner");
            void cd.offsetWidth;
            cd.classList.add("show", "pop");
          }
        } else if (!cd.classList.contains("banner")) cd.classList.remove("show", "pop");
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    function nightBanner(night) {
      const el = $("#nightBanner");
      if (!el) return;
      el.className = "night-banner " + (night ? "is-night" : "is-day");
      el.innerHTML = night ? "<b>\u{1F319} NIGHT FALLS</b><small>DANGER RISES \xB7 FIRE TORNADOS ROAM THE FIELDS</small>" : "<b>\u2600\uFE0F DAWN BREAKS</b><small>THE FLOCK SURVIVED THE NIGHT</small>";
      void el.offsetWidth;
      el.classList.add("show");
      clearTimeout(nightBanner.t);
      nightBanner.t = setTimeout(() => el.classList.remove("show"), 3600);
    }
    let localConn = null, localName = "HOST";
    const hostKeys = /* @__PURE__ */ new Set(), hostMouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
    const hostTyping = (e) => {
      const t = e.target;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const localPlayer = () => localConn ? [...players.values()].find((p) => p.conn === localConn) : null;
    function setLocalButtons() {
      var _a;
      for (const b of document.querySelectorAll(".local-play-btn")) {
        const hud = b.classList.contains("hud-local");
        b.textContent = localConn ? hud ? "\u2328\uFE0F LEAVE" : "\u2328\uFE0F LEAVE PC PLAYER" : hud ? "\u2328\uFE0F PC PLAYER" : "\u2328\uFE0F PLAY ON THIS PC";
        b.classList.toggle("on", !!localConn);
      }
      canvas.classList.toggle("local-aim", !!localConn);
      (_a = $("#localHelp")) == null ? void 0 : _a.classList.toggle("hidden", !localConn);
    }
    function toggleLocalPlayer() {
      if (localConn) {
        const p = localPlayer();
        localConn.open = false;
        if (p) {
          clearTimeout(p.expireTimer);
          players.delete(p.id);
        }
        localConn = null;
        rosterUpdate();
        setLocalButtons();
        return;
      }
      let n = "";
      try {
        n = localStorage.getItem("chicken-horde-local-name") || "";
      } catch {
      }
      n = (prompt("Name for the keyboard + mouse player:", n || "HOST") || "").trim().slice(0, 12);
      if (!n) return;
      localName = n;
      try {
        localStorage.setItem("chicken-horde-local-name", n);
      } catch {
      }
      const c = new Emitter();
      c.open = true;
      c.local = true;
      c.send = () => {
      };
      c.close = () => {
      };
      localConn = c;
      onIncoming(c);
      c.emit("data", { type: "join", clientId: "local-pc-player", name: n });
      setLocalButtons();
      toast(n + " joined with keyboard + mouse");
    }
    for (const b of document.querySelectorAll(".local-play-btn"))
      b.onclick = (e) => {
        e.currentTarget.blur();
        toggleLocalPlayer();
      };
    addEventListener("keydown", (e) => {
      if (!localConn || hostTyping(e)) return;
      const k = (e.key || "").toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      hostKeys.add(k);
    });
    addEventListener("keyup", (e) => {
      hostKeys.delete((e.key || "").toLowerCase());
    });
    addEventListener("blur", () => {
      hostKeys.clear();
      hostMouse.down = false;
    });
    canvas.addEventListener("mousemove", (e) => {
      hostMouse.x = e.clientX;
      hostMouse.y = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0 && localConn) hostMouse.down = true;
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) hostMouse.down = false;
    });
    canvas.addEventListener("contextmenu", (e) => {
      if (localConn) e.preventDefault();
    });
    setInterval(() => {
      var _a;
      if (!localConn) return;
      const p = localPlayer();
      if (!p) return;
      const x = (hostKeys.has("d") ? 1 : 0) - (hostKeys.has("a") ? 1 : 0), y = (hostKeys.has("s") ? 1 : 0) - (hostKeys.has("w") ? 1 : 0), m = Math.hypot(x, y), mv = m ? screenVectorToWorld(x / m, y / m) : { x: 0, y: 0 };
      const ax = (hostKeys.has("arrowright") ? 1 : 0) - (hostKeys.has("arrowleft") ? 1 : 0), ay = (hostKeys.has("arrowdown") ? 1 : 0) - (hostKeys.has("arrowup") ? 1 : 0);
      let aim = p.aim, fire = hostMouse.down || hostKeys.has(" ");
      if (ax || ay) {
        aim = screenAngleToWorld(Math.atan2(ay, ax));
        fire = true;
      } else {
        const w = (_a = game3d == null ? void 0 : game3d.screenToWorld) == null ? void 0 : _a.call(game3d, hostMouse.x, hostMouse.y);
        if (w && Math.hypot(w.x - p.x, w.y - p.y) > 4) aim = Math.atan2(w.y - p.y, w.x - p.x);
      }
      localConn.emit("data", { type: "input", world: true, move: mv, aim, fire });
    }, 33);
    window.__chickenHorde = {
      players,
      get enemies() {
        return enemies;
      },
      get carrots() {
        return carrots;
      },
      get drops() {
        return drops;
      },
      turret,
      world,
      trees,
      startMatch,
      setWave: (n) => {
        enemies = [];
        startWave(n);
      },
      spawnElite: (t) => spawnElite(t, clock()),
      pushDrop: (t, x = H.x, y = H.y + 140) => pushDrop(x, y, t, 60),
      get farmHp() {
        return farmHp;
      },
      set farmHp(v) {
        farmHp = v;
      },
      hitFarm: (d = 0) => damageFarm(d, clock()),
      get roomCode() {
        return roomCode;
      },
      net,
      pause: (v) => {
        paused = v;
      },
      god: (v) => {
        godMode = v;
      },
      addEnemy: (type, x, y, extra = {}) => {
        const now = clock(), e = ["BOSS", "MUSHROOM", "ALIENBOSS", "FIRELORD", "RABBIT"].includes(type) ? makeElite(type, x, y, wave, now) : makeEnemy(type, x, y, wave, now);
        Object.assign(e, extra);
        enemies.push(e);
        return e;
      },
      get laserWave() {
        return laserWave;
      },
      dbg: () => ({
        wave,
        started,
        paused,
        countdown,
        remainingToSpawn,
        elitesToSpawn,
        waveGroups,
        left: spawnGroups.length,
        n: enemies.length,
        farmHp,
        gameOver
      }),
      hit: (e, d, id) => hitEnemy(e, d, id, clock()),
      sim: (sec) => {
        for (let t = 0; t < sec; t += 0.05) {
          timeShift += 50;
          for (const p of players.values()) if (p.connected) p.lastSeen = clock();
          tick(0.05, clock());
        }
        return enemies.length;
      },
      now: () => clock(),
      get localPlayer() {
        return localPlayer();
      },
      toggleLocalPlayer,
      nightBanner,
      addBot: (name) => {
        const c = new Emitter();
        c.open = true;
        c.send = () => {
        };
        c.close = () => {
          c.open = false;
          c.emit("close");
        };
        onIncoming(c);
        c.emit("data", { type: "join", clientId: "bot-" + name, name });
        return c;
      }
    };
  }
  function lockMobileZoom() {
    const isField = (t) => !!t && !!t.closest && !!t.closest("input,textarea,select,label,button,a,form,.howto");
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    document.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length > 1 || !isField(e.target)) e.preventDefault();
      },
      { passive: false }
    );
    document.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length > 1) e.preventDefault();
      },
      { passive: false }
    );
    let lastTouchEnd = 0;
    document.addEventListener(
      "touchend",
      (e) => {
        const now = Date.now();
        if (now - lastTouchEnd < 380 && !isField(e.target)) e.preventDefault();
        lastTouchEnd = now;
      },
      { passive: false }
    );
    document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("contextmenu", (e) => {
      if (!isField(e.target)) e.preventDefault();
    });
    const vp = document.querySelector("meta[name=viewport]");
    document.addEventListener("focusout", () => {
      if (!vp) return;
      const c = vp.content;
      vp.content = c + ",width=device-width";
      setTimeout(() => {
        vp.content = c;
        scrollTo(0, 0);
      }, 60);
    });
  }
  function initController(roomId) {
    var _a;
    lockMobileZoom();
    const status = $("#joinStatus"), connStatus = $("#connection");
    let move = { x: 0, y: 0 }, aim = 0, fire = false, joined = false;
    let wasKicked = false;
    const clientKey = "chicken-horde-client-id";
    let clientId;
    try {
      clientId = localStorage.getItem(clientKey);
      if (!clientId) {
        clientId = ((_a = crypto.randomUUID) == null ? void 0 : _a.call(crypto)) || "c" + Math.random().toString(36).slice(2);
        localStorage.setItem(clientKey, clientId);
      }
    } catch {
      clientId = "c" + Math.random().toString(36).slice(2);
    }
    let savedName = "";
    try {
      savedName = localStorage.getItem("chicken-horde-player-name") || "";
    } catch {
    }
    if (savedName) $("#playerName").value = savedName;
    let retryDelay = 1e3, retryTimer = null;
    function currentName() {
      let name = $("#playerName").value.trim() || "CHICK";
      try {
        name = localStorage.getItem("chicken-horde-player-name") || name;
      } catch {
      }
      return name;
    }
    function onData(c, d) {
      if (c !== conn || !d) return;
      if (d.type === "kicked") {
        wasKicked = true;
        joined = false;
        $("#joinPanel").classList.remove("hidden");
        $("#controls").classList.add("hidden");
        status.textContent = "The host removed you from the lobby.";
        connStatus.textContent = "REMOVED";
      } else if (d.type === "state" && joined) updateBadge(d);
      else if (d.type === "gameOver") updateBadge({ hp: 0, started: false, over: true });
    }
    const socket = io(ioOptions), conn = new Emitter();
    conn.open = false;
    conn.send = (d) => {
      if (conn.open && socket.connected) socket.emit("c:d", d);
    };
    conn.close = () => socket.disconnect();
    function joinRoom() {
      clearTimeout(retryTimer);
      socket.emit("c:join", { room: roomId, clientId }, (res) => {
        if (!res || !res.ok) {
          conn.open = false;
          connStatus.textContent = "WAITING";
          status.textContent = res && res.error === "no-room" ? "Room ".concat(roomId, " is not open \u2014 check the code or wait for the host\u2026") : res && res.error === "full" ? "This room is full." : "Trying to reach the host\u2026";
          retryTimer = setTimeout(() => {
            if (socket.connected) joinRoom();
          }, 2500);
          return;
        }
        conn.open = true;
        connStatus.textContent = res.hostOnline === false ? "HOST AWAY" : "CONNECTED";
        status.textContent = joined ? "Reconnected. Welcome back!" : "Connected to the farm.";
        $("#joinBtn").disabled = false;
        if (joined) conn.send({ type: "join", clientId, name: currentName() });
      });
    }
    socket.on("connect", joinRoom);
    socket.on("disconnect", (reason) => {
      conn.open = false;
      if (wasKicked) return;
      connStatus.textContent = "RECONNECTING";
      status.textContent = "Connection lost \u2014 reconnecting\u2026";
    });
    socket.on("c:d", (d) => onData(conn, d));
    socket.on("c:rejoin", () => {
      connStatus.textContent = "CONNECTED";
      status.textContent = joined ? "The host is back!" : "Connected to the farm.";
      if (joined && conn.open) conn.send({ type: "join", clientId, name: currentName() });
    });
    socket.on("c:hostgone", (m) => {
      connStatus.textContent = "HOST AWAY";
      status.textContent = m && m.closed ? "The host closed this room. Scan the new QR code." : "The host screen disconnected \u2014 waiting for it to come back\u2026";
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !socket.connected && !wasKicked) socket.connect();
    });
    addEventListener("online", () => {
      if (!socket.connected && !wasKicked) socket.connect();
    });
    connStatus.textContent = "CONNECTING";
    setTimeout(() => {
      if (conn.open || wasKicked) return;
      status.innerHTML = 'Still connecting\u2026 <button id="retryConn" class="start" style="margin-top:10px;width:100%">TAP TO RETRY</button><small style="display:block;margin-top:8px;opacity:.75">If it keeps failing: turn off iCloud Private Relay / Low Data Mode, or open this link in Safari (not inside another app).</small>';
      $("#retryConn").onclick = () => {
        try {
          socket.disconnect().connect();
        } catch {
          location.reload();
        }
      };
    }, 12e3);
    socket.on("connect_error", (err) => {
      connStatus.textContent = "RETRYING";
      status.textContent = "Cannot reach the server yet (" + (err && err.message || "network") + ") \u2014 retrying\u2026";
    });
    let lastHp = null;
    function updateBadge(d) {
      var _a2;
      const badge = $("#meBadge");
      if (!badge) return;
      if (lastHp != null && d.hp < lastHp && d.started) {
        try {
          (_a2 = navigator.vibrate) == null ? void 0 : _a2.call(navigator, d.hp <= 0 ? [80, 60, 160] : 45);
        } catch {
        }
        badge.classList.remove("hurt");
        void badge.offsetWidth;
        badge.classList.add("hurt");
      }
      lastHp = d.hp;
      badge.classList.remove("hidden");
      if (d.color) {
        badge.style.setProperty("--chick", d.color);
        document.documentElement.style.setProperty("--chick", d.color);
      }
      if (d.name) $("#meName").textContent = d.name;
      const down = d.hp <= 0 && d.started;
      badge.classList.toggle("down", !!down);
      $("#meHp").style.width = Math.max(0, Math.min(100, d.hp || 0)) + "%";
      $("#meState").textContent = d.over ? "GAME OVER \u2014 back to lobby soon" : down ? d.revive > 0 ? "REVIVING\u2026 ".concat(Math.round(d.revive / 5 * 100), "%") : "DOWN! A teammate must stand under you for 5 s" : d.started ? d.hulk ? "\u{1F4AA} CHICKEN HULK until the end of the wave \u2014 aim at enemies to DASH & SMASH!" : d.seeker ? "\u{1F680} CHICKEN SEEKER EQUIPPED" : d.laser ? "\u26A1 CHICKEN LASER EQUIPPED" : "Defend Mama Hen!" : "In the lobby \u2014 waiting for the host";
      status.textContent = d.started ? "Defend the farm!" : status.textContent;
    }
    $("#playerName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("#playerName").blur();
        $("#joinBtn").click();
      }
    });
    $("#joinBtn").onclick = () => {
      if (!conn || !conn.open) {
        status.textContent = "Still connecting to the host\u2026";
        return;
      }
      const name = $("#playerName").value.trim() || "CHICK";
      try {
        localStorage.setItem("chicken-horde-player-name", name);
      } catch {
      }
      conn.send({ type: "join", clientId, name });
      joined = true;
      $("#playerName").blur();
      $("#joinPanel").classList.add("hidden");
      $("#controls").classList.remove("hidden");
      updateBadge({ name, hp: 100, started: false });
    };
    function setupStick(zone, kind) {
      const base = zone.querySelector(".stick-base"), knob = zone.querySelector(".stick-knob");
      let pointer = null;
      function set(e) {
        const r = base.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), limit = r.width * 0.34, d = Math.hypot(dx, dy), k = d > limit ? limit / d : 1, nx = dx * k, ny = dy * k;
        knob.style.transform = "translate(".concat(nx, "px,").concat(ny, "px)");
        const mag = Math.hypot(nx, ny) / limit, dead = 0.16;
        if (kind === "move") {
          if (mag < dead) move = { x: 0, y: 0 };
          else {
            const q = (mag - dead) / (1 - dead);
            move = { x: nx / d * q, y: ny / d * q };
          }
        } else {
          if (mag >= dead) aim = Math.atan2(ny, nx);
          fire = mag >= dead;
        }
      }
      zone.addEventListener("pointerdown", (e) => {
        if (pointer !== null) return;
        pointer = e.pointerId;
        try {
          zone.setPointerCapture(pointer);
        } catch {
        }
        set(e);
        e.preventDefault();
      });
      zone.addEventListener("pointermove", (e) => {
        if (e.pointerId === pointer) {
          set(e);
          e.preventDefault();
        }
      });
      function up(e) {
        if (e.pointerId !== pointer) return;
        pointer = null;
        knob.style.transform = "translate(0,0)";
        if (kind === "move") move = { x: 0, y: 0 };
        else fire = false;
      }
      zone.addEventListener("pointerup", up);
      zone.addEventListener("pointercancel", up);
      zone.addEventListener("lostpointercapture", up);
      zone.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    }
    setupStick($("#moveZone"), "move");
    setupStick($("#aimZone"), "aim");
    const fireBtn = $("#fire");
    fireBtn.classList.add("hidden");
    const typing = (e) => {
      const t = e.target;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const keys = /* @__PURE__ */ new Set();
    let kbMode = false, kbMoving = false, mouseFire = false, keyFire = false;
    const ctrlEl = $("#controls"), reticle = document.createElement("div"), aimArrow = document.createElement("div"), kbHelp = document.createElement("div");
    reticle.className = "kb-reticle";
    aimArrow.className = "kb-arrow";
    kbHelp.className = "kb-help";
    kbHelp.innerHTML = "<b>\u2328\uFE0F KEYBOARD + MOUSE</b><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> MOVE</span><span>\u{1F5B1}\uFE0F MOUSE \xB7 AIM</span><span>CLICK / <kbd>SPACE</kbd> \xB7 FIRE</span><span><kbd>\u2190</kbd><kbd>\u2191</kbd><kbd>\u2193</kbd><kbd>\u2192</kbd> AIM + FIRE</span>";
    ctrlEl.append(aimArrow, reticle, kbHelp);
    function setKb(on) {
      if (kbMode === on) return;
      kbMode = on;
      ctrlEl.classList.toggle("kb-mode", on);
    }
    try {
      if (matchMedia("(pointer:fine)").matches && !matchMedia("(pointer:coarse)").matches) setKb(true);
    } catch {
    }
    addEventListener("touchstart", () => setKb(false), { passive: true });
    function showAim() {
      aimArrow.style.transform = "translateY(-50%) rotate(".concat(aim, "rad)");
    }
    addEventListener("keydown", (e) => {
      if (typing(e) || !joined) return;
      const k = (e.key || "").toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        e.preventDefault();
        setKb(true);
      }
      keys.add(k);
      if (k === " ") keyFire = true;
    });
    addEventListener("keyup", (e) => {
      if (typing(e)) return;
      const k = (e.key || "").toLowerCase();
      keys.delete(k);
      if (k === " ") keyFire = false;
    });
    addEventListener("blur", () => {
      keys.clear();
      keyFire = false;
      mouseFire = false;
      fire = false;
    });
    addEventListener("mousemove", (e) => {
      if (!joined) return;
      if (kbMode) {
        aim = Math.atan2(e.clientY - innerHeight / 2, e.clientX - innerWidth / 2);
        reticle.style.left = e.clientX + "px";
        reticle.style.top = e.clientY + "px";
        showAim();
      }
    });
    addEventListener("mousedown", (e) => {
      var _a2, _b;
      if (joined && kbMode && e.button === 0 && !((_b = (_a2 = e.target).closest) == null ? void 0 : _b.call(_a2, ".stick-zone,button,input"))) {
        mouseFire = true;
        reticle.classList.add("firing");
      }
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        mouseFire = false;
        reticle.classList.remove("firing");
      }
    });
    addEventListener("contextmenu", (e) => {
      if (kbMode && joined) e.preventDefault();
    });
    let lastPing = 0;
    setInterval(() => {
      const x = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0), y = (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0), m = Math.hypot(x, y);
      if (m) {
        move = { x: x / m, y: y / m };
        kbMoving = true;
      } else if (kbMoving) {
        move = { x: 0, y: 0 };
        kbMoving = false;
      }
      const ax = (keys.has("arrowright") ? 1 : 0) - (keys.has("arrowleft") ? 1 : 0), ay = (keys.has("arrowdown") ? 1 : 0) - (keys.has("arrowup") ? 1 : 0), arrows = !!(ax || ay);
      if (arrows) {
        aim = Math.atan2(ay, ax);
        showAim();
      }
      if (kbMode) fire = mouseFire || keyFire || arrows;
      else if (keyFire || arrows) fire = true;
      if ((conn == null ? void 0 : conn.open) && joined) conn.send({ type: "input", move: { x: +move.x.toFixed(3), y: +move.y.toFixed(3) }, aim: +aim.toFixed(3), fire });
      else if ((conn == null ? void 0 : conn.open) && Date.now() - lastPing > 4e3) {
        lastPing = Date.now();
        conn.send({ type: "ping" });
      }
    }, 50);
  }
})();
