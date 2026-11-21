"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GAME_TITLE, GAME_TAGLINE } from "../lib/config";
import { useGame, saveSession } from "../lib/useGame";

export default function Home() {
  const router = useRouter();
  const { state, error, createRoom } = useGame();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState(null); // 'create' | null

  // أول ما الروم تتعمل روح عليها
  useEffect(() => {
    if (mode === "create" && state?.code && state?.token) {
      saveSession({ code: state.code, name, token: state.token });
      router.push(`/room/${state.code}`);
    }
  }, [mode, state, name, router]);

  return (
    <main className="page">
      <h1 className="logo">{GAME_TITLE}</h1>
      <p className="tagline">{GAME_TAGLINE}</p>

      <div className="card">
        <div className="field">
          <label>اسمك إيه؟</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اكتب اسمك"
            maxLength={20}
          />
        </div>
        <button
          className="btn-primary"
          disabled={!name.trim()}
          onClick={() => { setMode("create"); createRoom(name.trim()); }}
        >
          اعمل روم جديدة 🎉
        </button>
      </div>

      <div className="center muted">— أو —</div>

      <div className="card">
        <div className="field">
          <label>عندك كود روم؟</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="الكود من صاحبك"
            maxLength={8}
          />
        </div>
        <button
          className="btn-ghost"
          disabled={!code.trim()}
          onClick={() => { saveSession({ code: code.trim(), name: name.trim() }); router.push(`/room/${code.trim()}`); }}
        >
          ادخل الروم 🚪
        </button>
      </div>

      {error && <div className="notice">{error}</div>}

      <p className="muted">٣-١٠ لاعبين • من غير حسابات • من غير تحميل • بس موبايلك وصحابك</p>
    </main>
  );
}
