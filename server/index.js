// مين الجاسوس؟ — سيرفر الرومات (WebSocket)
// State machine: lobby -> reveal -> discussion -> voting -> spyGuess -> results -> (nextRound)
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const { CATEGORIES, pickWord, countWords } = require("./words");

const PORT = process.env.PORT || 8080;
const REVEAL_MS = 12000;          // وقت كشف الدور
const SPY_GUESS_MS = 45000;       // وقت تخمين الجاسوس
const ROOM_IDLE_MS = 2 * 3600000; // مسح الرومات الخاملة
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 3;

const rooms = new Map(); // code -> room

function rid(n = 16) { return crypto.randomBytes(n).toString("hex"); }
function makeCode() {
  const abc = "ابجدهوزحطيكلمنسعفصقرشتثخذضظغ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return c;
}

function makeRoom(hostName) {
  let code;
  do { code = makeCode(); } while (rooms.has(code));
  const room = {
    code,
    createdAt: Date.now(),
    lastActive: Date.now(),
    phase: "lobby",
    players: [], // {id, token, name, score, connected, isHost}
    round: 0,
    game: null, // {word, category, spies:[id], votes:{}, timerEndsAt, spyGuess, spyGuessCorrect, caught, resultLines, config, mode, questions, turnOrder, askedIds, turn}
    audio: new Map(), // qid -> {buf, mime} للأسئلة الصوتية
    timer: null,
  };
  rooms.set(code, room);
  return room;
}

function touch(room) { room.lastActive = Date.now(); }

function clearTimer(room) { if (room.timer) { clearTimeout(room.timer); room.timer = null; } }

function publicPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, isHost: p.isHost }));
}

// حالة مخصصة لكل لاعب (الكلمة تروح بس للي مش جواسيس)
function stateFor(room, player) {
  const s = {
    type: "state",
    code: room.code,
    phase: room.phase,
    round: room.round,
    players: publicPlayers(room),
    you: { id: player.id, isHost: player.isHost, score: player.score },
    categories: CATEGORIES,
  };
  if (room.game) {
    const g = room.game;
    const isSpy = g.spies.includes(player.id);
    s.game = {
      category: g.category,
      isSpy,
      word: isSpy ? null : g.word,
      spiesKnown: room.phase === "results" || room.phase === "voting" || room.phase === "spyGuess" ? g.spies : undefined,
      timerEndsAt: g.timerEndsAt,
      votes: room.phase === "results" ? g.votes : countVotes(room),
      votesNeeded: room.phase === "voting" ? room.players.filter(p => p.connected).length : undefined,
      youVoted: room.phase === "voting" ? Boolean(g.votes[player.id]) : undefined,
      mode: g.mode,
      qMode: room.phase === "questioning" ? g.qMode : undefined,
      cycle: room.phase === "questioning" ? g.cycle : undefined,
      cyclesTotal: room.phase === "questioning" ? g.config.cycles : undefined,
      turn: room.phase === "questioning" ? g.turn : undefined,
      questions: g.questions && g.questions.length && ["questioning", "voting", "spyGuess", "results"].includes(room.phase) ? g.questions : undefined,
      spyGuess: room.phase === "results" ? g.spyGuess : undefined,
      spyGuessCorrect: room.phase === "results" ? g.spyGuessCorrect : undefined,
      caught: room.phase === "results" ? g.caught : undefined,
      resultLines: room.phase === "results" ? g.resultLines : undefined,
      wordRevealed: room.phase === "results" ? g.word : undefined,
      config: g.config,
    };
  }
  return s;
}

function countVotes(room) {
  const counts = {};
  for (const t of Object.values(room.game.votes)) counts[t] = (counts[t] || 0) + 1;
  return counts;
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify(stateFor(room, p)));
    }
  }
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function err(ws, message) { send(ws, { type: "error", message }); }

function startRound(room, config) {
  if (room.players.length < MIN_PLAYERS) return "محتاجين على الأقل ٣ لاعبين";
  const nSpies = Math.min(Math.max(1, config.spies || 1), 2);
  if (nSpies >= room.players.length) return "عدد الجواسيس كبير على عدد اللاعبين";
  const { word, category } = pickWord(config.category);
  const shuffled = [...room.players].sort(() => Math.random() - 0.5);
  room.round += 1;
  room.game = {
    word, category,
    spies: shuffled.slice(0, nSpies).map(p => p.id),
    votes: {},
    timerEndsAt: Date.now() + REVEAL_MS,
    spyGuess: null, spyGuessCorrect: false, caught: null, resultLines: null,
    config: { spies: nSpies, category: category, discussionSec: config.discussionSec || 240, mode: config.mode === "questions" ? "questions" : "talk", cycles: Math.min(5, Math.max(1, config.cycles || 3)) },
    mode: config.mode === "questions" ? "questions" : "talk",
    questions: [], turnOrder: [], askedIds: [], turn: null, cycle: 1, qMode: "directed",
  };
  room.audio = new Map();
  clearTimer(room);
  room.phase = "reveal";
  room.timer = setTimeout(() => afterReveal(room), REVEAL_MS);
  touch(room);
  return null;
}

function afterReveal(room) {
  if (!room.game) return;
  if (room.game.mode === "questions") return startQuestioning(room);
  return startDiscussion(room);
}

function startQuestioning(room) {
  const g = room.game;
  if (!g) return;
  room.phase = "questioning";
  g.timerEndsAt = null;
  g.questions = [];
  g.turnOrder = room.players.map(p => p.id);
  g.askedIds = [];
  g.cycle = 1;
  g.qMode = "directed";
  g.turn = g.turnOrder.find(id => room.players.find(p => p.id === id)?.connected) || null;
  clearTimer(room);
  if (!g.turn) { g.qMode = "open"; }
  touch(room); broadcast(room);
}

// الدور اللي بعده في الدورة الموجهة؛ بعد كل دورة كاملة تبدأ دورة جديدة،
// وبعد عدد الدورات المتفق عليه تتفتح الساحة للكل
function advanceTurn(room) {
  const g = room.game;
  if (!g || room.phase !== "questioning" || g.qMode !== "directed") return;
  const isConnected = (id) => room.players.find(p => p.id === id)?.connected;
  if (g.turn) g.askedIds.push(g.turn);
  let next = g.turnOrder.find(id => !g.askedIds.includes(id) && isConnected(id));
  if (!next) {
    g.cycle += 1;
    g.askedIds = [];
    if (g.cycle > g.config.cycles) {
      g.qMode = "open";
      g.turn = null;
      return;
    }
    next = g.turnOrder.find(id => isConnected(id)) || null;
  }
  g.turn = next;
  if (!next) { g.qMode = "open"; }
}

function startDiscussion(room) {
  const g = room.game;
  if (!g) return;
  room.phase = "discussion";
  g.timerEndsAt = Date.now() + g.config.discussionSec * 1000;
  clearTimer(room);
  room.timer = setTimeout(() => startVoting(room), g.config.discussionSec * 1000);
  touch(room); broadcast(room);
}

function startVoting(room) {
  if (!room.game) return;
  room.phase = "voting";
  room.game.timerEndsAt = null;
  clearTimer(room);
  touch(room); broadcast(room);
}

function checkAllVoted(room) {
  const g = room.game;
  const connected = room.players.filter(p => p.connected);
  if (connected.length > 0 && connected.every(p => g.votes[p.id])) resolveVotes(room);
}

function resolveVotes(room) {
  const g = room.game;
  if (!g || room.phase !== "voting") return;
  const counts = countVotes(room);
  let top = null, topN = 0, tie = false;
  for (const [pid, n] of Object.entries(counts)) {
    if (n > topN) { top = pid; topN = n; tie = false; }
    else if (n === topN) tie = true;
  }
  g.caught = (!tie && top && g.spies.includes(top)) ? top : (g.spies.includes(top) && !tie ? top : null);
  // لو مفيش تصويت حاسم أو الأغلبية مش جاسوس -> الجاسوس نجا
  room.phase = "spyGuess";
  g.timerEndsAt = Date.now() + SPY_GUESS_MS;
  clearTimer(room);
  room.timer = setTimeout(() => finishRound(room), SPY_GUESS_MS);
  touch(room); broadcast(room);
}

function normalize(s) { return (s || "").trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي"); }

function finishRound(room) {
  const g = room.game;
  if (!g) return;
  clearTimer(room);
  const lines = [];
  const spyNames = g.spies.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean);
  if (g.caught) {
    const name = room.players.find(p => p.id === g.caught)?.name;
    lines.push(`اللعيبة مسكوا الجاسوس: ${name}!`);
  } else {
    lines.push(`الجاسوس نجا من التصويت... (${spyNames.join(" و")})`);
  }
  if (g.spyGuess) {
    g.spyGuessCorrect = normalize(g.spyGuess) === normalize(g.word);
    lines.push(g.spyGuessCorrect ? `بس الجاسوس خمّن الكلمة صح: "${g.word}"!` : `الجاسوس خمّن "${g.spyGuess}" وكانت غلط.`);
  }
  // النقط
  const spyWon = g.spyGuessCorrect || !g.caught;
  for (const p of room.players) {
    if (g.spies.includes(p.id)) { if (spyWon) p.score += 3; }
    else if (!spyWon) p.score += 2;
  }
  lines.push(spyWon ? "الجولة دي للجاسوس +3 نقط" : "الجولة دي للعيبة +2 نقط لكل واحد");
  g.resultLines = lines;
  room.phase = "results";
  g.timerEndsAt = null;
  touch(room); broadcast(room);
}

function handleLeave(room, player) {
  room.players = room.players.filter(p => p !== player);
  if (player.isHost && room.players.length) {
    const next = room.players.find(p => p.connected) || room.players[0];
    room.players.forEach(p => p.isHost = false);
    next.isHost = true;
  }
  if (room.players.length === 0) { clearTimer(room); rooms.delete(room.code); }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const m = (req.url || "").match(/^\/audio\/([^/]+)\/([^/]+)$/);
  if (m) {
    const r = rooms.get(decodeURIComponent(m[1]));
    const a = r?.audio.get(m[2]);
    if (!a) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": a.mime, "Content-Length": a.buf.length, "Cache-Control": "private, max-age=3600" });
    return res.end(a.buf);
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, service: "meen-mesh-maana", words: countWords(), rooms: rooms.size }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let room = null, player = null;

  function joinRoom(r, p) {
    room = r; player = p;
    p.ws = ws; p.connected = true;
    touch(r);
    send(ws, Object.assign({}, stateFor(r, p), { type: "joined", token: p.token }));
    broadcast(r);
  }

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    touch(room || { lastActive: 0 });

    if (m.type === "create") {
      const name = (m.name || "").trim().slice(0, 20);
      if (!name) return err(ws, "اكتب اسمك الأول");
      const r = makeRoom();
      const p = { id: rid(8), token: rid(12), name, score: 0, connected: false, isHost: true };
      r.players.push(p);
      return joinRoom(r, p);
    }
    if (m.type === "join") {
      const r = rooms.get((m.code || "").trim());
      if (!r) return err(ws, "الكود ده مش موجود، اتأكد منه");
      if (r.players.length >= MAX_PLAYERS) return err(ws, "الروم مليانة (١٠ لاعبين كحد أقصى)");
      const name = (m.name || "").trim().slice(0, 20);
      if (!name) return err(ws, "اكتب اسمك الأول");
      if (r.players.some(p => p.name === name && p.connected)) return err(ws, "فيه حد بالاسم ده جوه الروم، اختار اسم تاني");
      const p = { id: rid(8), token: rid(12), name, score: 0, connected: false, isHost: false };
      r.players.push(p);
      return joinRoom(r, p);
    }
    if (m.type === "rejoin") {
      const r = rooms.get((m.code || "").trim());
      if (!r) return err(ws, "الروم اتقفلت");
      const p = r.players.find(x => x.token === m.token);
      if (!p) return err(ws, "مش لاقيينك في الروم دي، ادخل من الأول");
      return joinRoom(r, p);
    }
    if (!room || !player) return err(ws, "ادخل روم الأول");

    if (m.type === "start") {
      if (!player.isHost) return err(ws, "الهوست بس اللي يبدأ");
      if (room.phase !== "lobby") return err(ws, "الجولة شغالة خلاص");
      const e = startRound(room, { spies: m.spies, category: m.category, mode: m.mode, cycles: m.cycles, discussionSec: Math.min(600, Math.max(60, m.discussionSec || 240)) });
      if (e) return err(ws, e);
      return broadcast(room);
    }
    if (m.type === "skipReveal" && room.phase === "reveal") return afterReveal(room);
    if (m.type === "startVote") {
      // التصويت بيبدأ بقرار الجروب — الهوست هو اللي بيدوس الزرار
      if (!player.isHost) return err(ws, "الهوست هو اللي يبدأ التصويت");
      if (room.phase === "discussion") return startVoting(room);
      return;
    }
    if (m.type === "ask" || m.type === "askText") {
      if (room.phase !== "questioning" || !room.game) return;
      const g = room.game;
      // في الساحة المفتوحة أي حد يسأل في أي وقت؛ في الدورات الموجهة لازم يكون دورك
      if (g.qMode === "directed" && g.turn !== player.id) return err(ws, "لسه مش دورك");
      const target = room.players.find(p => p.id === m.targetId);
      if (!target || target.id === player.id) return err(ws, "اختار حد تاني تسأله");
      if (m.type === "ask") {
        const b64 = m.audioB64 || "";
        if (b64.length > 4200000) return err(ws, "الرسالة الصوتية كبيرة أوي، خليها أقصر");
        const buf = Buffer.from(b64, "base64");
        if (!buf.length) return err(ws, "الصوت وصل فاضي، سجّل تاني");
        const qid = rid(6);
        room.audio.set(qid, { buf, mime: String(m.mime || "audio/webm").slice(0, 60) });
        g.questions.push({ id: qid, fromId: player.id, toId: target.id, kind: "audio", url: `/audio/${room.code}/${qid}` });
      } else {
        const text = (m.text || "").trim().slice(0, 300);
        if (!text) return;
        g.questions.push({ id: rid(6), fromId: player.id, toId: target.id, kind: "text", text });
      }
      advanceTurn(room); // في الساحة المفتوحة مش بيأثر
      touch(room);
      return broadcast(room);
    }
    if (m.type === "skipTurn") {
      if (!player.isHost) return err(ws, "الهوست بس اللي يعدّي الدور");
      if (room.phase !== "questioning" || room.game?.qMode !== "directed") return;
      advanceTurn(room);
      touch(room);
      return broadcast(room);
    }
    if (m.type === "endQuestions") {
      if (!player.isHost) return err(ws, "الهوست هو اللي يبدأ التصويت");
      if (room.phase !== "questioning") return;
      return startVoting(room);
    }
    if (m.type === "vote") {
      if (room.phase !== "voting" || !room.game) return;
      const target = room.players.find(p => p.id === m.targetId);
      if (!target || target.id === player.id) return;
      room.game.votes[player.id] = target.id;
      broadcast(room);
      return checkAllVoted(room);
    }
    if (m.type === "spyGuess") {
      if (room.phase !== "spyGuess" || !room.game) return;
      if (!room.game.spies.includes(player.id)) return;
      room.game.spyGuess = (m.word || "").trim().slice(0, 60);
      return finishRound(room);
    }
    if (m.type === "nextRound") {
      if (!player.isHost) return err(ws, "الهوست بس اللي يظبط الجولة الجاية");
      if (room.phase !== "results") return;
      room.phase = "lobby"; room.game = null;
      touch(room); return broadcast(room);
    }
    if (m.type === "leave") {
      handleLeave(room, player);
      room = null; player = null;
      try { ws.close(); } catch {}
      if (room) broadcast(room);
      return;
    }
  });

  ws.on("close", () => {
    if (room && player) {
      player.connected = false; player.ws = null;
      // لو اللي فصل كان دوره يسأل، عدّي الدور
      if (room.phase === "questioning" && room.game?.turn === player.id) advanceTurn(room);
      touch(room); broadcast(room);
    }
  });
});

// تنضيف الرومات الخاملة
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.lastActive > ROOM_IDLE_MS) { clearTimer(r); rooms.delete(code); }
  }
}, 600000);

server.listen(PORT, () => console.log(`meen-el-gasoos server on :${PORT} (${countWords()} words, ${CATEGORIES.length} categories)`));
