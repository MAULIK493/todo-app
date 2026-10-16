import { useEffect, useState } from 'react'
import { speechSynthesisSupported } from './speech'

/** True while the browser is reading a reply aloud. Polls lightly because speech synthesis has no reliable "done" event for a queue. */
export function useSpeaking(active: boolean) {
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => {
    if (!active || !speechSynthesisSupported()) return
    const t = setInterval(() => setSpeaking(window.speechSynthesis.speaking || window.speechSynthesis.pending), 300)
    return () => { clearInterval(t); setSpeaking(false) }
  }, [active])
  return speaking
}
