"use client";

interface RulesSheetProps {
  open: boolean;
  onClose: () => void;
  firstVisit?: boolean;
}

const EXAMPLE = ["cat", "pet", "vet", "doctor"];

const RANKS = [
  { rank: "S+", min: "9,000+", title: "Semantic Mastermind" },
  { rank: "A", min: "7,500+", title: "Lexical Cartographer" },
  { rank: "B", min: "6,000+", title: "Pathfinder" },
  { rank: "C", min: "4,000+", title: "Wanderer" },
  { rank: "D", min: "below", title: "Explorer" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      {children}
    </section>
  );
}

// How to play, scoring, and modes; auto-opens once on a player's first visit
export default function RulesSheet({ open, onClose, firstVisit = false }: RulesSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How to play"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-t-2xl sm:rounded-2xl p-5 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{firstVisit ? "Welcome to WordBridge" : "How to play"}</h2>
          <button onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-white text-sm px-2 py-1">
            ✕
          </button>
        </div>

        <Section title="The goal">
          <p className="text-sm text-zinc-300 leading-relaxed">
            Get from the start word to the target word by typing a chain of related words.
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {EXAMPLE.map((w, i) => (
              <span key={w} className="flex items-center gap-1.5">
                <span
                  className={`px-2.5 py-1 rounded-lg border ${
                    i === 0 || i === EXAMPLE.length - 1 ? "bg-white text-black border-white font-semibold" : "border-zinc-700 text-zinc-200"
                  }`}
                >
                  {w}
                </span>
                {i < EXAMPLE.length - 1 && <span className="text-zinc-500">→</span>}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Rules">
          <ul className="text-sm text-zinc-300 space-y-1.5 list-disc pl-5 leading-relaxed">
            <li>An AI rates how related each word is to your previous word. <b className="text-white">70% or more</b> adds it to your path.</li>
            <li>Anything lower is a <b className="text-white">miss</b> and costs points.</li>
            <li>If your word is 70%+ related to the target, the bridge <b className="text-white">connects automatically</b>.</li>
            <li>You can&apos;t reuse a word. The closeness bar shows how near your latest word is to the target.</li>
            <li>Tap the start or target word to see its definition.</li>
          </ul>
        </Section>

        <Section title="Scoring (up to 10,000)">
          <div className="grid grid-cols-2 gap-1.5 text-sm">
            <div className="bg-zinc-900 rounded-lg p-2.5"><div className="text-white font-medium">Difficulty</div><div className="text-zinc-400 text-xs">1,500–2,500 · harder pairs pay more</div></div>
            <div className="bg-zinc-900 rounded-lg p-2.5"><div className="text-white font-medium">Steps</div><div className="text-zinc-400 text-xs">4,000 at par (4), −500 per extra</div></div>
            <div className="bg-zinc-900 rounded-lg p-2.5"><div className="text-white font-medium">Link strength</div><div className="text-zinc-400 text-xs">Avg. link % × 35</div></div>
            <div className="bg-zinc-900 rounded-lg p-2.5"><div className="text-white font-medium">Misses</div><div className="text-zinc-400 text-xs">−150 each</div></div>
          </div>
          <div className="space-y-1">
            {RANKS.map((r) => (
              <div key={r.rank} className="flex items-center justify-between text-sm">
                <span className="text-white font-semibold w-8">{r.rank}</span>
                <span className="text-zinc-300 flex-1">{r.title}</span>
                <span className="text-zinc-500 text-xs">{r.min}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Modes">
          <ul className="text-sm text-zinc-300 space-y-1.5 leading-relaxed">
            <li><b className="text-white">Daily</b> — same puzzle for everyone, new at 00:00 UTC. Sign in for one ranked attempt, a streak, and the leaderboard.</li>
            <li><b className="text-white">Solo</b> — unlimited random puzzles.</li>
            <li><b className="text-white">Race</b> — you and an opponent get the same words; first to connect wins. You see their progress, not their words, until the end.</li>
          </ul>
        </Section>

        <button onClick={onClose} className="w-full py-3 bg-white text-black font-semibold rounded-xl text-sm hover:bg-zinc-200 transition-colors">
          {firstVisit ? "Let's play" : "Got it"}
        </button>
      </div>
    </div>
  );
}
