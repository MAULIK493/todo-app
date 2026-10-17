import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Backdrop, glassPanel } from '@/features/landing/Backdrop'

const input = 'w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] outline-none backdrop-blur-md placeholder:text-white/45 focus:border-white/40 focus:bg-white/[0.1] focus:ring-2 focus:ring-white/20'

/** The service's wording is terse; add the next step while keeping its text. */
function friendly(message: string, signup: boolean) {
  if (/invalid login credentials/i.test(message)) return `${message}. Check your email and password, or use “Email me a sign-in link” below.`
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first: open the link we sent you, then sign in.'
  if (/already registered/i.test(message)) return 'This email already has an account. Use “Sign in” below instead.'
  if (/rate limit|too many/i.test(message)) return 'Too many emails were requested. Wait up to an hour and try again, or sign in with your password if you already have an account.'
  if (/failed to fetch|network/i.test(message)) return 'Could not reach the server. Check your connection and try again.'
  return signup && /password/i.test(message) ? `${message}. Use at least 8 characters.` : message
}

// Shown only once Google is enabled in Supabase and VITE_GOOGLE_AUTH=true is set.
const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH === 'true'

const wide = 'flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[15px] font-medium transition-all disabled:opacity-60'

export function LoginPage() {
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [step, setStep] = useState<'email' | 'password'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
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
    if (error) setMessage({ text: friendly(error.message, signup), error: true })
    else if (signup && !data.session) setMessage({ text: 'Check your email to confirm your account, then sign in.', error: false })
  }

  const google = async () => {
    setMessage(null)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) setMessage({ text: friendly(error.message, signup), error: true })
  }

  const emailLink = async () => {
    setBusy(true); setMessage(null)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } })
    setBusy(false)
    setMessage(error ? { text: friendly(error.message, false), error: true } : { text: 'We emailed you a sign-in link. Open it on this device to continue.', error: false })
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

        {googleEnabled && (
          <div className="relative mt-8">
            <button type="button" onClick={google} className={`${wide} border border-white/20 bg-white/10 hover:bg-white/15`}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8a6.1 6.1 0 0 1 0-12.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5A9.9 9.9 0 0 0 12 2a10 10 0 1 0 0 20c5.8 0 9.6-4 9.6-9.8 0-.7-.1-1.2-.2-2z"/></svg>
              Continue with Google
            </button>
            <p className="mt-4 text-center text-xs text-white/40">or use your email</p>
          </div>
        )}

        <form onSubmit={submit} className={`relative ${googleEnabled ? 'mt-3' : 'mt-8'} space-y-3`}>
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
              <div className="relative">
                <input id="password" ref={passwordRef} className={`${input} pr-12`} type={show ? 'text' : 'password'} placeholder={signup ? 'Create a password (8+ characters)' : 'Password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-white/55 hover:bg-white/10 hover:text-white">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            </>
          )}
          {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-sm text-red-400' : 'text-sm text-emerald-300'}>{message.text}</p>}
          <button disabled={busy} className={`${wide} bg-white text-black shadow-lg shadow-black/20 hover:scale-[1.02]`}>
            {step === 'email' ? 'Continue with Email' : busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
          {step === 'password' && !signup && (
            <button type="button" disabled={busy} onClick={emailLink} className="w-full text-center text-sm text-white/60 hover:text-white hover:underline disabled:opacity-60">Email me a sign-in link instead</button>
          )}
        </form>

        <p className="relative mt-8 text-center text-[15px] text-white/60">
          {signup ? 'Already have an account?' : 'Don’t have an account?'}{' '}
          <button type="button" onClick={switchMode} className="font-medium text-white hover:underline">{signup ? 'Sign in' : 'Sign up'}</button>
        </p>
        <p className="relative mt-5 text-center text-xs leading-relaxed text-white/40">By continuing, you agree to create an account and have your data stored securely. Private workspaces are encrypted on your device. <Link to="/privacy" className="underline hover:text-white">Privacy Policy</Link></p>
      </motion.main>
    </div>
  )
}
