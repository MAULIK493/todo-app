import { Delete } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { PIN_MAX } from './secrets'

type Props = { onSubmit: (pin: string) => void; disabled?: boolean; shakeKey?: number; submitLabel?: string }

/** Numeric keypad. Works with touch, mouse and the keyboard (digits, Backspace, Enter). */
export function PinPad({ onSubmit, disabled, shakeKey = 0, submitLabel = 'Unlock' }: Props) {
  const [value, setValue] = useState('')

  const press = (d: string) => setValue((v) => (v.length < PIN_MAX ? v + d : v))
  const back = () => setValue((v) => v.slice(0, -1))
  const submit = () => { if (value && !disabled) { onSubmit(value); setValue('') } }

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return
    if (/^\d$/.test(e.key)) press(e.key)
    else if (e.key === 'Backspace') back()
    else if (e.key === 'Enter') submit()
    else return
    e.preventDefault()
  }

  return (
    <div className="mx-auto w-full max-w-60 space-y-4 outline-none" tabIndex={0} onKeyDown={onKey} aria-label="PIN entry">
      <motion.div key={shakeKey} animate={shakeKey ? { x: [0, -10, 10, -8, 8, 0] } : {}} transition={{ duration: 0.4 }} className="space-y-4">
        <div className="flex h-6 items-center justify-center gap-2" aria-live="polite" aria-label={`${value.length} digits entered`}>
          {value.length === 0 ? <span className="text-sm text-muted">Enter your PIN</span> : Array.from(value, (_, i) => (
            <motion.span key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} className="size-3 rounded-full bg-accent" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <Key key={d} onClick={() => press(d)} disabled={disabled}>{d}</Key>)}
          <Key onClick={back} disabled={disabled} label="Delete last digit"><Delete size={18} /></Key>
          <Key onClick={() => press('0')} disabled={disabled}>0</Key>
          <span />
        </div>
      </motion.div>
      <button
        type="button" onClick={submit} disabled={disabled || !value}
        className="w-full rounded-xl bg-accent py-2 font-medium text-white disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  )
}

function Key({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <motion.button
      type="button" whileTap={{ scale: 0.92 }} onClick={onClick} disabled={disabled} aria-label={label}
      className={cn('glass grid h-12 place-items-center rounded-xl text-lg font-medium hover:bg-white/10 disabled:opacity-50')}
    >
      {children}
    </motion.button>
  )
}
