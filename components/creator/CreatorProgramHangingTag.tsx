'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'

export function CreatorProgramHangingTag() {
  const locale = useLocale()
  const t = useTranslations('creatorProgram.promo')
  const [dismissed, setDismissed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Small delay so the swing animation plays after layout settles
    const timer = setTimeout(() => setMounted(true), 150)
    return () => clearTimeout(timer)
  }, [])

  function handleDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDismissed(true)
  }

  // Pendulum swing physics
  const swing = useSpring(0, { stiffness: 60, damping: 8, mass: 1.2 })
  const ropeSwing = useTransform(swing, (v) => `rotate(${v}deg)`)

  useEffect(() => {
    if (mounted && !dismissed) {
      // Trigger the pendulum by setting initial angle
      swing.set(18)
      // After a moment, let it settle to 0
      const timer = setTimeout(() => swing.set(0), 80)
      return () => clearTimeout(timer)
    }
  }, [mounted, dismissed, swing])

  if (!mounted || dismissed) return null

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          className="absolute left-1/2 top-full z-50 -translate-x-1/2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, y: -40, transition: { duration: 0.3 } }}
        >
          {/* Rope + tag container — swings from top-center pivot */}
          <motion.div
            style={{
              transformOrigin: 'top center',
              rotate: ropeSwing,
            }}
          >
            {/* Two ropes */}
            <svg
              width="72"
              height="28"
              viewBox="0 0 72 28"
              className="mx-auto block"
              style={{ marginBottom: -1 }}
            >
              {/* Left rope */}
              <line
                x1="28"
                y1="0"
                x2="18"
                y2="28"
                stroke="currentColor"
                className="text-amber-400/70"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              {/* Right rope */}
              <line
                x1="44"
                y1="0"
                x2="54"
                y2="28"
                stroke="currentColor"
                className="text-amber-400/70"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>

            {/* The tag card */}
            <motion.div
              initial={{ y: -60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{
                type: 'spring',
                stiffness: 120,
                damping: 14,
                mass: 0.8,
                delay: 0.15,
              }}
            >
              <Link
                href={`/${locale}/profile`}
                className="group relative flex items-center gap-2 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/95 via-white to-orange-50/90 px-3 py-2 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
              >
                {/* Shimmer */}
                <span className="pointer-events-none absolute inset-0 -translate-x-full rounded-xl bg-gradient-to-r from-transparent via-amber-100/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

                <span className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100/80">
                  <Sparkles className="h-3 w-3 text-amber-600" />
                </span>

                <span className="relative whitespace-nowrap text-[11px] font-semibold tracking-tight text-amber-800">
                  {t('moduleChip')}
                </span>

                {/* Dismiss X */}
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="relative -mr-1 flex h-5 w-5 items-center justify-center rounded-full text-amber-500/60 transition-colors hover:bg-amber-100 hover:text-amber-700"
                  aria-label="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
