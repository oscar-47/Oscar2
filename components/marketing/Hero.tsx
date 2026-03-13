'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, Camera, LayoutGrid, Wand2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { MARKETING_DARK_CTA_BASE } from './marketing-styles'

function parsePlatforms(value: string): string[] {
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

function rotateItems(items: string[], offset: number): string[] {
  if (items.length === 0) {
    return items
  }

  const safeOffset = ((offset % items.length) + items.length) % items.length
  return [...items.slice(safeOffset), ...items.slice(0, safeOffset)]
}

const FEATURE_ICONS = [Camera, LayoutGrid, Wand2] as const
const FEATURE_CARD_STYLES = [
  {
    card:
      'border-[#ead9cb]/92 bg-[linear-gradient(180deg,rgba(255,250,244,0.92),rgba(248,239,229,0.82))] shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_18px_40px_-24px_rgba(117,94,70,0.28),0_34px_72px_-42px_rgba(17,24,39,0.22),0_0_0_1px_rgba(255,255,255,0.26)]',
    iconWrap: 'border-white/80 bg-white/78',
  },
  {
    card:
      'border-[#dbe5d9]/92 bg-[linear-gradient(180deg,rgba(247,252,246,0.92),rgba(236,244,237,0.82))] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_18px_40px_-24px_rgba(79,111,89,0.24),0_34px_72px_-42px_rgba(17,24,39,0.22),0_0_0_1px_rgba(255,255,255,0.24)]',
    iconWrap: 'border-white/80 bg-white/76',
  },
  {
    card:
      'border-[#dfd9e8]/92 bg-[linear-gradient(180deg,rgba(250,247,255,0.92),rgba(240,234,248,0.82))] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_18px_40px_-24px_rgba(92,86,120,0.24),0_34px_72px_-42px_rgba(17,24,39,0.22),0_0_0_1px_rgba(255,255,255,0.24)]',
    iconWrap: 'border-white/80 bg-white/76',
  },
] as const

export function Hero() {
  const t = useTranslations('landing.hero')
  const locale = useLocale()
  const reduceMotion = useReducedMotion()
  const platforms = parsePlatforms(t('platforms'))
  const platformRows = [
    platforms,
    rotateItems(platforms, Math.max(1, Math.floor(platforms.length / 3))),
  ]

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
  const ecomAuthHref = `/${locale}/auth?returnTo=${encodeURIComponent(`/${locale}/ecom-studio`)}`

  return (
    <section className="relative flex min-h-[calc(100vh-64px)] items-center overflow-hidden bg-[#faf9f7] pb-20 pt-24 sm:pb-28 sm:pt-32">
      {/* Ambient blurs */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_28%_18%,rgba(251,191,146,0.14),transparent),radial-gradient(ellipse_50%_45%_at_72%_28%,rgba(167,215,198,0.11),transparent),radial-gradient(ellipse_45%_40%_at_50%_82%,rgba(196,181,219,0.09),transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/8 to-transparent" />

      <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex flex-col items-center text-center"
        >
          <h1 className="max-w-[1100px] font-[var(--font-display)] text-[clamp(2.75rem,7vw,5.5rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-foreground">
            {t('title')}
          </h1>

          <p className="mt-7 max-w-[580px] text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9">
            {t('subtitle')}
          </p>

          <Link
            href={ecomAuthHref}
            className="mt-10 inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-8 text-sm font-semibold text-accent-foreground transition-all press-scale hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-13 sm:px-10 sm:text-base"
          >
            {t('cta')}
            <ArrowRight className="h-4 w-4" />
          </Link>

          {/* Feature cards — below the fold, supporting content */}
          <div className="mt-24 grid w-full max-w-[920px] grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
            {features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index]
              const tint = FEATURE_CARD_STYLES[index]
              return (
                <motion.div
                  key={index}
                  initial={reduceMotion ? undefined : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 + index * 0.1, ease: 'easeOut' }}
                  className={`group relative overflow-hidden rounded-[1.65rem] border p-6 backdrop-blur-[5px] transition-all duration-300 hover:-translate-y-1.5 hover:border-white/95 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_64px_-26px_rgba(84,97,118,0.3),0_0_0_1px_rgba(255,255,255,0.18)] ${tint.card} sm:p-7`}
                >
                  <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.42),transparent_48%),linear-gradient(180deg,rgba(255,255,255,0.1),transparent_55%)] opacity-80 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/70 blur-[0.4px]" />
                  <div
                    className={`relative flex h-11 w-11 items-center justify-center rounded-[0.95rem] border text-[#283244] shadow-[0_14px_22px_-18px_rgba(16,24,39,0.24)] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:bg-white/92 group-hover:shadow-[0_18px_30px_-18px_rgba(16,24,39,0.3)] ${tint.iconWrap}`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.9} />
                  </div>
                  <h3 className="relative mt-5 text-[17px] font-bold tracking-[-0.02em] text-foreground">
                    {feature.title}
                  </h3>
                  <p className="relative mt-2 text-sm leading-6 text-muted-foreground">{feature.desc}</p>
                </motion.div>
              )
            })}
          </div>

          <div className="mt-10 w-full max-w-[1060px]">
            <div className="relative overflow-hidden rounded-[2rem] border border-[#e4dfd5] bg-[#f6f3ed] px-3 py-3 shadow-[0_1px_2px_rgba(16,24,39,0.03),0_22px_48px_-34px_rgba(16,24,39,0.16)] sm:px-5 sm:py-5">
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-[#f6f3ed] to-transparent sm:w-20" />
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-[#f6f3ed] to-transparent sm:w-20" />
              <div className="space-y-3 sm:space-y-4">
                {platformRows.map((row, rowIndex) => (
                  <div key={rowIndex} className="overflow-hidden">
                    <div
                      className="flex w-max gap-2.5"
                      style={{
                        animation: reduceMotion
                          ? undefined
                          : rowIndex === 0
                            ? 'platform-marquee 34s linear infinite'
                            : 'platform-marquee 40s linear infinite',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {(reduceMotion ? row : [...row, ...row, ...row]).map((platform, platformIndex) => (
                        <span
                          key={`${rowIndex}-${platformIndex}-${platform}`}
                          className="inline-flex h-9 shrink-0 items-center rounded-full border border-[#d9d6cf] bg-[#fffdf9] px-4 text-[13px] font-semibold text-[#4a5463] shadow-[0_1px_2px_rgba(16,24,39,0.03)] sm:h-10 sm:px-5 sm:text-[14px]"
                        >
                          {platform}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-6 text-center text-sm font-semibold tracking-[0.01em] text-[#687180] sm:text-base">
              {t('platformHint')}
            </p>

            <div className="mt-6 flex justify-center">
              <Link
                href={`/${locale}/auth`}
                className={`${MARKETING_DARK_CTA_BASE} h-[52px] px-9 text-[15px] font-semibold sm:h-14 sm:px-10 sm:text-base`}
              >
                {t('cta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
