import { redirect } from 'next/navigation'
import { routing } from '@/i18n/routing'

// Server-side redirect: ensures `/` always goes to `/{defaultLocale}`
// even if middleware doesn't match the bare root path.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}`)
}
