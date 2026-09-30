// WordBridge wordmark: two word "pillars" joined by an arc
export default function Logo({ size = "lg" }: { size?: "sm" | "lg" }) {
  const big = size === "lg";
  return (
    <span className={`inline-flex items-center gap-2.5 ${big ? "text-4xl" : "text-lg"} font-semibold tracking-tight text-white`}>
      <svg
        viewBox="0 0 40 24"
        className={big ? "w-11 h-7" : "w-6 h-4"}
        aria-hidden="true"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <path d="M4 20 Q20 -2 36 20" />
        <path d="M4 20 V22 M36 20 V22 M12 12.5 V20 M20 10 V20 M28 12.5 V20" strokeWidth="2" opacity="0.6" />
      </svg>
      WordBridge
    </span>
  );
}
