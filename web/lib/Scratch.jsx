"use client";
// كارت خربشة زي بكاسا: تخربش بالصبع عشان تعرف انت جوة ولا بره
import { useEffect, useRef, useState } from "react";

export default function ScratchCard({ children, onRevealed, height = 260 }) {
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const scratching = useRef(false);
  const moves = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = box.clientWidth, h = box.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.scale(dpr, dpr);
    // الغطاء
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#2b2440");
    grad.addColorStop(1, "#1a1526");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // نقش خربشة
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 3;
    for (let x = -h; x < w; x += 18) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 20px 'Cairo', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🪙 خربش هنا", w / 2, h / 2 - 8);
    ctx.font = "14px 'Cairo', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("عشان تعرف انت جوة ولا بره", w / 2, h / 2 + 18);
  }, []);

  function eraseAt(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const ctx = canvas.getContext("2d");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000"; // لازم ألفا كاملة وإلا الخربشة متمسحش صح
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    moves.current++;
    if (moves.current % 12 === 0) checkCleared();
  }

  function checkCleared() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let clear = 0, total = 0;
    for (let i = 3; i < data.length; i += 4 * 24) { total++; if (data[i] < 40) clear++; }
    if (clear / total > 0.45) {
      setRevealed(true);
      onRevealed?.();
    }
  }

  return (
    <div ref={boxRef} className="scratch-box" style={{ height, position: "relative" }}>
      <div className="scratch-content">{children}</div>
      {!revealed && (
        <canvas
          ref={canvasRef}
          className="scratch-canvas"
          onPointerDown={(e) => { scratching.current = true; e.target.setPointerCapture(e.pointerId); eraseAt(e); }}
          onPointerMove={(e) => scratching.current && eraseAt(e)}
          onPointerUp={() => { scratching.current = false; checkCleared(); }}
          onPointerCancel={() => { scratching.current = false; }}
        />
      )}
    </div>
  );
}
