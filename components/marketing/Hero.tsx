'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, ImagePlus, Zap, Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

function parsePlatforms(value: string): string[] {
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

const FEATURE_ICONS = [ImagePlus, Zap, Sparkles] as const

export function Hero() {
  const t = useTranslations('landing.hero')
  const locale = useLocale()
  const reduceMotion = useReducedMotion()
  const platforms = parsePlatforms(t('platforms'))

  const fadeUp = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        animate: { opacity: 1, y: 0 },
      }

  const features = [
    { title: t('feature1Title'), desc: t('feature1Desc') },
    { title: t('feature2Title'), desc: t('feature2Desc') },
    { title: t('feature3Title'), desc: t('feature3Desc') },
  ]

  return (
    <section className="relative flex min-h-[calc(100vh-64px)] items-center overflow-hidden bg-background pb-20 pt-24 sm:pb-28 sm:pt-32">
      <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex flex-col items-center text-center"
        >
          {/* Headline — the focal point */}
          <h1 className="max-w-[1100px] font-[var(--font-display)] text-[clamp(2.75rem,7vw,5.5rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-foreground">
            {t('title')}
          </h1>

          <p className="mt-7 max-w-[580px] text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9">
            {t('subtitle')}
          </p>

          <Link
            href={`/${locale}/auth`}
            className="mt-10 inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-8 text-sm font-semibold text-accent-foreground transition-all press-scale hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-13 sm:px-10 sm:text-base"
          >
            {t('cta')}
            <ArrowRight className="h-4 w-4" />
          </Link>

          {/* Feature cards — below the fold, supporting content */}
          <div className="mt-24 grid w-full max-w-[920px] grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
            {features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index]
              return (
                <motion.div
                  key={index}
                  initial={reduceMotion ? undefined : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 + index * 0.08, ease: 'easeOut' }}
                  className="bg-background p-6 sm:p-7"
                >
                  <Icon className="h-5 w-5 text-accent" />
                  <h3 className="mt-3 text-[15px] font-bold text-foreground">{feature.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{feature.desc}</p>
                </motion.div>
              )
            })}
          </div>

          {/* Platform coverage — marquee */}
          <div className="relative mt-8 w-full max-w-[920px] overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-background to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-background to-transparent z-10" />
            <div
              className="flex gap-6 text-xs text-text-tertiary sm:text-sm"
              style={{
                animation: reduceMotion ? undefined : 'marquee 28s linear infinite',
                whiteSpace: 'nowrap',
              }}
            >
              {[...platforms, ...platforms].map((p, i) => (
                <span key={i} className="shrink-0">
                  {p}
                  {i !== platforms.length * 2 - 1 && (
                    <span className="mx-3 opacity-30">·</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
