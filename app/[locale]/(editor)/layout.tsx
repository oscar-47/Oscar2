import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function EditorLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (!user) {
    redirect(`/${locale}/auth`)
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      {children}
    </div>
  )
}
