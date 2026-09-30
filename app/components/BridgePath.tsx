"use client";

import type { StepRecord } from "../lib/player";
import { linkTier, TIER_STYLES } from "../lib/links";

interface BridgePathProps {
  history: StepRecord[];
  targetWord: string;
}

// Vertical chain from the start word; each connector is colored by link strength.
// Until connected, a dashed gap stretches down to a faded target node.
export default function BridgePath({ history, targetWord }: BridgePathProps) {
  const target = targetWord.toLowerCase();
  const connected = history.length > 1 && history[history.length - 1].word.toLowerCase() === target;

  return (
    <ol className="min-h-full flex flex-col" aria-label="Your path">
      {history.map((step, idx) => {
        const isStart = idx === 0;
        const isLast = idx === history.length - 1;
        const isTarget = step.word.toLowerCase() === target;
        const next = history[idx + 1];
        const tier = linkTier(step.relatednessToPrevious);
        const nextTier = next ? linkTier(next.relatednessToPrevious) : null;

        return (
          <li key={`${idx}-${step.word}`} className={`flex gap-3 ${isLast && idx > 0 ? "animate-pop-in" : ""}`}>
            {/* Rail: node dot + connector to the next node */}
            <div className="flex flex-col items-center w-4 shrink-0">
              <span
                className={`mt-3 w-3.5 h-3.5 rounded-full shrink-0 ${
                  isStart || isTarget ? "bg-white ring-4 ring-white/10" : TIER_STYLES[tier].dot
                }`}
              ></span>
              {nextTier && <span className={`flex-1 w-0.5 min-h-3 ${TIER_STYLES[nextTier].line}`}></span>}
            </div>

            <div
              className={`flex-1 min-w-0 flex items-center justify-between px-3 py-2 mb-1.5 rounded-lg border text-sm ${
                isTarget ? "bg-white text-black border-transparent font-semibold" : "bg-zinc-900/40 border-zinc-800/40 text-zinc-100"
              }`}
            >
              <span className="capitalize font-medium truncate">{step.word}</span>
              {isStart ? (
                <span className="text-xs text-zinc-400">Start</span>
              ) : (
                <span className={`text-xs font-mono font-semibold ${isTarget ? "text-zinc-600" : TIER_STYLES[tier].text}`}>
                  {step.relatednessToPrevious}%
                </span>
              )}
            </div>
          </li>
        );
      })}

      {!connected && (
        <>
          {/* The remaining distance to the target */}
          <li aria-hidden="true" className="flex gap-3 flex-1 min-h-8">
            <div className="flex justify-center w-4 shrink-0">
              <span className="border-l-2 border-dashed border-zinc-800 h-full"></span>
            </div>
          </li>
          <li className="flex gap-3">
            <div className="flex flex-col items-center w-4 shrink-0">
              <span className="mt-3 w-3.5 h-3.5 rounded-full border-2 border-dashed border-zinc-600 shrink-0"></span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-zinc-700 text-sm text-zinc-500">
              <span className="capitalize font-medium truncate">{targetWord}</span>
              <span className="text-xs">Target</span>
            </div>
          </li>
        </>
      )}
    </ol>
  );
}
