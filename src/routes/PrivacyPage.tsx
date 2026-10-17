import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

const h = 'mt-8 text-lg font-semibold'

export default function PrivacyPage() {
  return (
    <div data-theme="dark" className="min-h-full overflow-auto bg-[#07070d] px-4 py-10 text-white/85">
      <main className="mx-auto max-w-2xl leading-relaxed">
        <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white"><ArrowLeft size={16} aria-hidden /> Back</Link>
        <h1 className="text-3xl font-semibold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: 17 October 2026</p>

        <h2 className={h}>What Todo App is</h2>
        <p className="mt-2">Todo App is a personal task and notes app. This page explains what we collect and how it is used.</p>

        <h2 className={h}>What we collect</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Your email address, and your name and profile picture if you sign in with Google. We receive nothing else from your Google account.</li>
          <li>The todos, notes, workspaces and settings you create.</li>
        </ul>

        <h2 className={h}>How it is used</h2>
        <p className="mt-2">Only to sign you in and to run the app for you. We do not sell your data, show ads, or share it for marketing.</p>

        <h2 className={h}>Where it is stored</h2>
        <p className="mt-2">Your data is stored with our database and authentication provider, Supabase. Private workspaces are encrypted on your device before they are stored, so we cannot read them.</p>

        <h2 className={h}>AI assistant and voice</h2>
        <p className="mt-2">If you use the assistant or voice input, the text or audio you send is passed to the AI or speech service that handles the request. Private workspaces are not sent unless you unlock them and choose to use them.</p>

        <h2 className={h}>Your choices</h2>
        <p className="mt-2">You can edit or delete your data inside the app at any time. To delete your account and everything in it, contact us at the address below.</p>

        <h2 className={h}>Contact</h2>
        <p className="mt-2">Questions or deletion requests: <a className="underline" href="mailto:iwinalways06@gmail.com">iwinalways06@gmail.com</a>.</p>
      </main>
    </div>
  )
}
