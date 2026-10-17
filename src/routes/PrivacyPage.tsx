import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

const h = 'mt-8 text-lg font-semibold'

export default function PrivacyPage() {
  return (
    <div data-theme="dark" className="min-h-full overflow-auto bg-[#07070d] px-4 py-10 text-white/85">
      <main className="mx-auto max-w-2xl leading-relaxed">
        <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white"><ArrowLeft size={16} aria-hidden /> Back</Link>
        <h1 className="text-3xl font-semibold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: 18 October 2026</p>

        <h2 className={h}>About this policy</h2>
        <p className="mt-2">Todo App (https://todo-app-ten-puce-19.vercel.app) is a personal task and notes app. This policy explains what information we collect, how we use it, who we share it with, and the choices you have.</p>

        <h2 className={h}>Information we collect</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Account information:</strong> your email address, and a password if you sign up with email. Passwords are handled by our authentication provider and are never visible to us.</li>
          <li><strong>Google account data:</strong> if you choose &ldquo;Continue with Google&rdquo;, we receive your email address, name and profile picture through Google Sign-In. We request no other access to your Google account, and we do not read your Gmail, Drive, Calendar, Contacts or any other Google data.</li>
          <li><strong>Content you create:</strong> todos, subtasks, notes, workspaces, tags, reminders and app settings.</li>
          <li><strong>Technical information:</strong> basic error reports and device or browser details used to keep the app working.</li>
        </ul>

        <h2 className={h}>How we use information</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>To create your account, sign you in and keep you signed in.</li>
          <li>To store and show your todos and notes, and to send reminders you set.</li>
          <li>To fix bugs and keep the service secure.</li>
        </ul>
        <p className="mt-2">We do not sell your data, use it for advertising, or use it to build profiles. Information received from Google is used only to sign you in and identify your account in the app.</p>

        <h2 className={h}>Google user data</h2>
        <p className="mt-2">Todo App&rsquo;s use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements. We do not transfer Google user data to others except as needed to run the app, to comply with law, or with your consent. We do not use it for advertising, and no humans read it unless you ask us to, it is needed for security, or the law requires it.</p>

        <h2 className={h}>Who we share information with</h2>
        <p className="mt-2">We share data only with service providers that run the app for us, under their own privacy terms:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Supabase:</strong> database and sign-in.</li>
          <li><strong>Vercel:</strong> hosting.</li>
          <li><strong>Google:</strong> sign-in, if you choose it.</li>
          <li><strong>AI and speech services:</strong> only when you use the assistant or voice input. The text or audio you send is passed to the service that handles the request. Private workspaces are not sent unless you unlock them and choose to use them.</li>
        </ul>

        <h2 className={h}>Security</h2>
        <p className="mt-2">Data is sent over encrypted connections (HTTPS). Private workspaces are encrypted on your device before they are stored, so we cannot read them. No system is perfectly secure, but we work to protect your information.</p>

        <h2 className={h}>Retention and deletion</h2>
        <p className="mt-2">We keep your data while your account is active. You can edit or delete your todos and notes in the app at any time. To delete your account and all associated data, email us at the address below and we will remove it within 30 days.</p>

        <h2 className={h}>Your rights</h2>
        <p className="mt-2">You can ask to access, correct, export or delete your information. You can also revoke Todo App&rsquo;s access to your Google account at any time at myaccount.google.com/permissions.</p>

        <h2 className={h}>Children</h2>
        <p className="mt-2">Todo App is not directed to children under 13, and we do not knowingly collect their information.</p>

        <h2 className={h}>Changes to this policy</h2>
        <p className="mt-2">If we change this policy, we will update the date at the top of this page.</p>

        <h2 className={h}>Contact</h2>
        <p className="mt-2">Questions, access or deletion requests: <a className="underline" href="mailto:iwinalways06@gmail.com">iwinalways06@gmail.com</a>.</p>
      </main>
    </div>
  )
}
