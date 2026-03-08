'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Fragment } from 'react'
import {
  ArrowRight,
  Upload,
  Brain,
  Images,
  LayoutGrid,
  Wand2,
  Camera,
  ScanLine,
  Globe,
  Palette,
  Maximize,
  Layers,
  Search,
  Package,
  Award,
  ChevronRight,
  Zap,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

function parsePlatforms(value: string): string[] {
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

interface SectionTheme {
  accent: string
  accentLight: string
  accentMid: string
  accentBorder: string
  numBg: string
  numColor: string
  stepIcons: LucideIcon[]
  capIcons: LucideIcon[]
}

const SECTION_THEMES: SectionTheme[] = [
  {
    accent: '#3b82f6',
    accentLight: 'rgba(59, 130, 246, 0.06)',
    accentMid: 'rgba(59, 130, 246, 0.12)',
    accentBorder: 'rgba(59, 130, 246, 0.15)',
    numBg: 'bg-blue-50',
    numColor: 'text-blue-600',
    stepIcons: [Upload, Brain, Images],
    capIcons: [ScanLine, Globe, Palette],
  },
  {
    accent: '#f59e0b',
    accentLight: 'rgba(245, 158, 11, 0.06)',
    accentMid: 'rgba(245, 158, 11, 0.12)',
    accentBorder: 'rgba(245, 158, 11, 0.15)',
    numBg: 'bg-amber-50',
    numColor: 'text-amber-600',
    stepIcons: [Camera, LayoutGrid, Layers],
    capIcons: [Brain, Maximize, Zap],
  },
  {
    accent: '#8b5cf6',
    accentLight: 'rgba(139, 92, 246, 0.06)',
    accentMid: 'rgba(139, 92, 246, 0.12)',
    accentBorder: 'rgba(139, 92, 246, 0.15)',
    numBg: 'bg-violet-50',
    numColor: 'text-violet-600',
    stepIcons: [Upload, Wand2, Sparkles],
    capIcons: [Search, Package, Award],
  },
]

export function FeatureShowcase() {
  const t = useTranslations('landing')
  const locale = useLocale()
  const reduceMotion = useReducedMotion()

  const sections = [1, 2, 3].map((n) => ({
    title: t(`features.section${n}.title`),
    subtitle: t(`features.section${n}.subtitle`),
    caps: [
      { title: t(`features.section${n}.cap1`), desc: t(`features.section${n}.cap1Desc`) },
      { title: t(`features.section${n}.cap2`), desc: t(`features.section${n}.cap2Desc`) },
      { title: t(`features.section${n}.cap3`), desc: t(`features.section${n}.cap3Desc`) },
    ],
    steps: [
      t(`features.section${n}.step1`),
      t(`features.section${n}.step2`),
      t(`features.section${n}.step3`),
    ],
  }))

  const sectionMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
      }

  const platforms = parsePlatforms(t('bottomCta.platforms'))

  return (
    <section className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_46%,#ffffff_100%)] pb-[160px] pt-[124px]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[120px] px-5 sm:px-8">
        {sections.map((section, index) => {
          const theme = SECTION_THEMES[index]
          const imageFirst = index % 2 === 0
          const contentOrder = imageFirst ? 'lg:order-1' : 'lg:order-2'
          const visualOrder = imageFirst ? 'lg:order-2' : 'lg:order-1'

          return (
            <motion.div
              key={index}
              {...sectionMotion}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              {/* Content */}
              <div className={contentOrder}>
                <div className={`inline-flex items-center rounded-lg ${theme.numBg} px-3 py-1.5`}>
                  <span className={`text-sm font-bold ${theme.numColor}`}>0{index + 1}</span>
                </div>

                <h2 className="mt-5 text-[36px] font-semibold leading-[1.22] tracking-[-0.015em] text-[#0f172a] md:text-[44px]">
                  {section.title}
                </h2>

                <p className="mt-5 max-w-[520px] text-base leading-8 text-[#475569] sm:text-lg sm:leading-9">
                  {section.subtitle}
                </p>

                {/* Capabilities */}
                <div className="mt-8 space-y-5">
                  {section.caps.map((cap, capIndex) => {
                    const CapIcon = theme.capIcons[capIndex]
                    return (
                      <div key={capIndex} className="flex gap-4">
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ backgroundColor: theme.accentLight }}
                        >
                          <CapIcon className="h-4 w-4" style={{ color: theme.accent }} />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-[#0f172a]">{cap.title}</h4>
                          <p className="mt-1 text-sm leading-6 text-[#64748b]">{cap.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Visual — Workflow Steps */}
              <div className={visualOrder}>
                <div
                  className="rounded-[28px] border p-8 shadow-[0_22px_50px_rgba(15,23,42,0.06)] sm:p-10"
                  style={{
                    borderColor: theme.accentBorder,
                    background: `linear-gradient(135deg, white 0%, ${theme.accentLight} 100%)`,
                  }}
                >
                  <div className="flex flex-col items-center gap-5">
                    {section.steps.map((step, stepIndex) => {
                      const StepIcon = theme.stepIcons[stepIndex]
                      return (
                        <Fragment key={stepIndex}>
                          {stepIndex > 0 && (
                            <div className="flex flex-col items-center gap-1">
                              <div className="h-3 w-px" style={{ backgroundColor: theme.accentMid }} />
                              <ChevronRight
                                className="h-4 w-4 rotate-90"
                                style={{ color: theme.accent }}
                              />
                              <div className="h-3 w-px" style={{ backgroundColor: theme.accentMid }} />
                            </div>
                          )}
                          <motion.div
                            className="flex w-full items-center gap-4 rounded-2xl border bg-white/90 px-5 py-4 shadow-sm backdrop-blur"
                            style={{ borderColor: theme.accentBorder }}
                            initial={
                              reduceMotion
                                ? undefined
                                : { opacity: 0, x: index % 2 === 0 ? 20 : -20 }
                            }
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{
                              duration: 0.4,
                              delay: 0.15 + stepIndex * 0.12,
                              ease: 'easeOut',
                            }}
                          >
                            <div
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                              style={{ backgroundColor: theme.accentLight }}
                            >
                              <StepIcon className="h-5 w-5" style={{ color: theme.accent }} />
                            </div>
                            <div>
                              <span
                                className="text-[11px] font-semibold uppercase tracking-wider"
                                style={{ color: theme.accent }}
                              >
                                Step {stepIndex + 1}
                              </span>
                              <p className="text-sm font-medium text-[#1e293b]">{step}</p>
                            </div>
                          </motion.div>
                        </Fragment>
                      )
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )
        })}

        {/* Bottom CTA */}
        <motion.section
          {...sectionMotion}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="rounded-[32px] border border-[#dce3ee] bg-[linear-gradient(135deg,#ffffff_0%,#f7f9fc_60%,#eef2f8_100%)] px-6 py-10 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:px-12 sm:py-14"
        >
          <h2 className="text-[28px] font-semibold leading-[1.34] tracking-[-0.01em] text-[#0f172a] sm:text-[42px]">
            {t('bottomCta.title')}
          </h2>

          <Link
            href={`/${locale}/auth`}
            className="mx-auto mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[#0f172a] px-7 text-sm font-semibold text-white transition-all hover:bg-[#1e293b] hover:shadow-[0_12px_30px_rgba(15,23,42,0.2)] sm:h-[54px] sm:px-9 sm:text-base"
          >
            {t('bottomCta.button')}
            <ArrowRight className="h-4 w-4" />
          </Link>

          <p className="mx-auto mt-7 max-w-[920px] text-xs leading-7 text-[#64748b] sm:text-sm sm:leading-8">
            {platforms.join(' · ')}
          </p>
        </motion.section>
      </div>
    </section>
  )
}
