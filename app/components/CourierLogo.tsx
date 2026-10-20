// Round courier badge: the courier's logo, or a monogram bubble for couriers without one.
export function CourierLogo({ c, size = 44, className = "" }: { c: { id: string; name: string; logo?: string | null; color: string }; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (c.logo) {
    return <img src={c.logo} alt={c.name} width={size} height={size} loading="lazy" className={`shrink-0 rounded-full object-contain drop-shadow-sm ${className}`} style={style} />;
  }
  if (c.id === "shipnex") {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 via-pine to-slate-900 font-bold text-white shadow-sm ring-2 ring-white ${className}`} style={{ ...style, fontSize: size * 0.36 }} aria-label={c.name}>
        S<span className="text-emerald-300">x</span>
      </span>
    );
  }
  const initials = c.id === "other" ? "+" : c.name.replace(/^The /, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-white to-slate-100 font-bold shadow-sm ring-1 ring-slate-200 ${className}`} style={{ ...style, color: c.color, fontSize: size * (initials.length > 1 ? 0.32 : 0.42) }} aria-label={c.name}>
      {initials}
    </span>
  );
}
