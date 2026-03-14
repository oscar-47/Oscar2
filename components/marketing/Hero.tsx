'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useRef } from 'react'
import { ArrowRight, Camera, LayoutGrid, Wand2 } from 'lucide-react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'
import { MARKETING_DARK_CTA_BASE } from './marketing-styles'

function parsePlatforms(value: string): string[] {
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

function rotateItems(items: string[], offset: number): string[] {
  if (items.length === 0) return items
  const safeOffset = ((offset % items.length) + items.length) % items.length
  return [...items.slice(safeOffset), ...items.slice(0, safeOffset)]
}

const FEATURE_ICONS = [Camera, LayoutGrid, Wand2] as const

const FEATURE_CARD_THEMES = [
  {
    // Electric blue — Hero image
    bg: 'bg-white/[0.45] backdrop-blur-xl',
    border: 'border-white/30',
    iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
    iconColor: 'text-white',
    glowColor: 'rgba(99,102,241,0.5)',
    glowSoft: 'rgba(99,102,241,0.06)',
    hoverBorder: 'group-hover:border-white/50',
    hoverShadow: 'group-hover:shadow-[0_0_0_1px_rgba(99,102,241,0.1),0_8px_40px_-12px_rgba(99,102,241,0.3),0_24px_60px_-24px_rgba(99,102,241,0.15)]',
    shine: 'from-white/50 via-white/10 to-transparent',
    dot: 'bg-blue-500',
    accentGradient: 'from-blue-500/20 via-indigo-500/10 to-transparent',
  },
  {
    // Teal — Detail pages
    bg: 'bg-white/[0.45] backdrop-blur-xl',
    border: 'border-white/30',
    iconBg: 'bg-gradient-to-br from-teal-500 to-emerald-600',
    iconColor: 'text-white',
    glowColor: 'rgba(20,184,166,0.5)',
    glowSoft: 'rgba(20,184,166,0.06)',
    hoverBorder: 'group-hover:border-white/50',
    hoverShadow: 'group-hover:shadow-[0_0_0_1px_rgba(20,184,166,0.1),0_8px_40px_-12px_rgba(20,184,166,0.3),0_24px_60px_-24px_rgba(20,184,166,0.15)]',
    shine: 'from-white/50 via-white/10 to-transparent',
    dot: 'bg-teal-500',
    accentGradient: 'from-teal-500/20 via-emerald-500/10 to-transparent',
  },
  {
    // Purple — Retouching
    bg: 'bg-white/[0.45] backdrop-blur-xl',
    border: 'border-white/30',
    iconBg: 'bg-gradient-to-br from-violet-500 to-purple-600',
    iconColor: 'text-white',
    glowColor: 'rgba(139,92,246,0.5)',
    glowSoft: 'rgba(139,92,246,0.06)',
    hoverBorder: 'group-hover:border-white/50',
    hoverShadow: 'group-hover:shadow-[0_0_0_1px_rgba(139,92,246,0.1),0_8px_40px_-12px_rgba(139,92,246,0.3),0_24px_60px_-24px_rgba(139,92,246,0.15)]',
    shine: 'from-white/50 via-white/10 to-transparent',
    dot: 'bg-violet-500',
    accentGradient: 'from-violet-500/20 via-purple-500/10 to-transparent',
  },
] as const

const SPRING_CONFIG = { stiffness: 300, damping: 30, mass: 0.8 }

function FeatureCard({
  icon: Icon,
  title,
  desc,
  theme,
  index,
  reduceMotion,
}: {
  icon: typeof Camera
  title: string
  desc: string
  theme: (typeof FEATURE_CARD_THEMES)[number]
  index: number
  reduceMotion: boolean | null
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const rotateX = useSpring(0, SPRING_CONFIG)
  const rotateY = useSpring(0, SPRING_CONFIG)
  const glowX = useMotionValue(50)
  const glowY = useMotionValue(50)

  function handlePointerMove(e: React.PointerEvent) {
    if (reduceMotion || !cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    rotateX.set((py - 0.5) * -6)
    rotateY.set((px - 0.5) * 8)
    glowX.set(px * 100)
    glowY.set(py * 100)
  }

  function handlePointerLeave() {
    rotateX.set(0)
    rotateY.set(0)
    glowX.set(50)
    glowY.set(50)
  }

  return (
    <motion.div
      ref={cardRef}
      initial={reduceMotion ? undefined : { opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 + index * 0.12, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: 'preserve-3d',
        transformPerspective: 800,
      }}
      className={`group relative overflow-hidden rounded-[1.75rem] border p-7 transition-all duration-500 ease-out sm:p-8 ${theme.bg} ${theme.border} ${theme.hoverBorder} ${theme.hoverShadow} shadow-[0_1px_3px_rgba(0,0,0,0.02),0_8px_24px_-8px_rgba(0,0,0,0.06)] hover:-translate-y-2`}
    >
      {/* Subtle accent gradient in corner */}
      <div className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br ${theme.accentGradient} blur-2xl transition-opacity duration-700 group-hover:opacity-100 opacity-60`} />

      {/* Animated glow that follows mouse */}
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: `radial-gradient(350px circle at ${glowX.get()}% ${glowY.get()}%, ${theme.glowSoft}, transparent 50%)`,
        }}
      />

      {/* Top edge shine — glass reflection */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${theme.shine}`} />

      {/* Corner glow orb */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-40"
        style={{ background: theme.glowColor }}
      />

      {/* Bottom edge glow */}
      <div
        className="pointer-events-none absolute inset-x-8 bottom-0 h-px opacity-0 transition-opacity duration-500 group-hover:opacity-50"
        style={{ background: `linear-gradient(90deg, transparent, ${theme.glowColor}, transparent)` }}
      />

      {/* Icon — bold gradient with glow */}
      <div className={`relative flex h-11 w-11 items-center justify-center rounded-[14px] ${theme.iconBg} ${theme.iconColor} shadow-lg ring-1 ring-white/20 transition-all duration-500 group-hover:scale-110 group-hover:shadow-xl`}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
        {/* Activity dot */}
        <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${theme.dot} opacity-0 shadow-[0_0_8px_currentColor] transition-all duration-500 group-hover:opacity-100 group-hover:animate-pulse`} />
      </div>

      {/* Text */}
      <h3 className="relative mt-5 text-[1.05rem] font-bold tracking-[-0.02em] text-foreground/90 transition-transform duration-300 group-hover:translate-x-0.5">
        {title}
      </h3>
      <p className="relative mt-2 text-[13px] leading-[1.7] text-muted-foreground/80">
        {desc}
      </p>

      {/* Glass highlight sweep on hover */}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(115deg,rgba(255,255,255,0.18),transparent_25%,transparent_75%,rgba(255,255,255,0.08))] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
    </motion.div>
  )
}

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

          {/* Feature cards */}
          <div className="mt-20 grid w-full max-w-[980px] grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
            {features.map((feature, index) => (
              <FeatureCard
                key={index}
                icon={FEATURE_ICONS[index]}
                title={feature.title}
                desc={feature.desc}
                theme={FEATURE_CARD_THEMES[index]}
                index={index}
                reduceMotion={reduceMotion}
              />
            ))}
          </div>

          <div className="mt-14 w-full max-w-[1060px]">
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
