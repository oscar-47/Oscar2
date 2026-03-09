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
 * Before/After image pairs for each feature section.
 * Images go in public/images/showcase/
 */
const SECTION_IMAGES: SectionImagePair[] = [
  {
    before: '/images/showcase/hero-left.png',
    after: '/images/showcase/hero-right.png',
    aspectRatio: '3 / 4',
    objectFit: 'cover',
  }, // Section 1: Hero Image Generator
  {
    before: '/images/showcase/detail-before.jpg',
    after: '/images/showcase/detail-right.png',
    aspectRatio: '9 / 16',
    objectFit: 'contain',
    beforeFrameClassName: 'bg-white',
    afterFrameClassName: 'bg-[#e8e0d5]',
    beforeImageClassName: 'p-3 sm:p-4',
    afterImageClassName: 'p-0',
  }, // Section 2: Detail Page Assets
  {
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
  }, // Section 3: Photo Editing
]

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
        ].join(' ').trim()}
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

  const sections = [1, 2, 3].map((n) => ({
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
    <section className="bg-secondary pb-32 pt-24 sm:pb-40 sm:pt-32">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-24 px-5 sm:gap-32 sm:px-8">
        {sections.map((section, index) => {
          const images = SECTION_IMAGES[index]
          const hasComparison = Boolean(images.before && images.after)
          const singleImageSrc = images.before ?? images.after
          const singleImageAlt = images.before
            ? tc('beforeAlt', { index: index + 1 })
            : tc('afterAlt', { index: index + 1 })
          const imageFirst = index % 2 === 0
          const contentOrder = imageFirst ? 'lg:order-1' : 'lg:order-2'
          const visualOrder = imageFirst ? 'lg:order-2' : 'lg:order-1'

          return (
            <motion.div
              key={index}
              {...sectionMotion}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.55, ease: [0.25, 1, 0.5, 1] }}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              {/* Text content */}
              <div className={contentOrder}>
                <span className="text-sm font-semibold text-muted-foreground">0{index + 1}</span>

                <h2 className="mt-3 text-[32px] font-semibold leading-[1.22] tracking-[-0.015em] text-foreground md:text-[40px]">
                  {section.title}
                </h2>

                <p className="mt-4 max-w-[520px] text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9">
                  {section.subtitle}
                </p>

                <div className="mt-8 space-y-4">
                  {section.caps.map((cap, capIndex) => (
                    <div key={capIndex}>
                      <h4 className="text-sm font-semibold text-foreground">{cap.title}</h4>
                      <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{cap.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visual — Before/After comparison */}
              <div className={visualOrder}>
                <div className="group overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
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
                            imageClassName={images.beforeImageClassName ?? images.imageClassName}
                            imageStyle={images.beforeImageStyle ?? images.imageStyle}
                          />
                        </div>

                        <div className="absolute inset-y-0 left-1/2 z-10 flex -translate-x-1/2 items-center pointer-events-none">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background shadow-lg">
                            <ArrowRight className="h-4 w-4 text-accent" />
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
                            imageClassName={images.afterImageClassName ?? images.imageClassName}
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
                        <div className="border-l border-border bg-accent/5 py-3">
                          <span className="text-[12px] font-semibold uppercase tracking-wider text-accent">
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
                        src={singleImageSrc}
                        alt={singleImageAlt}
                        label={tc('afterLabel')}
                        objectFit={images.beforeObjectFit ?? images.afterObjectFit ?? images.objectFit}
                        imageClassName={images.beforeImageClassName ?? images.afterImageClassName ?? images.imageClassName}
                        imageStyle={images.beforeImageStyle ?? images.afterImageStyle ?? images.imageStyle}
                      />
                    </div>
                  )}
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
          className="rounded-2xl border border-border bg-background px-6 py-10 text-center shadow-sm sm:px-12 sm:py-14"
        >
          <h2 className="text-[28px] font-semibold leading-[1.34] tracking-[-0.01em] text-foreground sm:text-[40px]">
            {t('bottomCta.title')}
          </h2>

          <Link
            href={`/${locale}/auth`}
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
