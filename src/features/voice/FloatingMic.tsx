import { Mic } from 'lucide-react'
import { motion } from 'motion/react'
import { Magnetic } from '@/components/fx/Magnetic'
import { useAssistant } from '@/features/assistant/store'
import { getRecognitionCtor } from './recognition'
import { recorderSupported } from './recorder'

/** A mic button on every screen: opens the assistant and starts listening straight away. */
export function FloatingMic() {
  const open = useAssistant((s) => s.open)
  const requestVoice = useAssistant((s) => s.requestVoice)
  if (open || (!getRecognitionCtor() && !recorderSupported())) return null

  return (
    <Magnetic className="fixed bottom-5 right-5 z-30">
    <motion.button
      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.93 }}
      onClick={requestVoice} aria-label="Talk to the assistant" title="Talk to the assistant (Ctrl+Shift+Space)"
      className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white shadow-xl"
    >
      <Mic size={24} />
    </motion.button>
    </Magnetic>
  )
}
