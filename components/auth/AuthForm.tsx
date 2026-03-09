'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'sign-in' | 'sign-up' | 'verify-otp'

export function AuthForm() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo') ?? `/${locale}/studio-genesis`

  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const supabase = createClient()

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
    } else {
      router.push(returnTo)
      router.refresh()
    }
    setLoading(false)
  }

  useEffect(() => {
    let mounted = true
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        router.push(returnTo)
        router.refresh()
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      if (data.session) {
        router.push(returnTo)
        router.refresh()
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [supabase, router, returnTo])

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
    } else if (data.session) {
      // Email confirmation disabled — user is logged in immediately.
      router.push(returnTo)
      router.refresh()
    } else {
      setMessage(t('checkEmail'))
      setMode('verify-otp')
    }
    setLoading(false)
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const normalizedOtp = otp.trim().replace(/\s+/g, '')

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email,
      token: normalizedOtp,
      type: 'signup',
    })

    if (verifyErr) {
      setError(verifyErr.message)
    } else {
      router.push(returnTo)
      router.refresh()
    }
    setLoading(false)
  }

  const inputClass = 'w-full rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10 transition-colors'
  const btnClass = 'w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background hover:bg-foreground/90 disabled:opacity-40 transition-colors press-scale'
  const labelClass = 'block text-[13px] font-medium text-muted-foreground mb-1.5'

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="mb-1 flex items-center justify-center gap-1.5">
          <span className="font-[var(--font-display)] text-2xl font-extrabold tracking-tight text-foreground">
            Shopix
          </span>
          <span className="text-sm font-medium text-text-tertiary">AI</span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {mode === 'sign-in' ? t('welcome') : mode === 'sign-up' ? t('createAccount') : t('checkEmail')}
        </p>
      </div>

      {/* Sign In */}
      {mode === 'sign-in' && (
        <form onSubmit={handleSignIn} className="space-y-3">
          <div>
            <label className={labelClass}>{t('email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="pt-1">
            <button type="submit" disabled={loading} className={btnClass}>
              {loading ? t('signingIn') : t('signIn')}
            </button>
          </div>
          <p className="text-center text-[13px] text-muted-foreground pt-1">
            {t('noAccount')}{' '}
            <button type="button" onClick={() => { setError(null); setMode('sign-up') }} className="font-medium text-foreground hover:underline">
              {t('signUp')}
            </button>
          </p>
        </form>
      )}

      {/* Sign Up */}
      {mode === 'sign-up' && (
        <form onSubmit={handleSendOtp} className="space-y-3">
          <div>
            <label className={labelClass}>{t('email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="pt-1">
            <button type="submit" disabled={loading} className={btnClass}>
              {loading ? t('signingUp') : t('sendOtp')}
            </button>
          </div>
          <p className="text-center text-[13px] text-muted-foreground pt-1">
            {t('hasAccount')}{' '}
            <button type="button" onClick={() => { setError(null); setMode('sign-in') }} className="font-medium text-foreground hover:underline">
              {t('signIn')}
            </button>
          </p>
        </form>
      )}

      {/* Verify OTP */}
      {mode === 'verify-otp' && (
        <form onSubmit={handleVerifyOtp} className="space-y-3">
          {message && (
            <p className="rounded-xl bg-secondary px-4 py-3 text-[13px] text-muted-foreground">{message}</p>
          )}
          <div>
            <label className={labelClass}>{t('otpCode')}</label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              maxLength={12}
              placeholder={t('otpPlaceholder')}
              autoComplete="one-time-code"
              className={`${inputClass} tracking-[0.3em] text-center text-base`}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="pt-1">
            <button type="submit" disabled={loading} className={btnClass}>
              {loading ? t('signingUp') : t('verifyOtp')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setError(null); setMode('sign-up') }}
            className="w-full text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('back')}
          </button>
        </form>
      )}
    </div>
  )
}
