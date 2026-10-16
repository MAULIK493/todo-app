import { ArrowLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Backdrop, glassPanel } from '@/features/landing/Backdrop'

const input = 'w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] outline-none backdrop-blur-md placeholder:text-white/45 focus:border-white/40 focus:bg-white/[0.1] focus:ring-2 focus:ring-white/20'
const wide = 'flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[15px] font-medium transition-all disabled:opacity-60'

export function LoginPage() {
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [step, setStep] = useState<'email' | 'password'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const signup = mode === 'signup'

  useEffect(() => { (step === 'email' ? emailRef : passwordRef).current?.focus() }, [step])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMessage(null)
    if (step === 'email') { if (email.trim()) setStep('password'); return }
    setBusy(true)
    const { error, data } = signup
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setMessage({ text: error.message, error: true })
    else if (signup && !data.session) setMessage({ text: 'Check your email to confirm your account, then sign in.', error: false })
  }

  const switchMode = () => { setMode(signup ? 'signin' : 'signup'); setStep('email'); setPassword(''); setMessage(null) }

  return (
    <div data-theme="dark" className="relative isolate grid min-h-full place-items-center overflow-hidden bg-[#07070d] p-4 text-white">
      <Backdrop />
      <Link to="/" className="fixed left-4 top-4 z-10 flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-white/65 hover:bg-white/10 hover:text-white"><ArrowLeft size={16} aria-hidden /> Back</Link>

      <motion.main initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className={`relative w-full max-w-[480px] overflow-hidden rounded-[2rem] p-6 sm:p-10 ${glassPanel}`}>
        {/* A soft highlight across the top, like light catching the glass. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.14] to-transparent" aria-hidden />
        <div className="relative mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 text-xl font-bold shadow-lg shadow-violet-500/30" aria-hidden>✓</div>
        <h1 className="relative mt-6 text-center text-3xl font-semibold tracking-tight sm:text-4xl">{signup ? 'Create your account' : 'Sign in to Todo App'}</h1>
        <p className="relative mt-2 text-center text-[15px] text-white/60">{signup ? 'Start organising your todos and notes.' : 'Welcome back. Pick up where you left off.'}</p>

        <form onSubmit={submit} className="relative mt-8 space-y-3">
          {step === 'email' ? (
            <>
              <label className="sr-only" htmlFor="email">Email</label>
              <input id="email" ref={emailRef} className={input} type="email" placeholder="name@email.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </>
          ) : (
            <>
              <p className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-[15px]">
                <span className="truncate text-white/80">{email}</span>
                <button type="button" onClick={() => { setStep('email'); setMessage(null) }} className="shrink-0 text-sm text-white/50 underline-offset-2 hover:text-white hover:underline">Change</button>
              </p>
              <label className="sr-only" htmlFor="password">Password</label>
              <input id="password" ref={passwordRef} className={input} type="password" placeholder={signup ? 'Create a password (8+ characters)' : 'Password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          )}
          {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-sm text-red-400' : 'text-sm text-emerald-300'}>{message.text}</p>}
          <button disabled={busy} className={`${wide} bg-white text-black shadow-lg shadow-black/20 hover:scale-[1.02]`}>
            {step === 'email' ? 'Continue with Email' : busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="relative mt-8 text-center text-[15px] text-white/60">
          {signup ? 'Already have an account?' : 'Don’t have an account?'}{' '}
          <button type="button" onClick={switchMode} className="font-medium text-white hover:underline">{signup ? 'Sign in' : 'Sign up'}</button>
        </p>
        <p className="relative mt-5 text-center text-xs leading-relaxed text-white/40">By continuing, you agree to create an account and have your data stored securely. Private workspaces are encrypted on your device.</p>
      </motion.main>
    </div>
  )
}
