'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, ImageIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import Image from 'next/image'
import type { CSSProperties } from 'react'

function parsePlatforms(value: string): string[] {
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

type SectionImagePair = {
  before: string | null
  after: string | null
  aspectRatio: string
  objectFit?: 'cover' | 'contain'
  beforeObjectFit?: 'cover' | 'contain'
  afterObjectFit?: 'cover' | 'contain'
  frameClassName?: string
  beforeFrameClassName?: string
  afterFrameClassName?: string
  imageClassName?: string
  beforeImageClassName?: string
  afterImageClassName?: string
  imageStyle?: CSSProperties
  beforeImageStyle?: CSSProperties
  afterImageStyle?: CSSProperties
}

/**
 * Before/After image pairs for feature sections.
 * Sections without images use `null`.
 * Images go in public/images/showcase/
 */
const FEATURE_SECTION_IDS = [1, 2, 5] as const

const SECTION_IMAGES: Record<(typeof FEATURE_SECTION_IDS)[number], SectionImagePair | null> = {
  1: {
    before: '/images/showcase/hero-left.png',
    after: '/images/showcase/hero-right.png',
    aspectRatio: '3 / 4',
    objectFit: 'cover',
  },
  2: {
    before: '/images/showcase/detail-before.jpg',
    after: '/images/showcase/detail-right.png',
    aspectRatio: '9 / 16',
    objectFit: 'contain',
    beforeFrameClassName: 'bg-white',
    afterFrameClassName: 'bg-[#e8e0d5]',
    beforeImageClassName: 'p-3 sm:p-4',
    afterImageClassName: 'p-0',
  },
  5: {
    before: '/images/showcase/refinement-lipstick-before.jpg',
    after: '/images/showcase/refinement-lipstick-after.png',
    aspectRatio: '3 / 4',
    objectFit: 'contain',
    beforeFrameClassName: 'bg-[#ddd2c5]',
    afterFrameClassName: 'bg-[#ececec]',
    beforeImageClassName: 'p-3 sm:p-4',
    afterImageStyle: {
      transform: 'translateX(-9%) rotate(180deg) scale(1.7)',
      transformOrigin: 'center center',
    },
  },
}

function ImageSlot({
  src,
  alt,
  label,
  objectFit = 'cover',
  imageClassName,
  imageStyle,
}: {
  src: string | null
  alt: string
  label: string
  objectFit?: 'cover' | 'contain'
  imageClassName?: string
  imageStyle?: CSSProperties
}) {
  if (src) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        style={imageStyle}
        className={[
          objectFit === 'contain' ? 'object-contain' : 'object-cover',
          'transition-transform duration-500 group-hover:scale-[1.02]',
          imageClassName ?? '',
        ]
          .join(' ')
          .trim()}
      />
    )
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/40">
      <ImageIcon className="h-10 w-10 sm:h-12 sm:w-12" strokeWidth={1} />
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
    </div>
  )
}

export function FeatureShowcase() {
  const t = useTranslations('landing')
  const tc = useTranslations('landing.showcase')
  const locale = useLocale()
  const reduceMotion = useReducedMotion()
  const ecomAuthHref = `/${locale}/auth?returnTo=${encodeURIComponent(`/${locale}/ecom-studio`)}`

  const sections = FEATURE_SECTION_IDS.map((n) => ({
    title: t(`features.section${n}.title`),
    subtitle: t(`features.section${n}.subtitle`),
    caps: [
      { title: t(`features.section${n}.cap1`), desc: t(`features.section${n}.cap1Desc`) },
      { title: t(`features.section${n}.cap2`), desc: t(`features.section${n}.cap2Desc`) },
      { title: t(`features.section${n}.cap3`), desc: t(`features.section${n}.cap3Desc`) },
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
    <section className="bg-white pb-32 pt-24 sm:pb-40 sm:pt-32">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-28 px-5 sm:gap-36 sm:px-8">
        {sections.map((section, index) => {
          const sectionId = FEATURE_SECTION_IDS[index]
          const images = SECTION_IMAGES[sectionId]
          const hasImages = images && (images.before || images.after)
          const hasComparison = images ? Boolean(images.before && images.after) : false

          return (
            <motion.div
              key={index}
              {...sectionMotion}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.55, ease: [0.25, 1, 0.5, 1] }}
              className="space-y-12"
            >
              {/* Section header */}
              <div className="mx-auto max-w-4xl text-center">
                <span className="inline-flex items-center rounded-full border border-border/60 bg-white px-4 py-1.5 text-sm font-semibold text-muted-foreground shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  0{index + 1}
                </span>

                <h2 className="mt-6 font-[var(--font-display)] text-[clamp(2rem,4.2vw,3.8rem)] font-extrabold leading-[1.1] tracking-[-0.035em] text-foreground">
                  {section.title}
                </h2>

                <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9">
                  {section.subtitle}
                </p>

                {/* Capability cards */}
                <div className="mt-10 grid gap-3 text-left md:grid-cols-3">
                  {section.caps.map((cap, capIndex) => (
                    <div
                      key={capIndex}
                      className="rounded-2xl border border-border/50 bg-[#faf9f7] px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                    >
                      <h4 className="text-sm font-semibold text-foreground">{cap.title}</h4>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{cap.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Before/After comparison (only for sections with images) */}
              {hasImages && images && (
                <div className="mx-auto w-full max-w-[1080px]">
                  <div className="group overflow-hidden rounded-[28px] border border-border/50 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_20px_50px_-28px_rgba(0,0,0,0.1)]">
                    {hasComparison ? (
                      <>
                        <div className="relative grid grid-cols-2">
                          <div
                            className={`relative overflow-hidden bg-secondary ${images.frameClassName ?? ''} ${images.beforeFrameClassName ?? ''}`}
                            style={{ aspectRatio: images.aspectRatio }}
                          >
                            <ImageSlot
                              src={images.before}
                              alt={tc('beforeAlt', { index: index + 1 })}
                              label={tc('beforeLabel')}
                              objectFit={images.beforeObjectFit ?? images.objectFit}
                              imageClassName={
                                images.beforeImageClassName ?? images.imageClassName
                              }
                              imageStyle={images.beforeImageStyle ?? images.imageStyle}
                            />
                          </div>

                          <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 flex -translate-x-1/2 items-center">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white shadow-lg">
                              <ArrowRight className="h-4 w-4 text-foreground/60" />
                            </div>
                          </div>

                          <div
                            className={`relative overflow-hidden border-l border-border bg-secondary ${images.frameClassName ?? ''} ${images.afterFrameClassName ?? ''}`}
                            style={{ aspectRatio: images.aspectRatio }}
                          >
                            <ImageSlot
                              src={images.after}
                              alt={tc('afterAlt', { index: index + 1 })}
                              label={tc('afterLabel')}
                              objectFit={images.afterObjectFit ?? images.objectFit}
                              imageClassName={
                                images.afterImageClassName ?? images.imageClassName
                              }
                              imageStyle={images.afterImageStyle ?? images.imageStyle}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 border-t border-border text-center">
                          <div className="py-3">
                            <span className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                              {tc('beforeLabel')}
                            </span>
                          </div>
                          <div className="border-l border-border py-3">
                            <span className="text-[12px] font-semibold uppercase tracking-wider text-foreground">
                              {tc('afterLabel')}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div
                        className={`relative overflow-hidden bg-secondary ${images.frameClassName ?? ''} ${images.beforeFrameClassName ?? images.afterFrameClassName ?? ''}`}
                        style={{ aspectRatio: images.aspectRatio }}
                      >
                        <ImageSlot
                          src={images.before ?? images.after}
                          alt={
                            images.before
                              ? tc('beforeAlt', { index: index + 1 })
                              : tc('afterAlt', { index: index + 1 })
                          }
                          label={tc('afterLabel')}
                          objectFit={
                            images.beforeObjectFit ??
                            images.afterObjectFit ??
                            images.objectFit
                          }
                          imageClassName={
                            images.beforeImageClassName ??
                            images.afterImageClassName ??
                            images.imageClassName
                          }
                          imageStyle={
                            images.beforeImageStyle ??
                            images.afterImageStyle ??
                            images.imageStyle
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )
        })}

        {/* Bottom CTA */}
        <motion.section
          {...sectionMotion}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="rounded-2xl border border-border/50 bg-[#faf9f7] px-6 py-10 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:px-12 sm:py-14"
        >
          <h2 className="text-[28px] font-semibold leading-[1.34] tracking-[-0.01em] text-foreground sm:text-[40px]">
            {t('bottomCta.title')}
          </h2>

          <Link
            href={ecomAuthHref}
            className="mx-auto mt-8 inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-7 text-sm font-semibold text-accent-foreground transition-all press-scale hover:opacity-90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-[54px] sm:px-9 sm:text-base"
          >
            {t('bottomCta.button')}
            <ArrowRight className="h-4 w-4" />
          </Link>

          <p className="mx-auto mt-7 max-w-[920px] text-xs leading-7 text-text-tertiary sm:text-sm sm:leading-8">
            {platforms.join(' · ')}
          </p>
        </motion.section>
      </div>
    </section>
  )
}
