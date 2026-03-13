import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CreatorProgramPromoCard } from '@/components/creator/CreatorProgramPromoCard'
import { createClient } from '@/lib/supabase/server'

export default async function CreatorProgramDetailPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (!user) {
    redirect(`/${locale}/auth?returnTo=/${locale}/profile/creator-program`)
  }

  const t = await getTranslations({ locale, namespace: 'creatorProgram.detail' })

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
      <Link
        href={`/${locale}/profile`}
        className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('back')}
      </Link>

      <div className="mt-4">
        <CreatorProgramPromoCard />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
        <section className="rounded-3xl border p-6">
          <h1 className="font-[var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-foreground">
            {t('title')}
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{t('description')}</p>

          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold text-foreground">{t('rules.title')}</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>{t('rules.metric')}</li>
                <li>{t('rules.tier3d')}</li>
                <li>{t('rules.tier7dA')}</li>
                <li>{t('rules.tier7dB')}</li>
                <li>{t('rules.tier7dC')}</li>
                <li>{t('rules.stack')}</li>
                <li>{t('rules.nonRepeat')}</li>
                <li>{t('rules.entryLimit')}</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold text-foreground">{t('steps.title')}</p>
              <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>{t('steps.one')}</li>
                <li>{t('steps.two')}</li>
                <li>{t('steps.three')}</li>
                <li>{t('steps.four')}</li>
              </ol>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-3xl border p-6">
            <p className="text-sm font-semibold text-foreground">{t('examples.title')}</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>{t('examples.a')}</p>
              <p>{t('examples.b')}</p>
              <p>{t('examples.c')}</p>
            </div>
          </div>

          <div className="rounded-3xl border p-6">
            <p className="text-sm font-semibold text-foreground">{t('faq.title')}</p>
            <div className="mt-3 space-y-3 text-sm text-muted-foreground">
              <p>{t('faq.one')}</p>
              <p>{t('faq.two')}</p>
              <p>{t('faq.three')}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6">
            <p className="text-sm font-semibold text-amber-900">{t('ctaTitle')}</p>
            <p className="mt-2 text-sm leading-6 text-amber-800">{t('ctaDesc')}</p>
            <Link
              href={`/${locale}/profile#creator-program-feedback`}
              className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white"
            >
              {t('cta')}
            </Link>
          </div>
        </aside>
      </div>
    </div>
  )
}
