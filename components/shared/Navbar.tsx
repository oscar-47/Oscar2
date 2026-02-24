'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Navbar() {
  const t = useTranslations('nav')
  const locale = useLocale()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href={`/${locale}`} className="flex items-center gap-2 font-bold text-lg">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background text-sm font-bold">P</span>
          <span>Picset AI</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <Link href={`/${locale}/studio-genesis`} className="text-muted-foreground hover:text-foreground transition-colors">
            {t('studioGenesis')}
          </Link>
          <Link href={`/${locale}/aesthetic-mirror`} className="text-muted-foreground hover:text-foreground transition-colors">
            {t('aestheticMirror')}
          </Link>
          <Link href={`/${locale}/clothing-studio`} className="text-muted-foreground hover:text-foreground transition-colors">
            {t('clothingStudio')}
          </Link>
          <Link href={`/${locale}/refinement-studio`} className="text-muted-foreground hover:text-foreground transition-colors">
            {t('refinementStudio')}
          </Link>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            href={`/${locale}/auth`}
            className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:bg-foreground/90 transition-colors"
          >
            {t('signIn')}
          </Link>
        </div>
      </div>
    </header>
  )
}
