"use client";
// تسجيل وتشغيل الأسئلة الصوتية + fallback مكتوب
import { useEffect, useRef, useState } from "react";

export function httpBase() {
  let ws = process.env.NEXT_PUBLIC_WS_URL || "";
  if (!ws && typeof window !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    ws = "ws://localhost:8080";
  }
  return ws.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
}

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return "";
}

function blobToB64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export function QuestionsList({ questions, players }) {
  if (!questions?.length) return null;
  const nameOf = (id) => players.find((p) => p.id === id)?.name || "؟";
  const base = httpBase();
  return (
    <div className="card">
      <h2>الأسئلة 🎙️</h2>
      <div className="players">
        {questions.map((q, i) => (
          <div className="player" style={{ flexDirection: "column", alignItems: "stretch" }} key={q.id}>
            <div>
              <strong>{nameOf(q.fromId)}</strong> بيسأل <strong>{nameOf(q.toId)}</strong>
            </div>
            {q.kind === "audio" ? (
              <audio controls preload="none" src={base + q.url} style={{ width: "100%", height: 38, marginTop: 6 }} />
            ) : (
              <div style={{ marginTop: 4, color: "var(--accent)", fontSize: 16 }}>💬 {q.text}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuestioningPanel({ game, me, players, send }) {
  const open = game.qMode === "open";
  const myTurn = !open && game.turn === me?.id;
  const canAsk = open || myTurn;
  const turnName = players.find((p) => p.id === game.turn)?.name || "...";
  const [targetId, setTargetId] = useState(null);
  const [recState, setRecState] = useState("idle"); // idle | recording | preview
  const [elapsed, setElapsed] = useState(0);
  const [micFailed, setMicFailed] = useState(false);
  const [typed, setTyped] = useState("");
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const tickRef = useRef(null);
  const autoStopRef = useRef(null);

  useEffect(() => () => { clearInterval(tickRef.current); clearTimeout(autoStopRef.current); }, []);

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || mime || "audio/webm" });
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        setRecState("preview");
      };
      mrRef.current = mr;
      mr.start(250);
      setElapsed(0);
      setRecState("recording");
      tickRef.current = setInterval(() => setElapsed((x) => x + 1), 1000);
      autoStopRef.current = setTimeout(stopRec, 30000); // ٣٠ ثانية كحد أقصى
    } catch {
      setMicFailed(true);
    }
  }

  function stopRec() {
    clearInterval(tickRef.current);
    clearTimeout(autoStopRef.current);
    try { mrRef.current?.stop(); } catch {}
  }

  async function sendAudio() {
    if (!blobRef.current || !targetId) return;
    const b64 = await blobToB64(blobRef.current);
    send({ type: "ask", targetId, mime: blobRef.current.type, audioB64: b64 });
    resetRec();
  }

  function sendText() {
    if (!typed.trim() || !targetId) return;
    send({ type: "askText", targetId, text: typed.trim() });
    setTyped("");
    resetRec();
  }

  function resetRec() {
    setRecState("idle");
    setTargetId(null);
    setPreviewUrl(null);
    blobRef.current = null;
  }

  return (
    <>
      <div className="card">
        <h2>جولة الأسئلة 🎙️</h2>
        {!open && <p className="muted">الدورة {game.cycle} من {game.cyclesTotal}</p>}
        <p className="center" style={{ fontSize: 18 }}>
          {open ? (
            <>الساحة مفتوحة! 🗣️ <strong style={{ color: "var(--accent)" }}>أي حد يسأل أي حد</strong></>
          ) : (
            <>الدور على: <strong style={{ color: "var(--accent)" }}>{myTurn ? "انت!" : turnName}</strong></>
          )}
        </p>
        {open && <p className="muted">اسألوا بعض براحتكم، ولما تحسوا إنكم جاهزين الهوست يبدأ التصويت 🗳️</p>}
        {!open && !myTurn && <p className="muted">اسمع الأسئلة وردود الناس... الجاسوس بيحاول يمثّل 😅</p>}

        {canAsk && recState === "idle" && (
          <>
            <p>اختار مين تسأله:</p>
            <div className="vote-grid" style={{ marginBottom: 12 }}>
              {players.filter((p) => p.id !== me?.id && p.connected).map((p) => (
                <button key={p.id} className={`vote-btn ${targetId === p.id ? "picked" : ""}`} onClick={() => setTargetId(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
            {!micFailed ? (
              <>
                <button className="btn-danger" disabled={!targetId} onClick={startRec}>سجّل سؤالك 🎤</button>
                <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setMicFailed(true)}>الميكروفون مش شغال؟ اكتب سؤالك</button>
              </>
            ) : (
              <>
                <div className="field">
                  <textarea
                    rows={3}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="اكتب سؤالك هنا..."
                    style={{ width: "100%", padding: 14, fontSize: 17, fontFamily: "inherit", borderRadius: 14, border: "2px solid rgba(255,255,255,.12)", background: "var(--card2)", color: "var(--text)", resize: "vertical" }}
                    maxLength={300}
                  />
                </div>
                <button className="btn-primary" disabled={!targetId || !typed.trim()} onClick={sendText}>ابعت السؤال ✍️</button>
              </>
            )}
          </>
        )}

        {canAsk && recState === "recording" && (
          <div className="center">
            <div className="timer urgent">● {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</div>
            <p>بتسجّل سؤالك لـ <strong>{players.find((p) => p.id === targetId)?.name}</strong>...</p>
            <button className="btn-primary" onClick={stopRec}>خلّصت ⏹️</button>
          </div>
        )}

        {canAsk && recState === "preview" && (
          <div className="center">
            <p>اسمع سؤالك قبل ما يتبعت:</p>
            {previewUrl && <audio controls src={previewUrl} style={{ width: "100%", marginBottom: 12 }} />}
            <div className="row">
              <button className="btn-good" onClick={sendAudio}>ابعت ✅</button>
              <button className="btn-ghost" onClick={() => { setPreviewUrl(null); setRecState("idle"); }}>سجّل تاني 🔁</button>
            </div>
          </div>
        )}
      </div>

      {me?.isHost && (
        <div className="row">
          {!open && <button className="btn-ghost" onClick={() => send({ type: "skipTurn" })}>عدّي الدور ⏭️</button>}
          <button className="btn-danger" onClick={() => send({ type: "endQuestions" })}>ابدأ التصويت 🗳️</button>
        </div>
      )}

      <QuestionsList questions={game.questions} players={players} />
    </>
  );
}
