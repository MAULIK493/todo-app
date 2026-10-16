import { ArrowRight, Check, CheckCircle2, FolderKanban, Lock, Mic, NotebookPen, Sparkles, Trophy, WifiOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { Backdrop } from './Backdrop'

const START = '/login?mode=signup'
const glass = 'border border-white/[0.14] bg-white/[0.07] backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Todo App home">
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-bold text-white" aria-hidden>✓</span>
      Todo App
    </Link>
  )
}

function Nav() {
  const link = 'rounded-full px-3 py-1.5 text-sm text-white/70 transition-colors hover:text-white'
  return (
    <header className="fixed inset-x-0 top-4 z-30 flex justify-center px-4">
      <nav aria-label="Primary" className={cn(glass, 'flex w-full max-w-3xl items-center justify-between gap-2 rounded-full py-2 pl-4 pr-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)]')}>
        <Logo />
        <div className="hidden items-center md:flex">
          <a href="#features" className={link}>Features</a>
          <a href="#numbers" className={link}>Why it’s different</a>
          <a href="#start" className={link}>Get started</a>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/login" className="rounded-full px-3 py-1.5 text-sm text-white/80 hover:text-white">Sign in</Link>
          <Link to={START} className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition-transform hover:scale-105">Get started</Link>
        </div>
      </nav>
    </header>
  )
}

/** A small fake app window used as a picture of the product. */
function Window({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(glass, 'overflow-hidden rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]', className)} aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-white/20" /><span className="size-2.5 rounded-full bg-white/20" /><span className="size-2.5 rounded-full bg-white/20" />
        <span className="ml-3 text-xs text-white/50">{title}</span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  )
}

function TodoMock({ items }: { items: { t: string; done?: boolean; tag?: string; due?: string }[] }) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.t} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', i.done ? 'border-emerald-400 bg-emerald-400 text-black' : 'border-white/30')}>{i.done && <Check size={12} strokeWidth={3} />}</span>
          <span className={cn('flex-1 truncate text-sm', i.done && 'text-white/40 line-through')}>{i.t}</span>
          {i.tag && <span className="rounded-full bg-violet-500/25 px-2 py-0.5 text-[11px] text-violet-200">{i.tag}</span>}
          {i.due && <span className="text-[11px] text-white/45">{i.due}</span>}
        </li>
      ))}
    </ul>
  )
}

const TABS = [
  {
    id: 'todos', label: 'Todos', icon: CheckCircle2, title: 'Every todo, exactly where you want it',
    points: ['Subtasks, priorities, due dates and repeating tasks', 'Drag to reorder, or switch to a Kanban board', 'Search and bulk-edit thousands of todos without slowdown'],
    visual: <Window title="Personal · Today"><TodoMock items={[{ t: 'Send the invoice', tag: 'work', due: 'Today' }, { t: 'Call mom', due: '6 pm' }, { t: 'Book dentist', tag: 'health' }, { t: 'Water the plants', done: true }]} /></Window>,
  },
  {
    id: 'notes', label: 'Notes', icon: NotebookPen, title: 'Notes that live next to your tasks',
    points: ['Rich text with headings, checklists, code and links', 'Pin the important ones, sort the rest into folders', 'Link a note to a todo so nothing gets lost'],
    visual: (
      <Window title="Notes · Project kickoff">
        <p className="text-lg font-semibold">Project kickoff</p>
        <div className="mt-3 space-y-2 text-sm text-white/65">
          <p>Goals for the quarter, decisions made, and who owns what.</p>
          <p className="flex items-center gap-2"><span className="grid size-4 place-items-center rounded bg-violet-500 text-white"><Check size={11} /></span> Agree the scope</p>
          <p className="flex items-center gap-2"><span className="size-4 rounded border border-white/30" /> Share the plan</p>
          <p className="rounded-lg border-l-2 border-violet-400 bg-white/[0.04] px-3 py-2 text-white/55">Linked todo: “Send the invoice”</p>
        </div>
      </Window>
    ),
  },
  {
    id: 'private', label: 'Private', icon: Lock, title: 'Private really means private',
    points: ['Lock a workspace with a PIN, a pattern or a security code', 'Content is encrypted in your browser before it is ever saved', 'Locked workspaces stay hidden from the assistant and from search'],
    visual: (
      <Window title="Diary · Locked">
        <div className="grid place-items-center py-2">
          <div className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-400"><Lock size={22} /></div>
          <p className="mt-3 text-sm text-white/60">Draw your pattern to unlock</p>
          <div className="mt-4 grid grid-cols-3 gap-5">
            {Array.from({ length: 9 }, (_, i) => <span key={i} className={cn('size-4 rounded-full', [0, 1, 4, 7, 8].includes(i) ? 'bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.9)]' : 'bg-white/25')} />)}
          </div>
        </div>
      </Window>
    ),
  },
  {
    id: 'assistant', label: 'Assistant', icon: Sparkles, title: 'Just say what you need done',
    points: ['Type or speak: “Add call mom tomorrow at 6, in Personal”', 'Ask what is pending and get a clear, prioritised answer', 'Deletes and bulk changes always ask you to confirm first'],
    visual: (
      <Window title="Assistant">
        <div className="space-y-3 text-sm">
          <p className="ml-auto flex w-fit max-w-[85%] items-center gap-2 rounded-2xl rounded-br-sm bg-violet-500/80 px-3.5 py-2"><Mic size={14} /> Add call mom tomorrow 6pm</p>
          <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-white/10 px-3.5 py-2">Done — added “Call mom” for tomorrow at 6 pm in Personal. You also have 2 overdue todos. Want to tackle those first?</p>
        </div>
      </Window>
    ),
  },
] as const

function Features() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('todos')
  const current = TABS.find((t) => t.id === tab)!
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24">
      <h2 className="mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight sm:text-5xl">Everything in one calm place</h2>
      <p className="mx-auto mt-4 max-w-xl text-center text-white/60">Todos, notes, rewards and an assistant, organised into workspaces you name yourself.</p>

      <div role="tablist" aria-label="Features" className={cn(glass, 'mx-auto mt-10 flex w-max max-w-full gap-1 overflow-x-auto rounded-full p-1')}>
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={t.id === tab} aria-controls="feature-panel" onClick={() => setTab(t.id)}
            className={cn('relative flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors', t.id === tab ? 'text-black' : 'text-white/70 hover:text-white')}>
            {t.id === tab && <motion.span layoutId="landing-tab" className="absolute inset-0 rounded-full bg-white" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
            <t.icon size={16} className="relative" aria-hidden /><span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <div id="feature-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className={cn(glass, 'mt-8 grid items-center gap-8 overflow-hidden rounded-3xl p-6 sm:p-10 md:grid-cols-2')}>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="contents">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">{current.title}</h3>
              <ul className="mt-6 space-y-3">
                {current.points.map((p) => (
                  <li key={p} className="flex gap-3 text-white/70"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-300"><Check size={12} strokeWidth={3} /></span>{p}</li>
                ))}
              </ul>
              <Link to={START} className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-transform hover:scale-105">Try it free <ArrowRight size={16} /></Link>
            </div>
            <div className="min-w-0">{current.visual}</div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}

const NUMBERS = [
  { icon: Lock, big: 'AES-256', text: 'Private workspaces are encrypted in your browser. Nobody else can read them, not even us.' },
  { icon: FolderKanban, big: 'Your names', text: 'Make as many workspaces as you like, for work, home, side projects, and name them yourself.' },
  { icon: Trophy, big: 'XP & streaks', text: 'Earn points, levels and coins for finishing things, then spend them on rewards you choose.' },
  { icon: WifiOff, big: 'Offline-ready', text: 'Install it on your phone or desktop. Add and complete todos without a connection; it syncs later.' },
]

function Numbers() {
  return (
    <section id="numbers" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {NUMBERS.map((n, i) => (
          <motion.div key={n.big} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ delay: i * 0.07 }} className={cn(glass, 'rounded-3xl p-6')}>
            <n.icon className="text-cyan-300" size={22} aria-hidden />
            <p className="mt-5 text-3xl font-semibold tracking-tight">{n.big}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{n.text}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section id="start" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 px-6 py-16 text-center sm:py-24">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-600/40 via-[#0b0b14] to-cyan-500/30" aria-hidden />
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">Start with a clear head</h2>
        <p className="mx-auto mt-4 max-w-md text-white/65">Free to start. Create an account in a few seconds and add your first todo.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to={START} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-medium text-black transition-transform hover:scale-105">Create your account <ArrowRight size={18} /></Link>
          <Link to="/login" className={cn(glass, 'rounded-full px-6 py-3 text-white/90 hover:bg-white/10')}>I already have one</Link>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const head = 'text-sm font-medium text-white'
  const a = 'block py-1 text-sm text-white/55 hover:text-white'
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-white/55">Todos, notes and rewards, with an assistant that helps you get through the list.</p>
        </div>
        <div><p className={head}>Product</p><a className={a} href="#features">Features</a><a className={a} href="#numbers">Why it’s different</a></div>
        <div><p className={head}>Account</p><Link className={a} to="/login">Sign in</Link><Link className={a} to={START}>Create account</Link></div>
        <div><p className={head}>Good to know</p><span className={a}>Works on phone and desktop</span><span className={a}>Installable app</span></div>
      </div>
      <p className="border-t border-white/10 py-5 text-center text-xs text-white/40">© {new Date().getFullYear()} Todo App</p>
    </footer>
  )
}

function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 pb-16 pt-32 text-center">
      <Backdrop />

      <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cn(glass, 'mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs text-white/70 sm:text-sm')}>
        <Sparkles size={14} className="text-cyan-300" aria-hidden /> Todos · Notes · Rewards · AI assistant
      </motion.p>
      <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.6 }} className="max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
        Get more done, and <span className="bg-gradient-to-r from-violet-300 via-white to-cyan-300 bg-clip-text text-transparent">enjoy doing it</span>
      </motion.h1>
      <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.6 }} className="mt-6 max-w-xl text-balance text-base text-white/65 sm:text-lg">
        One place for your todos and notes, split into workspaces you name yourself. Earn rewards for finishing, lock private things away, and just tell the assistant what to do.
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24, duration: 0.6 }} className="mt-9 flex flex-wrap justify-center gap-3">
        <Link to={START} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-medium text-black transition-transform hover:scale-105">Get started free <ArrowRight size={18} /></Link>
        <a href="#features" className={cn(glass, 'rounded-full px-6 py-3 text-white/90 hover:bg-white/10')}>See what’s inside</a>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.8 }} className="mt-16 w-full max-w-3xl">
        <Window title="Todo App · Personal" className="text-left">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-semibold">Today</p>
            <span className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs text-amber-300"><Trophy size={12} /> Level 4 · 12 day streak</span>
          </div>
          <TodoMock items={[{ t: 'Plan the week', tag: 'planning', due: 'Today' }, { t: 'Reply to Priya', due: '3 pm' }, { t: 'Finish the report', tag: 'work' }, { t: 'Morning run', done: true }]} />
        </Window>
      </motion.div>
    </section>
  )
}

export default function LandingPage() {
  return (
    // Always dark, whatever theme the app itself is using, and opaque so the app's own background layer stays hidden.
    <div data-theme="dark" className="relative isolate min-h-full bg-[#07070d] text-white">
      <Nav />
      <main>
        <Hero />
        <Features />
        <Numbers />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}
