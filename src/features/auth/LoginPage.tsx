import { ArrowLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Backdrop, glassPanel } from '@/features/landing/Backdrop'

const input = 'w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] outline-none backdrop-blur-md placeholder:text-white/45 focus:border-white/40 focus:bg-white/[0.1] focus:ring-2 focus:ring-white/20'
const wide = 'flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[15px] font-medium transition-all disabled:opacity-60'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}

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

  const google = () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } })
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

        <div className="relative my-5 flex items-center gap-3 text-xs text-white/40"><span className="h-px flex-1 bg-white/15" />or<span className="h-px flex-1 bg-white/15" /></div>
        <button type="button" onClick={google} className={`${wide} relative border border-white/15 bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md hover:bg-white/[0.14]`}><GoogleMark /> Continue with Google</button>

        <p className="relative mt-7 text-center text-[15px] text-white/60">
          {signup ? 'Already have an account?' : 'Don’t have an account?'}{' '}
          <button type="button" onClick={switchMode} className="font-medium text-white hover:underline">{signup ? 'Sign in' : 'Sign up'}</button>
        </p>
        <p className="relative mt-5 text-center text-xs leading-relaxed text-white/40">By continuing, you agree to create an account and have your data stored securely. Private workspaces are encrypted on your device.</p>
      </motion.main>
    </div>
  )
}
