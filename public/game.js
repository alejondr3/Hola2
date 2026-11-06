"use strict";

const $ = (s) => document.querySelector(s);
const canvas = $("#game");
const ctx = canvas.getContext("2d");

let ws = null;
let myId = null, role = null, roomCode = null;
let phase = "menu"; // menu | lobby | playing | meeting | ended
let players = {};
let stations = [], emergency = { x: 900, y: 560 }, world = { w: 2200, h: 1400 };
let myTasks = [];
let taskDoneCount = 0, taskTotal = 0;
let bodies = [];
let cam = { x: 0, y: 0 };
let keys = {};
let lastMoveSent = 0, killCd = 0;
let currentTask = null, taskProgress = 0;
let voteSelected = "skip", meetingDeadline = 0, ejectShown = 0, voted = false;

const ZONES = [
  { x: 850, y: 500, w: 500, h: 400, label: "Cafetería", color: "#22324a" },
  { x: 100, y: 100, w: 500, h: 400, label: "Reactor", color: "#1e3a2e" },
  { x: 1600, y: 100, w: 500, h: 400, label: "Navegación", color: "#242447" },
  { x: 1600, y: 900, w: 500, h: 400, label: "Laboratorio", color: "#3a2440" },
  { x: 100, y: 900, w: 500, h: 400, label: "Oxígeno", color: "#243a3a" },
  { x: 850, y: 100, w: 500, h: 300, label: "Almacén", color: "#3a3320" },
  { x: 850, y: 1000, w: 500, h: 300, label: "Comunicaciones", color: "#2c2340" },
];

const OBSTACLES = [
  { x: 250, y: 250, w: 80, h: 80 },
  { x: 1700, y: 240, w: 120, h: 60 },
  { x: 1700, y: 1000, w: 130, h: 70 },
  { x: 250, y: 1000, w: 90, h: 90 },
  { x: 900, y: 720, w: 150, h: 80 },
  { x: 880, y: 180, w: 130, h: 80 },
  { x: 1050, y: 180, w: 130, h: 80 },
];

const STARS = [];
for (let i = 0; i < 180; i++) {
  STARS.push({
    x: Math.random() * 2200,
    y: Math.random() * 1400,
    r: Math.random() * 1.6 + 0.3,
    a: Math.random() * 0.7 + 0.3,
  });
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function shade(hex, amt) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- conexión ----
function sendRaw(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function connect() {
  if (location.protocol === "file:") {
    $("#menuErr").textContent = "Abrí http://localhost:3000 (no abras el archivo directamente)";
    return;
  }
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  ws = new WebSocket(proto + location.host + "/ws");
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    handle(m);
  };
  ws.onclose = () => {
    if (phase !== "menu") $("#menuErr").textContent = "Conexión perdida. Recargá la página.";
  };
}

function handle(m) {
  switch (m.t) {
    case "created": roomCode = m.code; myId = m.you; showLobby(m.players); break;
    case "joined": roomCode = m.code; myId = m.you; showLobby(m.players); break;
    case "lobby": renderLobby(m.players); break;
    case "err": alert(m.msg); break;
    case "started": onStarted(m); break;
    case "pos": onPos(m); break;
    case "taskDone": onTaskDone(m); break;
    case "eliminated": onEliminated(m); break;
    case "meeting": onMeeting(m); break;
    case "voteCast": onVoteCast(m); break;
    case "ejected": onEjected(m); break;
    case "resume": onResume(); break;
    case "gameOver": onGameOver(m); break;
    case "playerLeft": onPlayerLeft(m.id); break;
  }
}

// ---- lobby ----
function showOverlay(id) {
  ["menu", "lobby", "meeting", "gameover"].forEach((o) => $("#" + o).classList.add("hidden"));
  if (id) $("#" + id).classList.remove("hidden");
}

function showLobby(list) {
  phase = "lobby";
  showOverlay("lobby");
  renderLobby(list);
}

function renderLobby(list) {
  $("#roomCode").textContent = roomCode;
  const box = $("#lobbyList");
  box.innerHTML = "";
  let amHost = false;
  for (const p of list) {
    if (p.id === myId) amHost = !!p.host;
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<span class="dot" style="background:${p.color}"></span><span>${escapeHtml(p.name)}${p.host ? " ⭐" : ""}</span>`;
    box.appendChild(row);
  }
  $("#btnStart").classList.toggle("hidden", !amHost);
}

// ---- arranque ----
function onStarted(m) {
  role = m.role;
  myId = m.you;
  stations = m.stations || [];
  emergency = m.emergency || { x: 900, y: 560 };
  world = m.world || { w: 2200, h: 1400 };
  myTasks = m.tasks || [];
  taskTotal = m.taskTotal || 0;
  taskDoneCount = m.taskDone || 0;
  bodies = [];
  players = {};
  for (const p of m.players) {
    players[p.id] = Object.assign({}, p, { tx: p.x, ty: p.y, tdir: p.dir, tmoving: p.moving });
  }
  currentTask = null; taskProgress = 0;
  phase = "playing";
  showOverlay(null);
  $("#hud").classList.remove("hidden");
  $("#hudCode").textContent = "Sala " + roomCode;
  $("#hudRole").textContent = role === "impostor" ? "👾 Impostor" : "🧑‍🚀 Tripulación";
  renderTasks();
  updateBar();
  toast(role === "impostor" ? "👾 Sos el IMPOSTOR — eliminá a la tripulación" : "🧑‍🚀 Sos TRIPULACIÓN — completá tus tareas");
}

function renderTasks() {
  const panel = $("#taskPanel");
  if (role === "impostor") {
    panel.innerHTML = "<h4>OBJETIVO</h4><div class='task'>Eliminá a la tripulación</div>";
    return;
  }
  panel.innerHTML = "<h4>TAREAS</h4>";
  for (const t of myTasks) {
    const d = document.createElement("div");
    d.className = "task" + (t.done ? " done" : "");
    d.textContent = (t.done ? "✔ " : "• ") + t.name + " — " + t.label;
    panel.appendChild(d);
  }
}

function updateBar() {
  const bar = $("#hudBar"), txt = $("#hudBarText");
  if (role === "crew") {
    const pct = taskTotal > 0 ? Math.round((taskDoneCount / taskTotal) * 100) : 0;
    bar.style.width = pct + "%";
    txt.textContent = `Tareas ${taskDoneCount}/${taskTotal} (${pct}%)`;
  } else {
    bar.style.width = "0%";
    txt.textContent = "👾 Sabotaje en curso";
  }
}

function onPos(m) {
  for (const p of m.players) {
    if (p.id === myId) {
      const me = players[p.id];
      if (me) { me.dead = p.dead; me.ghost = p.ghost; }
      continue;
    }
    let pl = players[p.id];
    if (!pl) { pl = Object.assign({}, p); players[p.id] = pl; }
    pl.tx = p.x; pl.ty = p.y; pl.tdir = p.dir; pl.tmoving = p.moving;
    pl.dead = p.dead; pl.ghost = p.ghost; pl.name = p.name; pl.color = p.color;
  }
}

function onTaskDone(m) {
  const t = myTasks.find((x) => x.id === m.taskId);
  if (t) t.done = true;
  if (role === "crew") { taskDoneCount = m.done; taskTotal = m.total; }
  renderTasks();
  updateBar();
}

function onEliminated(m) {
  const p = players[m.id];
  if (p) { p.dead = true; p.ghost = true; }
  bodies.push({ id: m.id, x: m.x, y: m.y, color: p ? p.color : "#fff" });
  if (m.id === myId) toast("💀 Fuiste eliminado — ahora sos un fantasma");
}

function onPlayerLeft(id) {
  if (phase === "lobby") return;
  if (players[id]) {
    toast(players[id].name + " abandonó la partida");
    delete players[id];
  }
}

// ---- reunión / votación ----
function onMeeting(m) {
  phase = "meeting";
  voted = false;
  ejectShown = 0;
  meetingDeadline = Date.now() + 30000;
  $("#meetingTitle").textContent = m.reason === "report" ? "🚨 ¡Cuerpo reportado!" : "🔴 Reunión de emergencia";
  $("#ejectedResult").textContent = "";
  $("#voteStatus").textContent = "";
  const me = players[myId];
  if (me && me.ghost) {
    $("#voteList").innerHTML = '<div class="sub">👻 Sos fantasma: observá la votación</div>';
    $("#voteConfirm").disabled = true;
  } else {
    buildVoteList(m.players);
  }
  showOverlay("meeting");
}

function buildVoteList(list) {
  voteSelected = "skip";
  const box = $("#voteList");
  box.innerHTML = "";
  const add = (id, color, label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vote-card" + (id === "skip" ? " sel" : "");
    b.dataset.id = id;
    b.innerHTML = `<span class="dot" style="background:${color}"></span><span>${escapeHtml(label)}</span><span class="voted"></span>`;
    b.onclick = () => {
      voteSelected = id;
      [...box.children].forEach((c) => c.classList.remove("sel"));
      b.classList.add("sel");
    };
    box.appendChild(b);
  };
  for (const p of list) {
    if (p.dead) continue;
    if (p.id === myId) continue;
    add(p.id, p.color, p.name);
  }
  add("skip", "#7788aa", "Saltar voto");
  $("#voteConfirm").disabled = false;
}

function confirmVote() {
  if (voted) return;
  voted = true;
  $("#voteConfirm").disabled = true;
  $("#voteStatus").textContent = "Voto enviado ✔";
  sendRaw({ t: "vote", targetId: voteSelected });
}

function onVoteCast(m) {
  const card = $("#voteList").querySelector('[data-id="' + m.voterId + '"]');
  if (card) {
    const v = card.querySelector(".voted");
    if (v) v.textContent = "✔";
  }
}

function onEjected(m) {
  ejectShown = Date.now();
  if (m.ejectedId) {
    const p = players[m.ejectedId];
    const nm = p ? p.name : "Alguien";
    if (p) { p.dead = true; p.ghost = true; }
    $("#ejectedResult").textContent = `${nm} fue expulsado — ${m.wasImpostor ? "¡era el impostor! 🎉" : "no era el impostor 😬"}`;
  } else {
    $("#ejectedResult").textContent = "Empate: nadie fue expulsado.";
  }
}

function onResume() {
  const wait = Math.max(0, 3000 - (Date.now() - ejectShown));
  setTimeout(() => {
    showOverlay(null);
    phase = "playing";
  }, wait);
}

function onGameOver(m) {
  phase = "ended";
  const crewWon = m.winner === "crew";
  $("#goTitle").textContent = crewWon ? "🎉 ¡La tripulación ganó!" : "👾 ¡El impostor ganó!";
  const imp = players[m.impostorId];
  $("#goSub").textContent = imp ? `El impostor era ${imp.name}` : "";
  showOverlay("gameover");
}

// ---- helpers UI ----
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
}
function setHint(msg) { $("#hint").textContent = msg || ""; }

// ---- movimiento ----
function collides(x, y, r) {
  return OBSTACLES.some((o) => {
    const nx = Math.max(o.x, Math.min(x, o.x + o.w));
    const ny = Math.max(o.y, Math.min(y, o.y + o.h));
    const dx = x - nx, dy = y - ny;
    return dx * dx + dy * dy < r * r;
  });
}

function updateMovement(dt) {
  const me = players[myId];
  if (!me) return;
  let vx = 0, vy = 0;
  if (keys.w || keys.arrowup) vy -= 1;
  if (keys.s || keys.arrowdown) vy += 1;
  if (keys.a || keys.arrowleft) vx -= 1;
  if (keys.d || keys.arrowright) vx += 1;
  if (vx || vy) {
    const len = Math.hypot(vx, vy);
    vx /= len; vy /= len;
    const sp = 260, r = 18;
    const nx = me.x + vx * sp * dt, ny = me.y + vy * sp * dt;
    if (!collides(nx, me.y, r)) me.x = clamp(nx, 20, world.w - 20);
    if (!collides(me.x, ny, r)) me.y = clamp(ny, 20, world.h - 20);
    me.dir = Math.atan2(vy, vx);
    me.moving = true;
  } else {
    me.moving = false;
  }
  if (performance.now() - lastMoveSent > 66) {
    lastMoveSent = performance.now();
    sendRaw({ t: "move", x: me.x, y: me.y, dir: me.dir, moving: me.moving });
  }
}

function updateRemote() {
  for (const id in players) {
    if (id === myId) continue;
    const p = players[id];
    if (p.tx !== undefined) {
      p.x += (p.tx - p.x) * 0.3;
      p.y += (p.ty - p.y) * 0.3;
      p.dir = p.tdir !== undefined ? p.tdir : p.dir;
      p.moving = p.tmoving !== undefined ? p.tmoving : p.moving;
    }
  }
}

function doTask(task, dt) {
  if (currentTask !== task) { currentTask = task; taskProgress = 0; }
  taskProgress += dt / 2.0;
  if (taskProgress >= 1) {
    taskProgress = 0; currentTask = null;
    keys.space = false;
    task.done = true;
    sendRaw({ t: "taskDone", taskId: task.id });
    renderTasks();
    updateBar();
  }
}

function updateInteractions(dt) {
  const me = players[myId];
  if (!me) return;
  let hint = "";

  if (me.ghost) {
    hint = "👻 Sos un fantasma — observá la partida";
  } else {
    if (role === "impostor") {
      let target = null, bd = 95;
      for (const id in players) {
        const o = players[id];
        if (id === myId || o.dead) continue;
        const d = Math.hypot(me.x - o.x, me.y - o.y);
        if (d < bd) { bd = d; target = o; }
      }
      if (target) {
        hint = "ESPACIO: eliminar a " + target.name;
        if (keys.space && performance.now() - killCd > 15000) {
          killCd = performance.now();
          sendRaw({ t: "eliminate", targetId: target.id });
        }
      }
    } else {
      let t = null, td = 62;
      for (const task of myTasks) {
        if (task.done) continue;
        const d = Math.hypot(me.x - task.x, me.y - task.y);
        if (d < td) { td = d; t = task; }
      }
      if (t) {
        hint = "Mantén ESPACIO: " + t.name;
        if (keys.space) doTask(t, dt);
      }
    }

    for (const b of bodies) {
      if (Math.hypot(me.x - b.x, me.y - b.y) < 62) {
        hint += (hint ? "   ·   " : "") + "R: reportar cuerpo";
        if (keys.r) { keys.r = false; sendRaw({ t: "report", bodyId: b.id }); }
        break;
      }
    }

    if (Math.hypot(me.x - emergency.x, me.y - emergency.y) < 75) {
      hint += (hint ? "   ·   " : "") + "E: reunión de emergencia";
      if (keys.e) { keys.e = false; sendRaw({ t: "emergency" }); }
    }
  }
  setHint(hint);
}

function updateMeetingTimer() {
  const left = Math.max(0, Math.ceil((meetingDeadline - Date.now()) / 1000));
  $("#meetingTimer").textContent = "Tiempo restante: " + left + "s";
}

// ---- render ----
function updateCamera() {
  const me = players[myId];
  if (!me) return;
  cam.x = clamp(me.x - canvas.width / 2, 0, Math.max(0, world.w - canvas.width));
  cam.y = clamp(me.y - canvas.height / 2, 0, Math.max(0, world.h - canvas.height));
}

function drawMenuBg() {
  ctx.fillStyle = "#05060f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const t = performance.now();
  for (let i = 0; i < STARS.length; i += 3) {
    const s = STARS[i];
    const sx = (s.x * 0.2 + t * 0.01 * ((i % 5) + 1)) % canvas.width;
    const sy = (s.y * 0.2) % canvas.height;
    ctx.globalAlpha = s.a;
    ctx.fillStyle = "#cfe0ff";
    ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawWorld() {
  ctx.fillStyle = "#080b16";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const s of STARS) {
    const sx = s.x - cam.x, sy = s.y - cam.y;
    if (sx < -4 || sx > canvas.width + 4 || sy < -4 || sy > canvas.height + 4) continue;
    ctx.globalAlpha = s.a;
    ctx.fillStyle = "#cfe0ff";
    ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "rgba(80,100,150,0.08)";
  ctx.lineWidth = 1;
  const gs = 80;
  const gx0 = Math.floor(cam.x / gs) * gs, gy0 = Math.floor(cam.y / gs) * gs;
  for (let x = gx0; x < cam.x + canvas.width + gs; x += gs) {
    ctx.beginPath(); ctx.moveTo(x - cam.x, 0); ctx.lineTo(x - cam.x, canvas.height); ctx.stroke();
  }
  for (let y = gy0; y < cam.y + canvas.height + gs; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y - cam.y); ctx.lineTo(canvas.width, y - cam.y); ctx.stroke();
  }

  for (const z of ZONES) {
    const x = z.x - cam.x, y = z.y - cam.y;
    if (x > canvas.width + 10 || x + z.w < -10 || y > canvas.height + 10 || y + z.h < -10) continue;
    ctx.fillStyle = z.color;
    roundRectPath(x, y, z.w, z.h, 18); ctx.fill();
    ctx.strokeStyle = "rgba(120,150,200,0.25)";
    ctx.lineWidth = 2;
    roundRectPath(x, y, z.w, z.h, 18); ctx.stroke();
    ctx.fillStyle = "rgba(234,242,255,0.5)";
    ctx.font = "bold 20px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(z.label, x + z.w / 2, y + 28);
  }

  for (const o of OBSTACLES) {
    const x = o.x - cam.x, y = o.y - cam.y;
    if (x > canvas.width + 10 || x + o.w < -10 || y > canvas.height + 10 || y + o.h < -10) continue;
    ctx.fillStyle = "#1a2338";
    roundRectPath(x, y, o.w, o.h, 10); ctx.fill();
    ctx.strokeStyle = "rgba(150,170,210,0.2)";
    ctx.lineWidth = 2;
    roundRectPath(x, y, o.w, o.h, 10); ctx.stroke();
  }

  drawEmergency();

  if (role === "crew") {
    for (const t of myTasks) {
      if (t.done) continue;
      const x = t.x - cam.x, y = t.y - cam.y;
      if (x < -30 || x > canvas.width + 30 || y < -30 || y > canvas.height + 30) continue;
      const pulse = 1 + Math.sin(performance.now() / 200) * 0.15;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "rgba(255,230,80,0.25)";
      ctx.fillRect(-13 * pulse, -13 * pulse, 26 * pulse, 26 * pulse);
      ctx.strokeStyle = "#ffe650";
      ctx.lineWidth = 2;
      ctx.strokeRect(-10, -10, 20, 20);
      ctx.restore();
    }
  }

  for (const b of bodies) {
    const x = b.x - cam.x, y = b.y - cam.y;
    if (x < -40 || x > canvas.width + 40 || y < -40 || y > canvas.height + 40) continue;
    drawBody(x, y, b.color);
  }

  for (const p of Object.values(players)) {
    const x = p.x - cam.x, y = p.y - cam.y;
    if (x < -60 || x > canvas.width + 60 || y < -60 || y > canvas.height + 60) continue;
    drawAstronaut(x, y, p.color, p.dir, p.moving, p.ghost, p.name);
  }

  if (currentTask && role === "crew") drawTaskRing();
}

function drawEmergency() {
  const x = emergency.x - cam.x, y = emergency.y - cam.y;
  if (x < -60 || x > canvas.width + 60 || y < -60 || y > canvas.height + 60) return;
  ctx.fillStyle = "#3a2430";
  ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ff4d6d";
  ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("!", x, y + 5);
}

function drawBody(x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  roundRectPath(-16, -18, 32, 40, 14); ctx.fill();
  ctx.fillStyle = "#1d5f9e";
  roundRectPath(-6, -12, 16, 20, 7); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawAstronaut(px, py, color, dir, moving, ghost, name) {
  ctx.save();
  ctx.translate(px, py);
  if (ghost) ctx.globalAlpha = 0.35;
  const faceRight = Math.cos(dir || 0) >= 0;

  if (moving) {
    const t = performance.now() / 110;
    ctx.fillStyle = shade(color, -30);
    ctx.beginPath(); ctx.ellipse(-3 + Math.sin(t) * 4, 20, 6, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3 - Math.sin(t) * 4, 20, 6, 10, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = shade(color, -30);
    ctx.beginPath(); ctx.ellipse(-4, 20, 6, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 20, 6, 10, 0, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = shade(color, -45);
  roundRectPath(faceRight ? -24 : 8, -9, 17, 26, 6); ctx.fill();

  ctx.fillStyle = color;
  roundRectPath(-16, -18, 32, 42, 14); ctx.fill();

  const vg = ctx.createLinearGradient(0, -14, 0, 16);
  vg.addColorStop(0, "#9fdcff");
  vg.addColorStop(1, "#1d5f9e");
  ctx.fillStyle = vg;
  roundRectPath(faceRight ? 1 : -21, -10, 20, 26, 8); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  roundRectPath(faceRight ? 3 : -19, -8, 7, 10, 3); ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;

  if (name) {
    ctx.font = "bold 14px system-ui";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(name, px, py - 34);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, px, py - 34);
  }
}

function drawTaskRing() {
  const me = players[myId];
  if (!me) return;
  const x = me.x - cam.x, y = me.y - cam.y;
  ctx.beginPath();
  ctx.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + taskProgress * Math.PI * 2);
  ctx.strokeStyle = "#3bff8a";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 34, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 5;
  ctx.stroke();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (phase === "playing" || phase === "meeting") {
    updateCamera();
    drawWorld();
  } else {
    drawMenuBg();
  }
}

// ---- bucle ----
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (phase === "playing") {
    updateMovement(dt);
    updateRemote();
    updateInteractions(dt);
    updateBar();
  } else if (phase === "meeting") {
    updateMeetingTimer();
  }
  render();
  requestAnimationFrame(loop);
}

// ---- eventos ----
const PREVENT = new Set(["space", "arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "r", "e"]);
addEventListener("keydown", (e) => {
  const k = e.key === " " ? "space" : e.key.toLowerCase();
  keys[k] = true;
  if (PREVENT.has(k)) e.preventDefault();
});
addEventListener("keyup", (e) => {
  const k = e.key === " " ? "space" : e.key.toLowerCase();
  keys[k] = false;
});
addEventListener("resize", () => {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
});

function askName() {
  const v = $("#name").value.trim();
  if (!v) { $("#menuErr").textContent = "Escribí tu nombre"; return null; }
  $("#menuErr").textContent = "";
  return v;
}

$("#btnCreate").onclick = () => { const n = askName(); if (n) sendRaw({ t: "create", name: n }); };
$("#btnJoin").onclick = () => {
  const n = askName(); if (!n) return;
  const code = $("#code").value.trim().toUpperCase();
  if (!code) { $("#menuErr").textContent = "Escribí el código de la sala"; return; }
  sendRaw({ t: "join", name: n, code });
};
$("#btnStart").onclick = () => sendRaw({ t: "start" });
$("#btnLeave").onclick = () => location.reload();
$("#btnReload").onclick = () => location.reload();
$("#btnCopy").onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(roomCode); };
$("#voteConfirm").onclick = confirmVote;

$("#name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnCreate").click(); });

// ---- init ----
canvas.width = innerWidth;
canvas.height = innerHeight;
showOverlay("menu");
$("#name").focus();
connect();
requestAnimationFrame(loop);
