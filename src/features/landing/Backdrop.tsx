/** The landing page's slow violet/cyan glow with a faint grid. Shared with the sign-in page so they feel like one place. */
export function Backdrop() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -left-40 -top-40 size-[44rem] rounded-full bg-violet-600/40 blur-[120px]" style={{ animation: 'drift 22s ease-in-out infinite alternate' }} />
      <div className="absolute -bottom-52 -right-40 size-[44rem] rounded-full bg-cyan-500/30 blur-[120px]" style={{ animation: 'drift 28s ease-in-out infinite alternate-reverse' }} />
      <div className="absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '56px 56px' }} />
    </div>
  )
}

/** iOS-style frosted glass: translucent, heavily blurred and saturated, with a lit top edge. */
export const glassPanel =
  'border border-white/[0.18] bg-white/[0.08] backdrop-blur-2xl backdrop-saturate-150 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(255,255,255,0.06),0_30px_80px_-24px_rgba(0,0,0,0.75)]'
