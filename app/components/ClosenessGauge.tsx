"use client";

interface ClosenessGaugeProps {
  value: number; // 0-100, your latest word's closeness to the target
  delta: "hotter" | "colder" | null;
  opponent?: { name: string; value: number } | null;
}

const CX = 100;
const CY = 100;
const CONNECT_AT = 70; // auto-connect threshold
// Pink (--opponent): distinct from your violet and the green/yellow/orange link tiers
const OPPONENT_COLOR = "var(--opponent)";
const SPRING = "700ms cubic-bezier(.34,1.56,.64,1)";

// Solo: one thick ring. Race: opponent ring outside, your ring inside, sharing one double-width connect zone.
const SOLO_YOU = { r: 80, w: 16 };
const RACE_OPPONENT = { r: 84, w: 11 };
const RACE_YOU = { r: 70, w: 11 };

const clamp = (pct: number) => Math.min(100, Math.max(0, pct));

// Point on the half circle: 0% = far left, 100% = far right
function polar(pct: number, radius: number) {
  const angle = Math.PI * (1 - clamp(pct) / 100);
  return { x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle) };
}

function arc(from: number, to: number, radius: number) {
  const a = polar(from, radius);
  const b = polar(to, radius);
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${b.x} ${b.y}`;
}

// Rotation for a needle drawn pointing straight up (50%)
const needleRotation = (pct: number) => (clamp(pct) / 100) * 180 - 90;

// A track plus its progress fill; endDot marks where the fill currently ends
function Ring({ value, r, w, color, endDot = false }: { value: number; r: number; w: number; color: string; endDot?: boolean }) {
  const shown = Math.max(0.5, value);
  const end = polar(shown, r);
  return (
    <>
      <path d={arc(0, 100, r)} stroke="#27272a" strokeWidth={w} fill="none" strokeLinecap="round" />
      <path d={arc(0, shown, r)} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" style={{ transition: "d 600ms ease" }} />
      {endDot && (
        <circle cx={end.x} cy={end.y} r={w / 2 + 2} fill={color} stroke="#09090b" strokeWidth="3" style={{ transition: "cx 600ms ease, cy 600ms ease" }} />
      )}
    </>
  );
}

// Semicircle meter with a spring-y needle; in races the opponent fills a pink outer ring
export default function ClosenessGauge({ value, delta, opponent }: ClosenessGaugeProps) {
  const you = opponent ? RACE_YOU : SOLO_YOU;

  // The connect zone spans every ring: inner edge of your ring to the outer edge of the outermost ring
  const outerEdge = opponent ? RACE_OPPONENT.r + RACE_OPPONENT.w / 2 : you.r + you.w / 2;
  const innerEdge = you.r - you.w / 2;
  const zoneR = (outerEdge + innerEdge) / 2;
  const zoneW = outerEdge - innerEdge;

  const ticks = [0, 25, 50, 75, 100];

  return (
    <div className="px-3 py-1.5 bg-zinc-900/40 border border-zinc-800/30 rounded-xl flex items-center gap-3">
      <svg
        viewBox="4 4 192 110"
        className="w-[76px] sm:w-24 shrink-0"
        role="img"
        aria-label={`Closeness to target: you ${value}%${opponent ? `, ${opponent.name} ${opponent.value}%` : ""}`}
      >
        {opponent && <Ring value={opponent.value} r={RACE_OPPONENT.r} w={RACE_OPPONENT.w} color={OPPONENT_COLOR} endDot />}
        <Ring value={value} r={you.r} w={you.w} color="var(--accent)" />

        {/* Shared connect zone, one band across both rings */}
        <path d={arc(CONNECT_AT, 100, zoneR)} stroke="#10b981" strokeOpacity="0.4" strokeWidth={zoneW} fill="none" />

        {ticks.map((t) => {
          const outer = polar(t, innerEdge - 3);
          const inner = polar(t, innerEdge - 10);
          return <line key={t} x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke="#52525b" strokeWidth="3" />;
        })}

        {/* Your needle */}
        <g style={{ transform: `rotate(${needleRotation(value)}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: `transform ${SPRING}` }}>
          <path d={`M ${CX - 7} ${CY} L ${CX} ${CY - innerEdge + 4} L ${CX + 7} ${CY} Z`} fill="var(--accent)" />
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
            <span
              className={`shrink-0 font-medium ${
                opponent.value > value ? "text-rose-300" : opponent.value < value ? "text-emerald-400" : "text-zinc-400"
              }`}
            >
              {opponent.value > value
                ? `ahead by ${opponent.value - value}`
                : opponent.value < value
                ? `you lead by ${value - opponent.value}`
                : "tied"}
            </span>
          </div>
        ) : (
          <div className="text-xs text-zinc-500">{CONNECT_AT}%+ connects automatically</div>
        )}
      </div>
    </div>
  );
}
