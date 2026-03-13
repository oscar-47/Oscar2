import { DashboardNavbar } from '@/components/shared/DashboardNavbar'
import { FloatingSupportFeedbackButton } from '@/components/support/FloatingSupportFeedbackButton'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
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
    <div className="flex min-h-screen flex-col bg-surface">
      <DashboardNavbar userId={user.id} email={user.email ?? ''} />
      <main className="flex-1">
        {children}
      </main>
      <FloatingSupportFeedbackButton userId={user.id} />
    </div>
  )
}
