import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { LockType } from './crypto'
import { PatternGrid } from './PatternGrid'
import { PinPad } from './PinPad'
import { encodePattern } from './secrets'

type Props = { type: LockType; onSubmit: (secret: string) => void; disabled?: boolean; shakeKey?: number; submitLabel?: string; autoFocus?: boolean }

/** The right entry widget for each code type; always hands back the code as a string. */
export function SecretInput({ type, onSubmit, disabled, shakeKey, submitLabel, autoFocus }: Props) {
  if (type === 'pin') return <PinPad onSubmit={onSubmit} disabled={disabled} shakeKey={shakeKey} submitLabel={submitLabel} />
  if (type === 'pattern') return <PatternGrid onComplete={(n) => onSubmit(encodePattern(n))} disabled={disabled} shakeKey={shakeKey} submitLabel={submitLabel} />
  return <PasswordField onSubmit={onSubmit} disabled={disabled} submitLabel={submitLabel} autoFocus={autoFocus} />
}

function PasswordField({ onSubmit, disabled, submitLabel = 'Unlock', autoFocus }: Pick<Props, 'onSubmit' | 'disabled' | 'submitLabel' | 'autoFocus'>) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  return (
    <form className="mx-auto w-full max-w-xs space-y-3" onSubmit={(e) => { e.preventDefault(); if (value && !disabled) { onSubmit(value); setValue('') } }}>
      <label className="glass flex items-center gap-2 rounded-xl px-3 py-2">
        <span className="sr-only">Password</span>
        <input
          type={show ? 'text' : 'password'} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled}
          autoFocus={autoFocus} autoComplete="off" placeholder="Security code" className="min-w-0 flex-1 bg-transparent outline-none"
        />
        <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} className="text-muted hover:text-text">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </label>
      <button disabled={disabled || !value} className="w-full rounded-xl bg-accent py-2 font-medium text-white disabled:opacity-50">{submitLabel}</button>
    </form>
  )
}
