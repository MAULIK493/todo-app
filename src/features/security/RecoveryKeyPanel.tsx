import { Copy, Download, Printer } from 'lucide-react'
import { useState } from 'react'

type Props = { recoveryKey: string; workspaceName: string; confirmLabel?: string; onConfirmed: () => void }

/** Shows the recovery key once and makes the user confirm they have stored it. */
export function RecoveryKeyPanel({ recoveryKey, workspaceName, confirmLabel = 'Continue', onConfirmed }: Props) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable: the key is on screen */ }
  }

  const download = () => {
    const text = `Recovery key for the private workspace "${workspaceName}"\n\n${recoveryKey}\n\nKeep this somewhere safe and private. Anyone with this key can open the workspace; without it (and without your code) the data cannot be recovered.\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `recovery-key-${workspaceName.replace(/\W+/g, '-').toLowerCase()}.txt` })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        If you forget your code, this key is the only way back in. Store it somewhere safe, like a password manager or a printout in a drawer.
        It is shown only once and is not saved anywhere else.
      </p>
      <div className="print-area">
        <p className="hidden text-sm print:block">Recovery key for the private workspace “{workspaceName}”</p>
        <p className="glass select-all break-all rounded-xl p-4 text-center font-mono text-lg tracking-wider" data-testid="recovery-key">{recoveryKey}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={copy} className="glass flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</button>
        <button onClick={download} className="glass flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"><Download size={14} /> Download</button>
        <button onClick={() => window.print()} className="glass flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm"><Printer size={14} /> Print</button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" />
        I have stored this recovery key somewhere safe.
      </label>
      <button disabled={!saved} onClick={onConfirmed} className="w-full rounded-xl bg-accent py-2 font-medium text-white disabled:opacity-50">{confirmLabel}</button>
    </div>
  )
}
