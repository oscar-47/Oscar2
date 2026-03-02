'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

const MODULE_MEDIA = [
  {
    before: '/landing-v2/smart-before.svg',
    after: '/landing-v2/smart-after.svg',
  },
  {
    before: '/landing-v2/batch-before.svg',
    after: '/landing-v2/batch-after.svg',
  },
  {
    before: '/landing-v2/detail-before.svg',
    after: '/landing-v2/detail-after.svg',
  },
] as const

function parsePlatforms(value: string): string[] {
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function FeatureShowcase() {
  const t = useTranslations('landing')
  const locale = useLocale()
  const reduceMotion = useReducedMotion()

  const modules = [
    {
      id: 'smart',
      title: t('modules.smart.title'),
      desc: t('modules.smart.desc'),
    },
    {
      id: 'batch',
      title: t('modules.batch.title'),
      desc: t('modules.batch.desc'),
    },
    {
      id: 'detail',
      title: t('modules.detail.title'),
      desc: t('modules.detail.desc'),
    },
  ] as const

  const sectionMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
      }

  const platforms = parsePlatforms(t('bottomCta.platforms'))

  return (
    <section className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_46%,#ffffff_100%)] pb-[160px] pt-[124px]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[132px] px-5 sm:px-8">
        {modules.map((module, index) => {
          const media = MODULE_MEDIA[index]
          const imageFirst = index % 2 === 0
          const contentClass = imageFirst ? 'lg:order-2' : 'lg:order-1'
          const visualClass = imageFirst ? 'lg:order-1' : 'lg:order-2'

          return (
            <motion.section
              key={module.id}
              {...sectionMotion}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              <div className={visualClass}>
                <article className="rounded-[28px] border border-[#dce3ee] bg-white/80 p-5 shadow-[0_22px_50px_rgba(15,23,42,0.09)] backdrop-blur">
                  <div className="relative grid gap-3 sm:grid-cols-2">
                    <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-2">
                      <span className="absolute left-3 top-3 rounded-full border border-[#e2e8f0] bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-[#475569]">
                        {t('modules.before')}
                      </span>
                      <img src={media.before} alt={`${module.title} before`} className="h-full w-full rounded-xl object-cover" loading="lazy" />
                    </div>
                    <div className="relative overflow-hidden rounded-2xl border border-[#d6dde9] bg-[#f8fafc] p-2">
                      <span className="absolute left-3 top-3 rounded-full border border-[#d2b37e] bg-[#fff8eb] px-2.5 py-1 text-[11px] font-semibold text-[#8a6a31]">
                        {t('modules.after')}
                      </span>
                      <img src={media.after} alt={`${module.title} after`} className="h-full w-full rounded-xl object-cover" loading="lazy" />
                    </div>
                    <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#d2dae8] bg-white/95 px-3 py-1 text-xs font-semibold text-[#1e293b] shadow-[0_8px_20px_rgba(15,23,42,0.12)] sm:block">
                      {t('modules.compareArrow')}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-medium text-[#64748b]">
                      {t('modules.smallBefore')}
                    </div>
                    <div className="rounded-xl border border-[#ead8b6] bg-[#fffaf0] px-3 py-2 text-xs font-medium text-[#8a6a31]">
                      {t('modules.smallAfter')}
                    </div>
                  </div>
                </article>
              </div>

              <div className={contentClass}>
                <h2 className="text-[36px] font-semibold leading-[1.22] tracking-[-0.015em] text-[#0f172a] md:text-[42px]">
                  {module.title}
                </h2>
                <p className="mt-6 max-w-[560px] text-base leading-8 text-[#334155] sm:text-lg sm:leading-9">{module.desc}</p>
              </div>
            </motion.section>
          )
        })}

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
