// SetuHealth's mark: an arched bridge ("setu" = bridge) over a network node.
export default function BrandMark({ size = 36, tone = "console" }: { size?: number; tone?: "console" | "public" }) {
  const bg =
    tone === "public"
      ? "bg-gradient-to-br from-brand-400 to-brand-600"
      : "bg-gradient-to-br from-brand-500 to-brand-700";
  return (
    <div
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-xl text-white shadow-md shadow-brand-700/30 ${bg}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-gold-300/60 blur-md" />
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 18.5h19" />
        <path d="M4.5 18.5C4.5 12 8 7.5 12 7.5s7.5 4.5 7.5 11" />
        <path d="M9 18.5v-4.2M12 18.5V7.5M15 18.5v-4.2" />
        <circle cx="12" cy="4.6" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}
