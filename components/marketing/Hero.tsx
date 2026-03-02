'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

function parsePlatforms(value: string): string[] {
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitRows(items: string[]): string[][] {
  const midpoint = Math.ceil(items.length / 2)
  return [items.slice(0, midpoint), items.slice(midpoint)].filter((row) => row.length > 0)
}

function repeatItems(items: string[], copies: number): string[] {
  return Array.from({ length: copies }, () => items).flat()
}

export function Hero() {
  const t = useTranslations('landing.hero')
  const locale = useLocale()
  const reduceMotion = useReducedMotion()
  const platforms = parsePlatforms(t('platforms'))
  const rows = splitRows(platforms)

  const fadeUp = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
      }

  return (
    <section className="relative flex min-h-[calc(100vh-82px)] items-center overflow-hidden bg-white pb-16 pt-20 sm:pb-20 sm:pt-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(15,23,42,0.08),_transparent_55%),linear-gradient(180deg,#ffffff_0%,#f7f8fa_64%,#fdfdfd_100%)]" />

      <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="mx-auto flex max-w-[980px] flex-col items-center text-center"
        >
          <span className="inline-flex items-center rounded-full border border-[#d4d9e2] bg-white/80 px-4 py-1.5 text-xs font-semibold tracking-[0.18em] text-[#0f172a] backdrop-blur">
            {t('badge')}
          </span>

          <h1 className="mt-8 text-[38px] font-semibold leading-[1.16] tracking-[-0.02em] text-[#0f172a] sm:text-[56px] lg:text-[72px]">
            {t('title')}
          </h1>

          <p className="mt-6 max-w-[920px] text-base leading-8 text-[#334155] sm:text-[21px] sm:leading-9">
            {t('subtitle')}
          </p>

          <div className="relative mt-10 w-full max-w-[1100px] overflow-hidden rounded-[30px] border border-[#d9e1ee] bg-white/55 px-4 py-4 shadow-[0_20px_56px_rgba(15,23,42,0.1)] backdrop-blur-2xl sm:px-6 sm:py-5">
            <motion.span
              aria-hidden
              className="pointer-events-none absolute -left-16 top-2 h-24 w-56 rounded-full bg-[radial-gradient(circle,_rgba(201,169,110,0.34)_0%,_rgba(201,169,110,0)_72%)] blur-2xl"
              animate={reduceMotion ? undefined : { x: [0, 24, 0], y: [0, 9, 0], scale: [1, 1.08, 1] }}
              transition={{ duration: 10, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
            />
            <motion.span
              aria-hidden
              className="pointer-events-none absolute right-0 top-8 h-24 w-64 rounded-full bg-[radial-gradient(circle,_rgba(15,23,42,0.24)_0%,_rgba(15,23,42,0)_75%)] blur-2xl"
              animate={reduceMotion ? undefined : { x: [0, -20, 0], y: [0, -10, 0], scale: [1, 1.12, 1] }}
              transition={{ duration: 12, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
            />
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent"
              animate={reduceMotion ? undefined : { x: ['0%', '420%'] }}
              transition={{ duration: 7.5, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
            />

            <div className="relative space-y-3">
              {rows.map((row, rowIndex) => (
                <div key={`platform-row-${rowIndex}`} className="overflow-hidden">
                  <motion.div
                    className="flex w-max items-center gap-2.5 sm:gap-3.5"
                    animate={reduceMotion ? undefined : { x: ['0%', '-33.333%'] }}
                    transition={{
                      duration: rowIndex === 0 ? 24 : 31,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: 'linear',
                    }}
                  >
                    {repeatItems(row, 3).map((platform, index) => (
                      <span
                        key={`${platform}-${rowIndex}-${index}`}
                        className="rounded-full border border-[#dce1ea] bg-white/88 px-3.5 py-1.5 text-xs font-medium text-[#1e293b] shadow-[0_8px_18px_rgba(15,23,42,0.08)] sm:text-sm"
                      >
                        {platform}
                      </span>
                    ))}
                  </motion.div>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-5 text-sm font-medium text-[#475569] sm:text-base">{t('platformHint')}</p>

          <Link
            href={`/${locale}/auth`}
            className="mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-[#0f172a] px-7 text-sm font-semibold text-white transition-all hover:bg-[#1e293b] hover:shadow-[0_12px_30px_rgba(15,23,42,0.2)] sm:h-[54px] sm:px-9 sm:text-base"
          >
            {t('cta')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
