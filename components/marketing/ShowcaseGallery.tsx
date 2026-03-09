'use client'

import { useTranslations } from 'next-intl'
import { Play } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Video entries. Replace `src` with real path when ready.
 * Videos go in public/videos/
 */
const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080

type ShowcaseVideoId = 'demo' | 'workflow'

const VIDEOS: { id: ShowcaseVideoId; src: string | null; poster: string | null }[] = [
  { id: 'demo', src: '/videos/welcome-demo.mp4', poster: null },
  { id: 'workflow', src: '/videos/welcome-workflow.mp4', poster: null },
]

function VideoPlaceholder({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground/40">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-current">
        <Play className="h-7 w-7 translate-x-0.5" strokeWidth={1.5} fill="currentColor" />
      </div>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
    </div>
  )
}

export function ShowcaseGallery() {
  const t = useTranslations('landing.showcase')
  const reduceMotion = useReducedMotion()
  const videoCopy = {
    demo: {
      label: t('video.demo.label'),
      title: t('video.demo.title'),
      desc: t('video.demo.desc'),
    },
    workflow: {
      label: t('video.workflow.label'),
      title: t('video.workflow.title'),
      desc: t('video.workflow.desc'),
    },
  } as const

  const fadeUp = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 28 } as const, whileInView: { opacity: 1, y: 0 } as const }

  return (
    <section className="border-y border-border bg-background">
      <div className="mx-auto w-full max-w-[1280px] px-5 py-24 sm:px-8 sm:py-32">
        <motion.div
          {...fadeUp}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.55, ease: [0.25, 1, 0.5, 1] }}
          className="max-w-[640px]"
        >
          <h2 className="font-[var(--font-display)] text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold leading-[1.15] tracking-[-0.025em] text-foreground">
            {t('videoTitle')}
          </h2>
        </motion.div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:mt-16 lg:grid-cols-2 lg:gap-8">
          {VIDEOS.map((video, index) => (
            <motion.div
              key={video.id}
              {...fadeUp}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.5, delay: index * 0.1, ease: [0.25, 1, 0.5, 1] }}
              className="overflow-hidden rounded-2xl border border-border bg-secondary shadow-sm"
            >
              <div
                className="relative aspect-[16/9] overflow-hidden bg-muted"
                style={{ aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}` }}
              >
                {video.src ? (
                  <video
                    poster={video.poster ?? undefined}
                    width={VIDEO_WIDTH}
                    height={VIDEO_HEIGHT}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  >
                    <source src={video.src} type="video/mp4" />
                  </video>
                ) : (
                  <VideoPlaceholder label={videoCopy[video.id].label} />
                )}
              </div>

              <div className="px-6 py-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-foreground">
                    {videoCopy[video.id].title}
                  </h3>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium leading-none text-muted-foreground">
                    {t('video.spec')}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {videoCopy[video.id].desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
