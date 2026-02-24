import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PicSet AI — Professional E-Commerce Product Images',
  description:
    'Generate professional e-commerce product images with AI. Studio Genesis, Aesthetic Mirror, Clothing Studio, and Refinement Studio.',
}

// Root layout — no locale-specific logic here.
// All pages live under app/[locale]/ which handles i18n.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
