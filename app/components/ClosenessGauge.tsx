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
// Pink (--opponent): distinct from your violet and the green/yellow/orange link tiers
const OPPONENT_COLOR = "var(--opponent)";

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

// Semicircle meter with a spring-y needle; in races a pink needle + rim marker tracks the opponent
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

        {/* Opponent: solid pink needle (behind yours) plus a marker on the rim, visible even when needles overlap */}
        {opponent && (
          <g style={{ transform: `rotate(${needleRotation(opponent.value)}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform 700ms cubic-bezier(.34,1.56,.64,1)" }}>
            <path d={`M ${CX - 5} ${CY} L ${CX} ${CY - R + 18} L ${CX + 5} ${CY} Z`} fill={OPPONENT_COLOR} />
            <circle cx={CX} cy={CY - R} r="11" fill={OPPONENT_COLOR} stroke="#09090b" strokeWidth="4" />
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
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OPPONENT_COLOR }}></span>
              <span className="truncate font-medium" style={{ color: OPPONENT_COLOR }}>
                {opponent.name}
              </span>
              <span className="font-mono font-semibold text-zinc-100">{opponent.value}%</span>
            </span>
            <span className={`shrink-0 font-medium ${opponent.value > value ? "text-rose-300" : opponent.value < value ? "text-emerald-400" : "text-zinc-400"}`}>
              {opponent.value > value ? `ahead by ${opponent.value - value}` : opponent.value < value ? `you lead by ${value - opponent.value}` : "tied"}
            </span>
          </div>
        ) : (
          <div className="text-xs text-zinc-500">{CONNECT_AT}%+ connects automatically</div>
        )}
      </div>
    </div>
  );
}
