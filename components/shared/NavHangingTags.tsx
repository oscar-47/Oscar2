'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion'
import { Sparkles, X, Zap } from 'lucide-react'

function Ropes({ color }: { color: 'amber' | 'blue' }) {
  const cls = color === 'amber' ? 'text-amber-400/70' : 'text-blue-400/60'
  return (
    <svg
      width="72"
      height="24"
      viewBox="0 0 72 24"
      className="mx-auto block"
      style={{ marginBottom: -1 }}
    >
      <line x1="29" y1="0" x2="20" y2="24" stroke="currentColor" className={cls} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="43" y1="0" x2="52" y2="24" stroke="currentColor" className={cls} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function NavHangingTags() {
  const locale = useLocale()
  const t = useTranslations()
  const [creatorDismissed, setCreatorDismissed] = useState(false)
  const [topupDismissed, setTopupDismissed] = useState(true) // hidden until mount check
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Check sessionStorage for topup dismiss (resets each browser session)
    const dismissed = sessionStorage.getItem('shopix_topup_tag_dismissed')
    setTopupDismissed(!!dismissed)
    const timer = setTimeout(() => setMounted(true), 150)
    return () => clearTimeout(timer)
  }, [])

  // Pendulum physics
  const swing = useSpring(0, { stiffness: 60, damping: 8, mass: 1.2 })
  const ropeSwing = useTransform(swing, (v) => `rotate(${v}deg)`)

  useEffect(() => {
    if (mounted && (!creatorDismissed || !topupDismissed)) {
      swing.set(16)
      const timer = setTimeout(() => swing.set(0), 80)
      return () => clearTimeout(timer)
    }
  }, [mounted, creatorDismissed, topupDismissed, swing])

  function handleCreatorDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setCreatorDismissed(true)
  }

  function handleTopupDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setTopupDismissed(true)
    try { sessionStorage.setItem('shopix_topup_tag_dismissed', '1') } catch {}
  }

  const showCreator = mounted && !creatorDismissed
  const showTopup = mounted && !topupDismissed

  if (!showCreator && !showTopup) return null

  return (
    <AnimatePresence>
      <motion.div
        className="absolute left-1/2 top-full z-50 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, y: -40, transition: { duration: 0.3 } }}
      >
        <motion.div style={{ transformOrigin: 'top center', rotate: ropeSwing }}>
          {/* Creator program tag */}
          {showCreator && (
            <>
              <Ropes color="amber" />
              <motion.div
                initial={{ y: -60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 120, damping: 14, mass: 0.8, delay: 0.15 }}
              >
                <Link
                  href={`/${locale}/profile`}
                  className="group relative flex items-center gap-2 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/95 via-white to-orange-50/90 px-3 py-2 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                >
                  <span className="pointer-events-none absolute inset-0 -translate-x-full rounded-xl bg-gradient-to-r from-transparent via-amber-100/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  <span className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100/80">
                    <Sparkles className="h-3 w-3 text-amber-600" />
                  </span>
                  <span className="relative whitespace-nowrap text-[11px] font-semibold tracking-tight text-amber-800">
                    {t('creatorProgram.promo.moduleChip')}
                  </span>
                  <button
                    type="button"
                    onClick={handleCreatorDismiss}
                    className="relative -mr-1 flex h-5 w-5 items-center justify-center rounded-full text-amber-500/60 transition-colors hover:bg-amber-100 hover:text-amber-700"
                    aria-label="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Link>
              </motion.div>
            </>
          )}

          {/* Topup promo tag — chained below */}
          {showTopup && (
            <>
              <Ropes color="blue" />
              <motion.div
                initial={{ y: -40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  type: 'spring',
                  stiffness: 120,
                  damping: 14,
                  mass: 0.8,
                  delay: showCreator ? 0.35 : 0.15,
                }}
              >
                <Link
                  href={`/${locale}/pricing`}
                  className="group relative flex items-center gap-2 rounded-xl border border-blue-200/70 bg-gradient-to-br from-blue-50/95 via-white to-indigo-50/90 px-3 py-2 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                >
                  <span className="pointer-events-none absolute inset-0 -translate-x-full rounded-xl bg-gradient-to-r from-transparent via-blue-100/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  <span className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100/80">
                    <Zap className="h-3 w-3 text-blue-600" />
                  </span>
                  <span className="relative whitespace-nowrap text-[11px] font-semibold tracking-tight text-blue-800">
                    {t('topupPromo.tagLabel')}
                  </span>
                  <button
                    type="button"
                    onClick={handleTopupDismiss}
                    className="relative -mr-1 flex h-5 w-5 items-center justify-center rounded-full text-blue-500/60 transition-colors hover:bg-blue-100 hover:text-blue-700"
                    aria-label="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Link>
              </motion.div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
