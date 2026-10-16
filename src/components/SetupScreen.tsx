export function SetupScreen() {
  return (
    <main className="grid min-h-full place-items-center p-4">
      <div className="glass max-w-lg rounded-2xl p-8">
        <h1 className="gradient-text text-2xl font-bold">Connect Supabase</h1>
        <p className="mt-3 text-muted">
          Create a project at supabase.com, copy <code>.env.example</code> to <code>.env.local</code>, fill in the
          URL and anon key, run the SQL in <code>supabase/migrations</code>, then restart <code>npm run dev</code>.
        </p>
      </div>
    </main>
  )
}
