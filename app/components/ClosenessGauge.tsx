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
    <div className="px-3 pt-2 pb-1.5 bg-zinc-900/40 border border-zinc-800/30 rounded-xl flex items-center gap-3">
      <svg viewBox="0 0 200 112" className="w-40 sm:w-48 shrink-0" role="img" aria-label={`Closeness to target ${value}%`}>
        {/* Track and the connect zone */}
        <path d={arc(0, 100)} stroke="#27272a" strokeWidth="12" fill="none" strokeLinecap="round" />
        <path d={arc(CONNECT_AT, 100)} stroke="#10b981" strokeOpacity="0.35" strokeWidth="12" fill="none" strokeLinecap="round" />
        {/* Filled progress to your value */}
        <path
          d={arc(0, Math.max(0.5, value))}
          stroke="var(--accent)"
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          style={{ transition: "d 600ms ease" }}
        />
        {ticks.map((t) => {
          const outer = polar(t, R - 10);
          const inner = polar(t, R - 17);
          return <line key={t} x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke="#52525b" strokeWidth="1.5" />;
        })}

        {/* Opponent needle (thin, behind yours) */}
        {opponent && (
          <g style={{ transform: `rotate(${needleRotation(opponent.value)}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform 700ms cubic-bezier(.34,1.56,.64,1)" }}>
            <line x1={CX} y1={CY} x2={CX} y2={CY - R + 14} stroke="#e4e4e7" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3" />
          </g>
        )}

        {/* Your needle */}
        <g style={{ transform: `rotate(${needleRotation(value)}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform 700ms cubic-bezier(.34,1.56,.64,1)" }}>
          <path d={`M ${CX - 4} ${CY} L ${CX} ${CY - R + 12} L ${CX + 4} ${CY} Z`} fill="var(--accent)" />
        </g>
        <circle cx={CX} cy={CY} r="7" fill="#18181b" stroke="var(--accent)" strokeWidth="3" />

        <text x={polar(0, R + 2).x + 2} y={CY + 11} fontSize="10" fill="#71717a">0</text>
        <text x={polar(100, R + 2).x - 14} y={CY + 11} fontSize="10" fill="#71717a">100</text>
      </svg>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-xs text-zinc-400">Closeness to target</div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono text-white">{value}%</span>
          {delta === "hotter" && <span className="text-sm text-emerald-400">↑ warmer</span>}
          {delta === "colder" && <span className="text-sm text-sky-400">↓ colder</span>}
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
