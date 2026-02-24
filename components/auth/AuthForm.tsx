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

    const emailRedirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/${locale}/auth?returnTo=${encodeURIComponent(returnTo)}`
        : undefined

    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo,
      },
    })

    if (error) {
      setError(error.message)
    } else if (data.session) {
      // If confirm email is disabled, Supabase may return session immediately.
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

    // Supabase projects can issue either `email` or `signup` email OTP depending
    // on provider/template settings. Try both for maximum compatibility.
    let verifyError: string | null = null
    const attempts: Array<'email' | 'signup'> = ['email', 'signup']
    for (const type of attempts) {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: normalizedOtp,
        type,
      })
      if (!error) {
        verifyError = null
        break
      }
      verifyError = error.message
    }

    if (verifyError) {
      setError(verifyError)
    } else {
      router.push(returnTo)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background font-bold text-lg">
          P
        </div>
        <h1 className="text-xl font-semibold">
          {mode === 'sign-in' ? t('welcome') : t('createAccount')}
        </h1>
      </div>

      {/* Sign In */}
      {mode === 'sign-in' && (
        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {loading ? t('signingIn') : t('signIn')}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            <button
              type="button"
              onClick={() => setMode('sign-up')}
              className="font-medium text-foreground hover:underline"
            >
              {t('signUp')}
            </button>
          </p>
        </form>
      )}

      {/* Sign Up — Step 1: Send OTP */}
      {mode === 'sign-up' && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {loading ? t('signingUp') : t('sendOtp')}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            {t('hasAccount')}{' '}
            <button
              type="button"
              onClick={() => setMode('sign-in')}
              className="font-medium text-foreground hover:underline"
            >
              {t('signIn')}
            </button>
          </p>
        </form>
      )}

      {/* Sign Up — Step 2: Verify OTP */}
      {mode === 'verify-otp' && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          {message && (
            <p className="rounded-lg bg-secondary px-4 py-3 text-sm">{message}</p>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('otpCode')}</label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              maxLength={12}
              placeholder={t('otpPlaceholder')}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground tracking-widest text-center text-lg"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {loading ? t('signingUp') : t('verifyOtp')}
          </button>
          <button
            type="button"
            onClick={() => setMode('sign-up')}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
        </form>
      )}
    </div>
  )
}
