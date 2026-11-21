"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { GAME_TITLE } from "../../../lib/config";
import { useGame, loadSession, saveSession } from "../../../lib/useGame";
import { QuestioningPanel, QuestionsList } from "../../../lib/Questioning";
import Confetti from "../../../lib/Confetti";

const AVATARS = ["🦊","🐼","🐸","🦁","🐰","🐯","🐨","🐷","🐮","🐵"];
const avatarOf = (id, players) => AVATARS[Math.max(0, players.findIndex(p => p.id === id)) % AVATARS.length];

function Countdown({ endsAt }) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    if (!endsAt) { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, endsAt - Date.now()));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [endsAt]);
  if (left === null) return null;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <div className={`timer ${left < 30000 ? "urgent" : ""}`}>{m}:{String(s).padStart(2, "0")}</div>;
}

export default function RoomPage() {
  const { code: rawCode } = useParams();
  const code = decodeURIComponent(rawCode || "");
  const router = useRouter();
  const { state, error, connected, joinRoom, rejoin, send, leave, clearError } = useGame();
  const [name, setName] = useState("");
  const [triedRejoin, setTriedRejoin] = useState(false);
  const [myPick, setMyPick] = useState(null);
  const [guess, setGuess] = useState("");
  const [copied, setCopied] = useState(false);
  const [spies, setSpies] = useState(1);
  const [category, setCategory] = useState("عشوائي");
  const [mins, setMins] = useState(4);
  const [mode, setMode] = useState("questions");
  const [cycles, setCycles] = useState(3);

  // دخول تلقائي: عندنا توكن -> rejoin، عندنا اسم -> join
  useEffect(() => {
    if (triedRejoin || !code) return;
    const s = loadSession();
    if (s?.code === code && s.token) { setTriedRejoin(true); rejoin(code, s.token); }
    else if (s?.code === code && s.name) { setTriedRejoin(true); joinRoom(code, s.name); }
  }, [code, triedRejoin, rejoin, joinRoom]);

  // لو الروم مش لاقيانا نضيف من الأول
  useEffect(() => {
    if (error && (error.includes("مش لاقيينك") || error.includes("اتقفلت"))) setTriedRejoin(false);
  }, [error]);

  const inRoom = state?.code === code;
  const phase = state?.phase;
  const game = state?.game;
  const me = state?.you;
  const players = state?.players || [];

  function share() {
    const url = `${location.origin}/room/${code}`;
    if (navigator.share) navigator.share({ title: GAME_TITLE, text: `تعالى العب معانا! الكود: ${code}`, url }).catch(() => {});
    else { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  function doJoin() {
    if (!name.trim()) return;
    saveSession({ code, name: name.trim() });
    setTriedRejoin(true);
    joinRoom(code, name.trim());
  }

  // فورم دخول الروم (جاي من لينك)
  if (!inRoom) {
    return (
      <main className="page">
        <h1 className="logo">{GAME_TITLE}</h1>
        <div className="card">
          <h2>داخل على روم <span style={{ color: "var(--accent)" }}>{code}</span></h2>
          {triedRejoin && !error && <p className="muted">بنحاول نرجعك...</p>}
          <div className="field">
            <label>اسمك إيه؟</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسمك" maxLength={20}
              onKeyDown={(e) => e.key === "Enter" && doJoin()} />
          </div>
          <button className="btn-primary" disabled={!name.trim()} onClick={doJoin}>ادخل اللعبة 🚀</button>
        </div>
        {error && <div className="notice" onClick={clearError}>{error}</div>}
        <button className="btn-ghost" onClick={() => router.push("/")}>ارجع للرئيسية</button>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="row" style={{ alignItems: "center" }}>
        <div style={{ flex: 2 }}>
          <strong style={{ fontSize: 20 }}>{GAME_TITLE}</strong>
          <div className="muted" style={{ textAlign: "right" }}>
            {phase === "lobby" ? "الروم" : `الجولة ${state.round}`} {!connected && "• بتفصل وترجع..."}
          </div>
        </div>
        <button className="btn-ghost" style={{ padding: "10px" }} onClick={() => { leave(); router.push("/"); }}>اخرج</button>
      </div>

      {error && <div className="notice" onClick={clearError}>{error}</div>}

      {phase === "lobby" && (
        <>
          <div className="card center">
            <div className="muted">ابعت الكود أو اللينك لصحابك</div>
            <div className="code-box">{code}</div>
            <button className="btn-ghost" style={{ marginTop: 12 }} onClick={share}>
              {copied ? "اللينك اتنسخ ✅" : "شير اللينك 📤"}
            </button>
          </div>

          <div className="card">
            <h2>الموجودين ({players.length}/١٠)</h2>
            <div className="players">
              {players.map((p) => (
                <div className="player" key={p.id}>
                  <span className="avatar">{avatarOf(p.id, players)}</span>
                  <span className={`dot ${p.connected ? "on" : ""}`} />
                  {p.isHost && <span className="crown">👑</span>}
                  <span>{p.name} {p.id === me?.id && <span className="you">(انت)</span>}</span>
                  <span className="score">{p.score}</span>
                </div>
              ))}
            </div>
          </div>

          {me?.isHost ? (
            <div className="card">
              <h2>ظبط الجولة</h2>
              <div className="field">
                <label>طريقة اللعب</label>
                <div className="row">
                  <button className={mode === "questions" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("questions")}>أسئلة بالدور 🎙️</button>
                  <button className={mode === "talk" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("talk")}>كلام حر 📞</button>
                </div>
              </div>
              {mode === "questions" && (
                <div className="field">
                  <label>عدد دورات الأسئلة الموجهة (وبعدين ساحة مفتوحة)</label>
                  <div className="row">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} className={cycles === n ? "btn-primary" : "btn-ghost"} onClick={() => setCycles(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="field">
                <label>عدد الجواسيس</label>
                <div className="row">
                  <button className={spies === 1 ? "btn-primary" : "btn-ghost"} onClick={() => setSpies(1)}>واحد</button>
                  <button className={spies === 2 ? "btn-primary" : "btn-ghost"} onClick={() => setSpies(2)}>اتنين</button>
                </div>
              </div>
              <div className="field">
                <label>التصنيف</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="عشوائي">عشوائي 🎲</option>
                  {(state.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label>وقت الكلام</label>
                <div className="row">
                  {[3, 4, 5, 7].map((n) => (
                    <button key={n} className={mins === n ? "btn-primary" : "btn-ghost"} onClick={() => setMins(n)}>{n} د</button>
                  ))}
                </div>
              </div>
              <button
                className="btn-good"
                disabled={players.length < 3}
                onClick={() => send({ type: "start", spies, category, mode, cycles, discussionSec: mins * 60 })}
              >
                يلا نبدأ! 🎬
              </button>
              {players.length < 3 && <p className="muted">محتاجين {3 - players.length} كمان عشان نبدأ</p>}
            </div>
          ) : (
            <p className="muted">استنى الهوست 👑 يبدأ الجولة...</p>
          )}
        </>
      )}

      {phase === "reveal" && game && (
        <>
          <Countdown endsAt={game.timerEndsAt} />
          {game.isSpy ? (
            <div className="word-card spy">
              <div className="cat">شششش 🤫</div>
              <div className="word">انت الجاسوس!</div>
              <p>محدش يعرف... حاول تفتي وتعرف الكلمة من كلامهم</p>
            </div>
          ) : (
            <div className="word-card">
              <div className="cat">التصنيف: {game.category}</div>
              <div className="word">{game.word}</div>
              <p>وصّف الكلمة من غير ما تقولها... وخلي بالك في جاسوس وسطكم</p>
            </div>
          )}
          {me?.isHost && <button className="btn-primary" onClick={() => send({ type: "skipReveal" })}>خلاص شفنا، يلا بينا 👇</button>}
        </>
      )}

      {phase === "questioning" && game && (
        <QuestioningPanel game={game} me={me} players={players} send={send} />
      )}

      {phase === "discussion" && game && (
        <>
          <Countdown endsAt={game.timerEndsAt} />
          <div className="card center">
            <h2>وقت الكلام 🗣️</h2>
            <p>اتكلموا في مكالمة الواتساب بتاعتكم واسألوا بعض أسئلة عن الكلمة.</p>
            <p className="muted">اللي حسه غريب ومش فاهم انتوا بتتكلموا عن إيه... ده غالبًا الجاسوس 🕵️</p>
            {!game.isSpy && <p>الكلمة: <strong style={{ color: "var(--accent)" }}>{game.word}</strong> ({game.category})</p>}
            {game.isSpy && <p className="spy-badge">انت الجاسوس 🤫 فتّي بهدوء</p>}
          </div>
          {me?.isHost ? (
            <button className="btn-danger" onClick={() => send({ type: "startVote" })}>كفاية كلام، ابدأ التصويت! 🗳️</button>
          ) : (
            <p className="muted">لما تحسوا إنكم جاهزين، الهوست 👑 هيبدأ التصويت</p>
          )}
        </>
      )}

      {phase === "voting" && game && (
        <>
          <div className="card">
            <h2>مين الجاسوس في رأيك؟ 🗳️</h2>
            <div className="vote-grid">
              {players.filter((p) => p.id !== me?.id).map((p) => (
                <button
                  key={p.id}
                  className={`vote-btn ${myPick === p.id ? "picked" : ""}`}
                  disabled={!p.connected}
                  onClick={() => { setMyPick(p.id); send({ type: "vote", targetId: p.id }); }}
                >
                  {p.name}
                  {(game.votes?.[p.id] || 0) > 0 && <span className="votes">{game.votes[p.id]} صوت</span>}
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              {game.youVoted ? "صوتك اتسجل ✅ تقدر تغيره لحد ما الكل يصوت" : "دوس على اسم اللي شاكك فيه"}
            </p>
          </div>
          <QuestionsList questions={game.questions} players={players} />
        </>
      )}

      {phase === "spyGuess" && game && (
        <>
          <Countdown endsAt={game.timerEndsAt} />
          {game.isSpy ? (
            <div className="card">
              <h2>فرصتك الأخيرة! 🎯</h2>
              <p>لو خمّنت الكلمة صح هتكسب الجولة حتى لو مسكوك</p>
              <div className="field">
                <input value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="اكتب تخمينك"
                  onKeyDown={(e) => e.key === "Enter" && guess.trim() && send({ type: "spyGuess", word: guess.trim() })} />
              </div>
              <button className="btn-danger" disabled={!guess.trim()} onClick={() => send({ type: "spyGuess", word: guess.trim() })}>
                خمّن! 🎲
              </button>
            </div>
          ) : (
            <div className="word-card spy">
              <div className="cat">لحظة الحقيقة...</div>
              <div className="word">الجاسوس بيخمّن 😬</div>
              <p>لو عرف الكلمة هيسرق الجولة منكم</p>
            </div>
          )}
        </>
      )}

      {phase === "results" && game && (
        <>
          {game.caught && <Confetti />}
          <div className="card">
            <h2>نتيجة الجولة 🏁</h2>
            {(game.resultLines || []).map((l, i) => <div className="result-line" key={i}>{l}</div>)}
            <p className="center" style={{ marginTop: 10 }}>
              الكلمة كانت: <strong style={{ color: "var(--accent)", fontSize: 22 }}>{game.wordRevealed}</strong> ({game.category})
            </p>
          </div>

          <div className="card">
            <h2>النقط 📊</h2>
            <div className="players">
              {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
                <div className="player" key={p.id}>
                  <span>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</span>
                  <span className="avatar">{avatarOf(p.id, players)}</span>
                  {game.spiesKnown?.includes(p.id) && <span title="جاسوس">🕵️</span>}
                  <span>{p.name}</span>
                  <span className="score">{p.score}</span>
                </div>
              ))}
            </div>
          </div>

          {me?.isHost ? (
            <button className="btn-primary" onClick={() => send({ type: "nextRound" })}>الجولة الجاية 🔄</button>
          ) : (
            <p className="muted">استنى الهوست 👑 يجهز الجولة الجاية...</p>
          )}
        </>
      )}
    </main>
  );
}
