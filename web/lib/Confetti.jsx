"use client";
// كونفيتي احتفالي لما الجاسوس يتمسك
import { useMemo } from "react";

const PIECES = ["🎉", "🎊", "⭐", "✨", "🕵️", "🎈"];

export default function Confetti({ count = 36 }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.4 + Math.random() * 1.8,
        emoji: PIECES[i % PIECES.length],
        size: 16 + Math.random() * 18,
      })),
    [count]
  );
  return (
    <div className="confetti-layer">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, fontSize: p.size }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
