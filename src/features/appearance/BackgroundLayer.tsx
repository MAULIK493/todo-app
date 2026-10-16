import { CanvasField } from './CanvasField'
import { useEffectFlags } from './store'
import { usePageVisible } from './useEnvWatcher'

/** The app-wide background: a slowly drifting starfield. It holds still when effects are reduced or the tab is hidden. */
export function BackgroundLayer() {
  const flags = useEffectFlags()
  const visible = usePageVisible()
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-bg" aria-hidden data-testid="background">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(99,64,240,0.28),transparent_60%),radial-gradient(ellipse_at_80%_100%,rgba(25,195,255,0.14),transparent_55%)]" />
      <CanvasField density={flags.density} running={flags.animatedBackground && visible} />
    </div>
  )
}
