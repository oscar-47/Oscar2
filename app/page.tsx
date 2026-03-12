import { redirect } from 'next/navigation'
import { routing } from '@/i18n/routing'

// Send first-time visitors straight into the primary generation flow.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}/studio-genesis`)
}
