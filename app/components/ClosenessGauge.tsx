"use client";

interface ClosenessGaugeProps {
  value: number; // 0-100, your latest word's closeness to the target
  delta: "hotter" | "colder" | null;
  opponent?: { name: string; value: number } | null;
}

const CX = 100;
const CY = 100;
const R = 80;
const CONNECT_AT = 70; // auto-connect threshold

// Point on the half circle: 0% = far left, 100% = far right
function polar(pct: number, radius = R) {
  const angle = Math.PI * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return { x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle) };
}

function arc(from: number, to: number, radius = R) {
  const a = polar(from, radius);
  const b = polar(to, radius);
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${b.x} ${b.y}`;
}

// Rotation for a needle drawn pointing straight up (50%)
const needleRotation = (pct: number) => (Math.min(100, Math.max(0, pct)) / 100) * 180 - 90;

// Semicircle meter with a spring-y needle; a second thin needle tracks the opponent in races
export default function ClosenessGauge({ value, delta, opponent }: ClosenessGaugeProps) {
  const ticks = [0, 25, 50, 75, 100];

  return (
    <div className="px-3 py-1.5 bg-zinc-900/40 border border-zinc-800/30 rounded-xl flex items-center gap-3">
      <svg viewBox="6 8 188 106" className="w-[76px] sm:w-24 shrink-0" role="img" aria-label={`Closeness to target ${value}%`}>
        {/* Track and the connect zone */}
        <path d={arc(0, 100)} stroke="#27272a" strokeWidth="16" fill="none" strokeLinecap="round" />
        <path d={arc(CONNECT_AT, 100)} stroke="#10b981" strokeOpacity="0.35" strokeWidth="16" fill="none" strokeLinecap="round" />
        {/* Filled progress to your value */}
        <path
          d={arc(0, Math.max(0.5, value))}
          stroke="var(--accent)"
          strokeWidth="16"
          fill="none"
          strokeLinecap="round"
          style={{ transition: "d 600ms ease" }}
        />
        {ticks.map((t) => {
          const outer = polar(t, R - 10);
          const inner = polar(t, R - 17);
          return <line key={t} x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke="#52525b" strokeWidth="3" />;
        })}

        {/* Opponent needle (thin, behind yours) */}
        {opponent && (
          <g style={{ transform: `rotate(${needleRotation(opponent.value)}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform 700ms cubic-bezier(.34,1.56,.64,1)" }}>
            <line x1={CX} y1={CY} x2={CX} y2={CY - R + 14} stroke="#e4e4e7" strokeOpacity="0.8" strokeWidth="4" strokeLinecap="round" strokeDasharray="8 6" />
          </g>
        )}

        {/* Your needle */}
        <g style={{ transform: `rotate(${needleRotation(value)}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform 700ms cubic-bezier(.34,1.56,.64,1)" }}>
          <path d={`M ${CX - 7} ${CY} L ${CX} ${CY - R + 10} L ${CX + 7} ${CY} Z`} fill="var(--accent)" />
        </g>
        <circle cx={CX} cy={CY} r="10" fill="#18181b" stroke="var(--accent)" strokeWidth="5" />

      </svg>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-zinc-400 truncate">Closeness to target</span>
          <span className="shrink-0">
            {delta === "hotter" && <span className="text-xs text-emerald-400 mr-1.5">↑ warmer</span>}
            {delta === "colder" && <span className="text-xs text-sky-400 mr-1.5">↓ colder</span>}
            <span className="text-lg font-bold font-mono text-white">{value}%</span>
          </span>
        </div>
        {opponent ? (
          <div className="text-xs text-zinc-400 truncate">
            <span className="inline-block w-3 border-t-2 border-dashed border-zinc-300 align-middle mr-1.5"></span>
            {opponent.name} <span className="font-mono text-zinc-200">{opponent.value}%</span>
          </div>
        ) : (
          <div className="text-xs text-zinc-500">{CONNECT_AT}%+ connects automatically</div>
        )}
      </div>
    </div>
  );
}
