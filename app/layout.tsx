import type { Metadata } from 'next'
import './globals.css'
import { Noto_Sans_SC } from 'next/font/google'

const notoSansSc = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  fallback: ['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'Shopix AI — Professional E-Commerce Product Images',
  description:
    'Generate professional e-commerce product images with AI. Hero Image Generator, Aesthetic Mirror, Clothing Studio, and Refinement Studio.',
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
      <body className={notoSansSc.className}>{children}</body>
    </html>
  )
}
