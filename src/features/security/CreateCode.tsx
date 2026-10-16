import { useState } from 'react'
import type { LockType } from './crypto'
import { SecretInput } from './SecretInput'
import { LOCK_NOUN, validateSecret } from './secrets'

type Props = { type: LockType; onChosen: (secret: string) => void; disabled?: boolean }

/** Enter a new code twice. Weak codes are refused with a reason; a mismatch starts the confirmation over. */
export function CreateCode({ type, onChosen, disabled }: Props) {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  const fail = (msg: string, resetFirst = false) => {
    setError(msg)
    setShake((n) => n + 1)
    if (resetFirst) setFirst(null)
  }

  const submit = (secret: string) => {
    if (first === null) {
      const problem = validateSecret(type, secret)
      if (problem) return fail(problem)
      setError(null)
      setFirst(secret)
    } else if (secret === first) {
      onChosen(secret)
    } else {
      fail(`The two ${LOCK_NOUN[type]}s did not match. Start again.`, true)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-sm font-medium" aria-live="polite">
        {first === null ? `Choose a ${LOCK_NOUN[type]}` : `Enter it again to confirm`}
      </p>
      <SecretInput key={first === null ? 'first' : 'confirm'} type={type} onSubmit={submit} disabled={disabled} shakeKey={shake} submitLabel={first === null ? 'Continue' : 'Confirm'} autoFocus />
      {error && <p className="text-center text-sm text-red-400" role="alert">{error}</p>}
    </div>
  )
}
