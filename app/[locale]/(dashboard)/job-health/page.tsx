import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/types'
import JobHealthDashboard from '@/components/admin/JobHealthDashboard'

export default async function JobHealthPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (!user) redirect(`/${locale}/auth`)
  if (!isAdminUser(user.email)) redirect(`/${locale}/ecom-studio`)

  return <JobHealthDashboard locale={locale} />
}
