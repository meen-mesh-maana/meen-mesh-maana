// E2E: 5 لاعبين، جولتين، فصل ورجوع لاعب. بيشغل السيرفر لوكال ويختبر كل الفلو.
const { spawn } = require("child_process");
const path = require("path");
const WebSocket = require("ws");

const PORT = 8901;
const URL = `ws://127.0.0.1:${PORT}`;
let failures = 0;
function ok(cond, label) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.states = []; this.errors = []; this.token = null; this.code = null; this.joined = false; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on("open", res);
      this.ws.on("error", rej);
      this.ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "error") this.errors.push(m.message);
        if (m.type === "joined") { this.token = m.token; this.code = m.code; this.joined = true; this.states.push(m); }
        if (m.type === "state") this.states.push(m);
      });
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  last() { return this.states[this.states.length - 1] || {}; }
  phase() { return this.last().phase; }
  me() { return this.last().you || {}; }
  async waitFor(pred, label, timeout = 5000) {
    if (pred === "joined:") { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (this.joined) return true; await sleep(50); } console.log(`  TIMEOUT waiting: ${label}`); failures++; return false; }
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred(this.last())) return true;
      await sleep(50);
    }
    console.log(`  TIMEOUT waiting: ${label}; last=${JSON.stringify(this.last()).slice(0, 200)}`);
    failures++;
    return false;
  }
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "index.js")], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  server.stdout.on("data", d => process.stdout.write("[server] " + d));
  server.stderr.on("data", d => process.stdout.write("[server!] " + d));
  await sleep(700);

  // 1) health
  const health = await fetch(`http://127.0.0.1:${PORT}/`).then(r => r.json());
  ok(health.ok && health.words >= 200, `health endpoint, word count = ${health.words}`);

  // 2) إنشاء الروم ودخول 5 لاعبين
  const names = ["أحمد", "مريم", "كريم", "سارة", "ياسين"];
  const clients = [];
  for (const n of names) {
    const c = new Client(n);
    await c.connect();
    clients.push(c);
  }
  clients[0].send({ type: "create", name: names[0] });
  await clients[0].waitFor("joined:", "host joined");
  const code = clients[0].code;
  ok(Boolean(code), `room created with code "${code}"`);
  for (let i = 1; i < 5; i++) {
    clients[i].send({ type: "join", code, name: names[i] });
    await clients[i].waitFor("joined:", `${names[i]} joined`);
  }
  await clients[4].waitFor(s => s.players && s.players.length === 5, "lobby shows 5 players");
  ok(clients[0].me().isHost === true, "first player is host");
  ok(clients[1].me().isHost === false, "others are not host");

  // duplicate name rejection
  const dup = new Client("أحمد تاني");
  await dup.connect();
  dup.send({ type: "join", code, name: "أحمد" });
  await sleep(300);
  ok(dup.errors.some(e => e.includes("بالاسم ده")), "duplicate connected name rejected");
  dup.ws.close();

  // non-host cannot start
  clients[1].send({ type: "start", spies: 1, discussionSec: 60 });
  await sleep(200);
  ok(clients[1].errors.some(e => e.includes("الهوست")), "non-host start rejected");

  // 3) الجولة الأولى — جاسوس واحد
  clients[0].send({ type: "start", spies: 1, category: "عشوائي", discussionSec: 60 });
  await Promise.all(clients.map((c, i) => c.waitFor(s => s.phase === "reveal" && s.game, `round 1 reveal for ${names[i]}`)));
  const g1 = clients.map(c => c.last().game);
  const spies1 = clients.filter(c => c.last().game.isSpy);
  ok(spies1.length === 1, `exactly 1 spy (${spies1[0]?.name})`);
  const words1 = clients.filter(c => !c.last().game.isSpy).map(c => c.last().game.word);
  ok(words1.every(w => w && w === words1[0]), "all non-spies see the same word");
  ok(spies1[0].last().game.word === null, "spy sees no word");
  ok(Boolean(g1[0].category), "category delivered");
  const spy1 = spies1[0];

  clients[0].send({ type: "skipReveal" });
  await clients[0].waitFor(s => s.phase === "discussion", "discussion phase");
  ok(Boolean(clients[0].last().game.timerEndsAt), "discussion timer set");

  clients[0].send({ type: "startVote" });
  await Promise.all(clients.map(c => c.waitFor(s => s.phase === "voting", `voting for ${c.name}`)));

  // الكل يصوت على الجاسوس (والجاسوس نفسه بيصوت على حد تاني، ممنوع تصويت النفس)
  const innocent1 = clients.find(c => c !== spy1);
  for (const c of clients) c.send({ type: "vote", targetId: c === spy1 ? innocent1.me().id : spy1.me().id });
  await clients[0].waitFor(s => s.phase === "spyGuess", "auto-advance to spy guess when all voted");

  spy1.send({ type: "spyGuess", word: "تخمين غلط خالص" });
  await Promise.all(clients.map(c => c.waitFor(s => s.phase === "results", `results for ${c.name}`)));
  const r1 = clients[0].last().game;
  ok(r1.caught === spy1.me().id, "spy was caught");
  ok(r1.spyGuessCorrect === false, "wrong guess marked wrong");
  ok(r1.wordRevealed === words1[0], "word revealed in results");
  const scores1 = Object.fromEntries(clients.map(c => [c.name, c.last().players.find(p => p.name === c.name).score]));
  ok(clients.every(c => (c === spy1 ? scores1[c.name] === 0 : scores1[c.name] === 2)), `scores after round 1: ${JSON.stringify(scores1)}`);

  // 4) الجولة التانية — جاسوسين + فصل ورجوع
  clients[0].send({ type: "nextRound" });
  await clients[0].waitFor(s => s.phase === "lobby", "back to lobby");
  clients[0].send({ type: "start", spies: 2, discussionSec: 60 });
  await Promise.all(clients.map(c => c.waitFor(s => s.round === 2 && s.phase === "reveal", `round 2 for ${c.name}`)));
  const spies2 = clients.filter(c => c.last().game.isSpy);
  ok(spies2.length === 2, "2 spies in round 2");

  // لاعب (مش جاسوس لو أمكن) يفصل
  const drop = clients.slice(1).find(c => !c.last().game.isSpy) || clients[2];
  const dropScoreBefore = drop.last().players.find(p => p.name === drop.name).score;
  drop.ws.close();
  await clients[0].waitFor(s => s.players.find(p => p.name === drop.name)?.connected === false, "disconnect visible to room");

  // يرجع بنفس التوكن
  const rejoin = new Client(drop.name);
  await rejoin.connect();
  rejoin.send({ type: "rejoin", code, token: drop.token });
  await rejoin.waitFor(s => rejoin.joined && s.round === 2, "rejoin mid-round");
  ok(rejoin.last().players.find(p => p.name === drop.name).connected === true, "rejoined player marked connected");
  ok(rejoin.last().players.find(p => p.name === drop.name).score === dropScoreBefore, "score preserved after rejoin");
  const rejoinIsSpy = rejoin.last().game.isSpy;
  const oldIdx = clients.indexOf(drop);
  clients[oldIdx] = rejoin;

  clients[0].send({ type: "skipReveal" });
  await clients[0].waitFor(s => s.phase === "discussion", "round 2 discussion");
  clients[0].send({ type: "startVote" });
  await Promise.all(clients.map(c => c.waitFor(s => s.phase === "voting", `round 2 voting ${c.name}`)));

  // الكل يصوت على لاعب مش جاسوس -> الجواسيس ينجوا (الضحية بتصوت لحد تاني)
  const innocents = clients.filter(c => !c.last().game.isSpy);
  const victim = innocents[0];
  const otherInnocent = innocents[1];
  for (const c of clients) c.send({ type: "vote", targetId: c === victim ? otherInnocent.me().id : victim.me().id });
  await clients[0].waitFor(s => s.phase === "spyGuess", "round 2 spy guess phase");
  ok(clients[0].last().game.spiesKnown.length === 2, "spy identities revealed during guess phase");

  // أول جاسوس يخمن الكلمة الصح
  const spyA = clients.find(c => c.last().game.isSpy);
  const trueWord = clients.find(c => !c.last().game.isSpy).last().game.word;
  spyA.send({ type: "spyGuess", word: trueWord });
  await Promise.all(clients.map(c => c.waitFor(s => s.phase === "results", `round 2 results ${c.name}`)));
  const r2 = clients[0].last().game;
  ok(r2.caught === null, "spy survived the vote");
  ok(r2.spyGuessCorrect === true, "correct spy guess detected (normalized Arabic)");
  const scores2 = Object.fromEntries(clients.map(c => [c.name, c.last().players.find(p => p.name === c.name).score]));
  const spyNames2 = new Set(clients.filter(c => c.last().game.spiesKnown.includes(c.me().id)).map(c => c.name));
  let scoresOk = true;
  for (const c of clients) {
    const expected = (spyNames2.has(c.name) ? 3 : 0) + (c.name === spy1.name ? 0 : 2);
    if (scores2[c.name] !== expected) scoresOk = false;
  }
  if (!scoresOk) console.log(`  [dbg] spy1=${spy1.name} spyNames2=${[...spyNames2].join(",")} scores2=${JSON.stringify(scores2)}`);
  ok(scoresOk, `scores after round 2: ${JSON.stringify(scores2)}`);

  // 5) الجولة التالتة — أسئلة بالدور: دورتين موجهتين + ساحة مفتوحة + تصويت بزرار الهوست بس
  clients[0].send({ type: "nextRound" });
  await clients[0].waitFor(s => s.phase === "lobby", "round 3 lobby");
  clients[0].send({ type: "start", spies: 1, mode: "questions", cycles: 2, discussionSec: 60 });
  await Promise.all(clients.map(c => c.waitFor(s => s.round === 3 && s.phase === "reveal", `round 3 reveal ${c.name}`)));
  clients[0].send({ type: "skipReveal" });
  await Promise.all(clients.map(c => c.waitFor(s => s.phase === "questioning", `questioning ${c.name}`)));
  ok(clients[0].last().game.mode === "questions", "mode is questions");
  ok(clients[0].last().game.qMode === "directed" && clients[0].last().game.cycle === 1 && clients[0].last().game.cyclesTotal === 2, "directed cycle 1 of 2 started");

  const turnPlayer = () => clients.find(c => c.me().id === clients[0].last().game.turn);
  const otherThan = (id) => clients.find(c => c.me().id !== id);

  // رفض اللعب بره الدور
  {
    const turnId = clients[0].last().game.turn;
    const notAsker = clients.find(c => c.me().id !== turnId);
    notAsker.send({ type: "askText", targetId: turnId, text: "سؤال مش في دوري" });
    await sleep(250);
    ok(notAsker.errors.some(e => e.includes("دورك")), "out-of-turn ask rejected in directed mode");
  }

  // الدورة الأولى كاملة: ٥ أسئلة بالترتيب (آخر واحد صوتي عشان نختبر رفع الصوت)
  for (let i = 0; i < 5; i++) {
    const asker = turnPlayer();
    if (i === 4) {
      const fakeAudio = Buffer.from("RIFF fake wav bytes for e2e test").toString("base64");
      asker.send({ type: "ask", targetId: otherThan(asker.me().id).me().id, mime: "audio/webm", audioB64: fakeAudio });
    } else {
      asker.send({ type: "askText", targetId: otherThan(asker.me().id).me().id, text: `سؤال رقم ${i + 1}` });
    }
    await clients[0].waitFor(s => (s.game?.questions?.length || 0) === i + 1, `question ${i + 1} stored`);
  }
  const audioQ = clients[0].last().game.questions[4];
  ok(audioQ.kind === "audio" && Boolean(audioQ.url), "audio question has playback url");
  const audioRes = await fetch(`http://127.0.0.1:${PORT}${audioQ.url}`);
  ok(audioRes.status === 200 && Buffer.from(await audioRes.arrayBuffer()).equals(Buffer.from("RIFF fake wav bytes for e2e test")), "audio served over HTTP with bytes intact");
  await clients[0].waitFor(s => s.game?.cycle === 2 && s.game?.qMode === "directed", "cycle 2 starts automatically after full cycle");
  ok(clients[0].phase() === "questioning", "no auto voting after cycle 1");

  // الدورة التانية: سؤالين + الهوست يعدّي ٣ أدوار -> الساحة تتفتح
  for (let i = 0; i < 2; i++) {
    const asker = turnPlayer();
    asker.send({ type: "askText", targetId: otherThan(asker.me().id).me().id, text: `سؤال الدورة ٢ رقم ${i + 1}` });
    await clients[0].waitFor(s => (s.game?.questions?.length || 0) === 6 + i, `cycle 2 question ${i + 1}`);
  }
  for (let i = 0; i < 3; i++) { clients[0].send({ type: "skipTurn" }); await sleep(150); }
  await clients[0].waitFor(s => s.game?.qMode === "open", "open floor after configured cycles");
  ok(clients[0].phase() === "questioning", "still questioning on open floor, no auto voting");

  // الساحة المفتوحة: أي حد يسأل في أي ترتيب، حتى مرتين ورا بعض
  const qBefore = clients[0].last().game.questions.length;
  const [a, b] = [clients[1], clients[2]];
  a.send({ type: "askText", targetId: b.me().id, text: "سؤال مفتوح ١" });
  await clients[0].waitFor(s => (s.game?.questions?.length || 0) === qBefore + 1, "open-floor q1");
  a.send({ type: "askText", targetId: clients[3].me().id, text: "سؤال مفتوح ٢ من نفس الشخص" });
  await clients[0].waitFor(s => (s.game?.questions?.length || 0) === qBefore + 2, "open-floor same player twice");
  b.send({ type: "askText", targetId: a.me().id, text: "سؤال مفتوح ٣" });
  await clients[0].waitFor(s => (s.game?.questions?.length || 0) === qBefore + 3, "open-floor q3 any order");
  ok(clients[0].phase() === "questioning", "open floor never auto-starts voting");

  // التصويت بزرار الهوست بس
  clients[2].send({ type: "endQuestions" });
  await sleep(250);
  ok(clients[2].errors.some(e => e.includes("الهوست")), "non-host cannot trigger voting");
  ok(clients[0].phase() === "questioning", "voting not started until host triggers it");
  clients[0].send({ type: "endQuestions" });
  await clients[0].waitFor(s => s.phase === "voting", "host trigger starts voting");
  ok((clients[0].last().game.questions || []).length === qBefore + 3, "all questions replayable during voting");

  // نخلّص الجولة التالتة للآخر: الكل يصوّت على الجاسوس، تخمين غلط، نتايج
  {
    const spy3 = clients.find(c => (c.last().game.spiesKnown || []).includes(c.me().id));
    ok(Boolean(spy3), "round 3 spy identified from spiesKnown");
    const innocent3 = clients.find(c => c !== spy3);
    for (const c of clients) c.send({ type: "vote", targetId: c === spy3 ? innocent3.me().id : spy3.me().id });
    await clients[0].waitFor(s => s.phase === "spyGuess", "round 3 spyGuess");
    spy3.send({ type: "spyGuess", word: "تخمين غلط" });
    await clients[0].waitFor(s => s.phase === "results", "round 3 results");
  }

  // 6) الجولة الرابعة — كلمة وهمية + هينت + فريق الجواسيس + ٢ بره
  clients[0].send({ type: "nextRound" });
  await clients[0].waitFor(s => s.phase === "lobby", "round 4 lobby");
  clients[0].send({ type: "start", spies: 2, fakeWord: true, hint: true, spyTeam: true, discussionSec: 60 });
  await Promise.all(clients.map(c => c.waitFor(s => s.round === 4 && s.phase === "reveal", `round 4 reveal ${c.name}`)));
  {
    const words = clients.map(c => c.last().game.word);
    ok(words.every(w => typeof w === "string" && w.length > 0), "fake-word mode: everyone sees a word (nobody knows they're out)");
    const uniq = new Set(words);
    ok(uniq.size === 2, "exactly two words in play (real + fake)");
    const counts = {}; words.forEach(w => counts[w] = (counts[w] || 0) + 1);
    ok(Object.values(counts).sort().join(",") === "2,3", "fake word held by exactly the 2 spies");
    ok(clients.every(c => c.last().game.isSpy === false), "with fake word nobody is told they're out during reveal");
    ok(clients.every(c => !c.last().game.hint), "hint suppressed when fake word is on");
  }
  // revealReady من الكل -> يكمل من غير ما الهوست يعدّي
  for (const c of clients) c.send({ type: "revealReady" });
  await Promise.all(clients.map(c => c.waitFor(s => s.phase === "discussion", `round 4 discussion ${c.name}`)));
  // في مرحلة spyGuess الجواسيس يعرفوا نفسهم
  clients[0].send({ type: "startVote" });
  await clients[0].waitFor(s => s.phase === "voting", "round 4 voting");
  const spiesKnownNow = clients[0].last().game.spiesKnown;
  for (const c of clients) c.send({ type: "vote", targetId: spiesKnownNow.find(id => id !== c.me().id) || spiesKnownNow[0] });
  await clients[0].waitFor(s => s.phase === "spyGuess", "round 4 spyGuess");
  const caughtSpy = clients.find(c => c.me().id === clients[0].last().game.caught || c.last().game.isSpy);
  ok(clients.some(c => c.last().game.isSpy), "spy learns the truth at guess phase even with fake word");
  const caughtClient = clients.find(c => c.last().game.isSpy);
  caughtClient.send({ type: "spyGuess", word: "تخمين غلط" });
  await clients[0].waitFor(s => s.phase === "results", "round 4 results");
  ok((clients[0].last().game.resultLines || []).some(l => l.includes("الوهمية")), "results mention the fake word");
  ok(((clients[0].last().game.resultLines || [])[0] || "").includes("اللي بره هو"), "results open with اللي بره هو");

  // 7) الجولة الخامسة — وضع التمرير (pass-and-play): الأدوار على موبايل الهوست بس
  clients[0].send({ type: "nextRound" });
  await clients[0].waitFor(s => s.phase === "lobby", "round 5 lobby");
  clients[0].send({ type: "start", spies: 1, passPlay: true, discussionSec: 60 });
  await Promise.all(clients.map(c => c.waitFor(s => s.round === 5 && s.phase === "reveal", `round 5 reveal ${c.name}`)));
  ok(clients[0].last().game.pass && clients[0].last().game.pass.total === 5 && clients[0].last().game.pass.idx === 0, "host sees pass queue");
  ok(clients.slice(1).every(c => c.last().game.passWaiting === true && !c.last().game.word && !c.last().game.isSpy), "non-host devices see no secrets during pass");
  ok(!clients[0].last().game.word, "host own word suppressed until pass");
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const st = clients[0].last().game.pass;
    ok(st && st.currentName, `pass ${i + 1} names a player`);
    clients[0].send({ type: "passShow" });
    await clients[0].waitFor(s => s.game?.pass?.shown === true, `pass ${i + 1} shown`);
    const role = clients[0].last().game.pass.role;
    ok(role && (role.isSpy || (typeof role.word === "string" && role.word.length > 0)), `pass ${i + 1} role payload present (${st.currentName})`);
    seen.push(role.isSpy ? "SPY" : role.word);
    clients[0].send({ type: "passNext" });
    await sleep(200);
  }
  await Promise.all(clients.map(c => c.waitFor(s => s.phase === "discussion", `round 5 discussion ${c.name}`)));
  ok(seen.filter(x => x === "SPY").length === 1, "exactly 1 spy seen across the pass");
  ok(new Set(seen.filter(x => x !== "SPY")).size === 1, "all جوة players saw the same word during pass");
  // بعد التمرير، كل جهاز يرجع يشوف دوره هو
  const spy5 = clients.filter(c => c.last().game.isSpy);
  ok(spy5.length === 1 && spy5[0].last().game.word === null, "after pass, the spy's own device shows انت بره");
  ok(clients.filter(c => !c.last().game.isSpy).every(c => c.last().game.word), "after pass, جوة devices show the word");
  clients[0].send({ type: "startVote" });
  await clients[0].waitFor(s => s.phase === "voting", "round 5 voting");
  const spy5Id = spy5[0].me().id;
  for (const c of clients) c.send({ type: "vote", targetId: c.me().id === spy5Id ? clients.find(x => x.me().id !== spy5Id).me().id : spy5Id });
  await clients[0].waitFor(s => s.phase === "spyGuess", "round 5 spyGuess");
  spy5[0].send({ type: "spyGuess", word: "لسه غلط" });
  await clients[0].waitFor(s => s.phase === "results", "round 5 results");
  ok(clients[0].last().game.caught === spy5Id, "pass-play round fully playable to results");

  // 8) leave يقفل الروم لما الكل يمشي
  for (const c of clients) c.send({ type: "leave" });
  await sleep(300);
  const ghost = new Client("ghost");
  await ghost.connect();
  ghost.send({ type: "rejoin", code, token: clients[0].token });
  await ghost.waitFor(() => ghost.errors.length > 0, "room gone after everyone left", 1500);
  ok(ghost.errors.some(e => e.includes("اتقفلت")), "empty room cleaned up");
  ghost.ws.close();

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
  server.kill();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
