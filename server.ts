// Junior Astronaut Mission Trainer - servidor multijugador
// Sin dependencias: usa WebSocket nativo de Bun.
// Ejecutar:  bun server.ts   ->  http://localhost:3000

const PORT = Number(process.env.PORT || 3000);

const WORLD = { w: 2200, h: 1400 };
const EMERGENCY = { x: 900, y: 560 };

const COLORS = [
  "#C51111", "#132ED1", "#117F2D", "#ED54BA", "#EF7D0D", "#F5F557",
  "#3F474E", "#D6E0F0", "#6B2FBB", "#4AECDE", "#50EF39", "#72491E",
];

const STATIONS = [
  { id: "cafeteria", label: "Cafetería", x: 1100, y: 700 },
  { id: "reactor", label: "Reactor", x: 360, y: 360 },
  { id: "navigation", label: "Navegación", x: 1840, y: 320 },
  { id: "lab", label: "Laboratorio", x: 1840, y: 1060 },
  { id: "o2", label: "Oxígeno", x: 360, y: 1060 },
  { id: "storage", label: "Almacén", x: 1100, y: 140 },
  { id: "comms", label: "Comunicaciones", x: 1100, y: 1260 },
];

const TASK_NAMES = [
  "Calibrar giroscopio", "Alinear antena", "Cargar celdas", "Reparar cables",
  "Recoger muestras", "Regar plantas", "Subir datos", "Limpiar filtros",
  "Escanear estrellas", "Cargar batería", "Abrir esclusa", "Inspeccionar casco",
];

const TASKS_PER_PLAYER = 4;
const KILL_COOLDOWN = 15000;
const MEETING_TIME = 30000;

const rooms = new Map();

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function makeRoom(code) {
  return {
    code,
    hostId: null,
    state: "lobby", // lobby | playing | meeting | ended
    players: new Map(),
    impostorId: null,
    totalTasks: 0,
    doneTasks: 0,
    bodies: [],
    meeting: null,
    startedAt: 0,
    emergencyAt: 0,
    posTimer: null,
    meetingTimer: null,
  };
}

function makePlayer(name, ws) {
  return {
    id: uid(),
    name: (name || "Astronauta").toString().slice(0, 16),
    color: COLORS[(Math.random() * COLORS.length) | 0],
    x: WORLD.w / 2, y: WORLD.h / 2, dir: 0, moving: false,
    dead: false, ghost: false, tasks: [], lastKill: 0, ws,
  };
}

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}
function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const p of room.players.values()) {
    try { if (p.ws) p.ws.send(msg); } catch (e) {}
  }
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color,
    x: p.x, y: p.y, dir: p.dir, moving: p.moving,
    dead: p.dead, ghost: p.ghost,
  }));
}
function lobbyPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color, host: p.id === room.hostId,
  }));
}

function assignTasks(room) {
  room.totalTasks = 0;
  for (const p of room.players.values()) {
    p.tasks = [];
    const names = [...TASK_NAMES].sort(() => Math.random() - 0.5).slice(0, TASKS_PER_PLAYER);
    const st = [...STATIONS].sort(() => Math.random() - 0.5).slice(0, TASKS_PER_PLAYER);
    for (let i = 0; i < TASKS_PER_PLAYER; i++) {
      p.tasks.push({
        id: uid(), name: names[i], station: st[i].id,
        x: st[i].x, y: st[i].y, done: false,
      });
    }
    if (p.id !== room.impostorId) room.totalTasks += TASKS_PER_PLAYER;
  }
}

function startGame(room) {
  room.state = "playing";
  room.startedAt = Date.now();
  room.emergencyAt = 0;
  room.bodies = [];
  room.doneTasks = 0;
  room.meeting = null;
  const ids = [...room.players.keys()];
  room.impostorId = ids[(Math.random() * ids.length) | 0];

  let i = 0;
  for (const p of room.players.values()) {
    p.dead = false; p.ghost = false; p.lastKill = 0;
    const a = (i / room.players.size) * Math.PI * 2;
    p.x = 1100 + Math.cos(a) * 90;
    p.y = 700 + Math.sin(a) * 90;
    p.dir = a;
    i++;
  }
  assignTasks(room);

  for (const p of room.players.values()) {
    send(p.ws, {
      t: "started",
      you: p.id,
      role: p.id === room.impostorId ? "impostor" : "crew",
      players: publicPlayers(room),
      stations: STATIONS,
      emergency: EMERGENCY,
      world: WORLD,
      tasks: p.tasks,
      taskTotal: room.totalTasks,
      taskDone: 0,
    });
  }
}

function checkWin(room) {
  if (room.state === "ended") return;
  const crewAlive = [...room.players.values()].filter((x) => x.id !== room.impostorId && !x.dead).length;
  const impAlive = [...room.players.values()].filter((x) => x.id === room.impostorId && !x.dead).length;
  let winner = null;
  if (room.totalTasks > 0 && room.doneTasks >= room.totalTasks) winner = "crew";
  else if (impAlive === 0) winner = "crew";
  else if (crewAlive === 0 || crewAlive <= impAlive) winner = "impostor";
  if (winner) {
    room.state = "ended";
    clearTimeout(room.meetingTimer);
    room.meetingTimer = null;
    room.meeting = null;
    broadcast(room, { t: "gameOver", winner, impostorId: room.impostorId });
  }
}

function eliminate(room, killerId, targetId) {
  if (room.state !== "playing") return;
  if (killerId !== room.impostorId) return;
  const killer = room.players.get(killerId);
  const target = room.players.get(targetId);
  if (!killer || !target || target.dead) return;
  if (targetId === room.impostorId) return;
  if (Date.now() - killer.lastKill < KILL_COOLDOWN) return;
  if (Math.hypot(killer.x - target.x, killer.y - target.y) > 110) return;
  killer.lastKill = Date.now();
  target.dead = true;
  target.ghost = true;
  room.bodies.push({ id: targetId, x: target.x, y: target.y, color: target.color });
  broadcast(room, { t: "eliminated", id: targetId, x: target.x, y: target.y });
  checkWin(room);
}

function report(room, reporterId, bodyId) {
  if (room.state !== "playing") return;
  const idx = room.bodies.findIndex((b) => b.id === bodyId);
  if (idx === -1) return;
  room.bodies.splice(idx, 1);
  callMeeting(room, "report", reporterId);
}

function emergency(room, reporterId) {
  if (room.state !== "playing") return;
  const now = Date.now();
  if (room.startedAt && now - room.startedAt < 15000) return;
  if (now - room.emergencyAt < 20000) return;
  room.emergencyAt = now;
  callMeeting(room, "emergency", reporterId);
}

function callMeeting(room, reason, reporterId) {
  if (room.state !== "playing" || room.meeting) return;
  room.state = "meeting";
  room.meeting = { votes: {}, voters: new Set() };
  broadcast(room, { t: "meeting", reason, reporter: reporterId, players: publicPlayers(room) });
  room.meetingTimer = setTimeout(() => tally(room), MEETING_TIME);
}

function vote(room, voterId, targetId) {
  const m = room.meeting;
  if (!m) return;
  const voter = room.players.get(voterId);
  if (!voter || voter.dead) return;
  if (m.voters.has(voterId)) return;
  m.voters.add(voterId);
  m.votes[voterId] = targetId || "skip";
  broadcast(room, { t: "voteCast", voterId, target: targetId || "skip" });
  const alive = [...room.players.values()].filter((x) => !x.dead).length;
  if (m.voters.size >= alive) tally(room);
}

function tally(room) {
  const m = room.meeting;
  if (!m) return;
  clearTimeout(room.meetingTimer);
  room.meetingTimer = null;
  const counts = {};
  for (const target of Object.values(m.votes)) counts[target] = (counts[target] || 0) + 1;
  let top = "skip", topN = -1, tie = false;
  for (const [target, n] of Object.entries(counts)) {
    if (n > topN) { top = target; topN = n; tie = false; }
    else if (n === topN) tie = true;
  }
  let ejectedId = null, wasImpostor = false;
  if (top !== "skip" && !tie) {
    ejectedId = top;
    wasImpostor = top === room.impostorId;
    const e = room.players.get(top);
    if (e) { e.dead = true; e.ghost = true; }
  }
  broadcast(room, { t: "ejected", ejectedId, wasImpostor, votes: m.votes, counts });
  room.meeting = null;
  room.state = "playing";
  broadcast(room, { t: "resume" });
  checkWin(room);
}

function broadcastPos(room) {
  if (room.state === "playing") {
    broadcast(room, { t: "pos", players: publicPlayers(room) });
  }
}

function leave(ws) {
  const { id, code } = ws.data || {};
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  if (!room.players.has(id)) return;
  room.players.delete(id);

  if (room.state === "playing" || room.state === "meeting") {
    if (id === room.impostorId) {
      room.state = "ended";
      clearTimeout(room.meetingTimer);
      room.meetingTimer = null;
      room.meeting = null;
      broadcast(room, { t: "gameOver", winner: "crew", impostorId: id });
    } else {
      checkWin(room);
    }
  }

  broadcast(room, { t: "playerLeft", id });
  if (room.hostId === id) {
    const next = room.players.values().next().value;
    room.hostId = next ? next.id : null;
  }

  if (room.players.size === 0) {
    clearInterval(room.posTimer);
    clearTimeout(room.meetingTimer);
    rooms.delete(code);
  } else if (room.state === "lobby") {
    broadcast(room, { t: "lobby", players: lobbyPlayers(room) });
  }
}

function handle(ws, msg) {
  const t = msg && msg.t;
  if (!t) return;

  if (t === "create") {
    const room = makeRoom(makeCode());
    const p = makePlayer(msg.name, ws);
    p.x = 1100; p.y = 700;
    room.hostId = p.id;
    room.players.set(p.id, p);
    rooms.set(room.code, room);
    ws.data = { id: p.id, code: room.code };
    room.posTimer = setInterval(() => broadcastPos(room), 66);
    send(ws, { t: "created", code: room.code, you: p.id, players: lobbyPlayers(room) });
    return;
  }

  if (t === "join") {
    const room = rooms.get((msg.code || "").toUpperCase());
    if (!room) return send(ws, { t: "err", msg: "Sala no encontrada" });
    if (room.state !== "lobby") return send(ws, { t: "err", msg: "La partida ya comenzó" });
    if (room.players.size >= 12) return send(ws, { t: "err", msg: "Sala llena (máx. 12)" });
    const p = makePlayer(msg.name, ws);
    room.players.set(p.id, p);
    ws.data = { id: p.id, code: room.code };
    send(ws, { t: "joined", code: room.code, you: p.id, players: lobbyPlayers(room) });
    broadcast(room, { t: "lobby", players: lobbyPlayers(room) });
    return;
  }

  const { id, code } = ws.data || {};
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(id);
  if (!p) return;

  switch (t) {
    case "start":
      if (p.id !== room.hostId) break;
      if (room.state !== "lobby") break;
      if (room.players.size < 3) { send(ws, { t: "err", msg: "Se necesitan al menos 3 jugadores" }); break; }
      startGame(room);
      break;

    case "move":
      if (room.state !== "playing") break;
      p.x = clamp(Number(msg.x) || p.x, 20, WORLD.w - 20);
      p.y = clamp(Number(msg.y) || p.y, 20, WORLD.h - 20);
      p.dir = Number(msg.dir) || 0;
      p.moving = !!msg.moving;
      break;

    case "taskDone": {
      if (room.state !== "playing" || p.dead) break;
      const task = p.tasks.find((x) => x.id === msg.taskId);
      if (!task || task.done) break;
      task.done = true;
      if (p.id === room.impostorId) {
        send(ws, { t: "taskDone", taskId: task.id, done: room.doneTasks, total: room.totalTasks });
      } else {
        room.doneTasks++;
        broadcast(room, { t: "taskDone", taskId: task.id, by: p.name, done: room.doneTasks, total: room.totalTasks });
        checkWin(room);
      }
      break;
    }

    case "eliminate":
      eliminate(room, p.id, msg.targetId);
      break;

    case "report":
      report(room, p.id, msg.bodyId);
      break;

    case "emergency":
      emergency(room, p.id);
      break;

    case "vote":
      vote(room, p.id, msg.targetId);
      break;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

async function serveStatic(path) {
  const p = path === "/" ? "/index.html" : path;
  const safe = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (safe.includes("..")) return new Response("forbidden", { status: 400 });
  const filePath = import.meta.dir + "/public/" + (safe.join("/") || "index.html");
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return new Response(file, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return undefined;
      return new Response("upgrade failed", { status: 400 });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) { ws.data = {}; },
    message(ws, raw) {
      let msg;
      try {
        const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
        msg = JSON.parse(text);
      } catch (e) { return; }
      handle(ws, msg);
    },
    close(ws) { leave(ws); },
  },
});

console.log(`🚀 Junior Astronaut Mission Trainer en http://localhost:${PORT}`);
