import type { Metadata } from 'next'
import './globals.css'
import { Plus_Jakarta_Sans, Noto_Sans_SC } from 'next/font/google'
import { getSiteUrl } from '@/lib/site'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-display',
})

const notoSansSc = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  fallback: ['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
})

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
      <body className={`${notoSansSc.className} ${plusJakarta.variable}`}>{children}</body>
    </html>
  )
}
