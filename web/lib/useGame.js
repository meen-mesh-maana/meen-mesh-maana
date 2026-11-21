"use client";
// هوك واحد بيدير الاتصال بالسيرفر: دخول، رجوع بعد فصل، واستقبال الحالة
import { useEffect, useRef, useState, useCallback } from "react";

function wsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    return "ws://localhost:8090";
  }
  return "";
}

export function loadSession() {
  try { return JSON.parse(localStorage.getItem("mmm-session") || "null"); } catch { return null; }
}
export function saveSession(s) { localStorage.setItem("mmm-session", JSON.stringify(s)); }
export function clearSession() { localStorage.removeItem("mmm-session"); }

export function useGame() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const pendingRef = useRef(null); // آخر رسالة دخول عشان نعيدها بعد الريكنكت
  const timerRef = useRef(null);

  const connect = useCallback((msg) => {
    const url = wsUrl();
    if (!url) { setError("السيرفر مش متظبط: ناقص NEXT_PUBLIC_WS_URL"); return; }
    pendingRef.current = msg;
    try { wsRef.current?.close(); } catch {}
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify(pendingRef.current));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "error") {
        setError(m.message);
        if (m.message.includes("مش لاقيينك") || m.message.includes("اتقفلت")) clearSession();
        return;
      }
      setError(null);
      if (m.type === "joined") {
        const s = loadSession() || {};
        saveSession({ ...s, code: m.code, token: m.token });
      }
      setState(m);
    };
    ws.onclose = () => {
      setConnected(false);
      // ريكنكت تلقائي كل ٢ ثانية لو كنا داخلين روم
      if (pendingRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => connect(pendingRef.current), 2000);
      }
    };
  }, []);

  const createRoom = useCallback((name) => connect({ type: "create", name }), [connect]);
  const joinRoom = useCallback((code, name) => connect({ type: "join", code, name }), [connect]);
  const rejoin = useCallback((code, token) => connect({ type: "rejoin", code, token }), [connect]);
  const send = useCallback((obj) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(obj));
  }, []);
  const leave = useCallback(() => {
    pendingRef.current = null;
    clearTimeout(timerRef.current);
    send({ type: "leave" });
    clearSession();
    setState(null);
  }, [send]);

  useEffect(() => () => { clearTimeout(timerRef.current); try { wsRef.current?.close(); } catch {} }, []);

  return { state, error, connected, createRoom, joinRoom, rejoin, send, leave, clearError: () => setError(null) };
}
