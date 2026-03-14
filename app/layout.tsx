import type { Metadata } from 'next'
import './globals.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/600.css'
import '@fontsource/noto-sans-sc/700.css'
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import { getSiteUrl } from '@/lib/site'

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: 'Shopix AI',
  description: 'AI ecommerce product image generator and product photo editing suite.',
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  },
}

// Root layout — no locale-specific logic here.
// All pages live under app/[locale]/ which handles i18n.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
