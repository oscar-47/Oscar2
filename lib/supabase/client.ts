import { createBrowserClient } from '@supabase/ssr'

type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>

declare global {
  // Reuse the same browser client across re-renders and dev HMR to avoid auth lock contention.
  var __shopixSupabaseBrowserClient__: BrowserSupabaseClient | undefined
}

export function createClient() {
  if (!globalThis.__shopixSupabaseBrowserClient__) {
    globalThis.__shopixSupabaseBrowserClient__ = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim()
    )
  }

  return globalThis.__shopixSupabaseBrowserClient__
}
