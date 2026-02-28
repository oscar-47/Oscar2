'use client'

import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import {
  ArrowRight,
  Play,
  Upload,
  Sparkles,
  Zap,
  Target,
  Layers3,
  CheckCircle2,
  Globe,
  Eye,
  Download,
  Crop,
  Pencil,
  MessageSquareText,
  BadgeDollarSign,
  FileText,
  ChevronDown,
  Headset,
  Image as ImageIcon,
} from 'lucide-react'

const HIGHLIGHTS = [
  { key: 'smartExtract', icon: Target },
  { key: 'layoutEngine', icon: Layers3 },
  { key: 'consistency', icon: CheckCircle2 },
  { key: 'batch', icon: Layers3 },
  { key: 'relighting', icon: Sparkles },
  { key: 'multilingual', icon: Globe },
  { key: 'preview', icon: Eye },
  { key: 'export', icon: Download },
  { key: 'customSize', icon: Crop },
  { key: 'refineEdit', icon: Pencil },
  { key: 'styleTransfer', icon: Sparkles },
  { key: 'speedMode', icon: Zap },
] as const

const SHOWCASE_IMAGES = [
  'https://picsum.photos/seed/picset-watch/720/720',
  'https://picsum.photos/seed/picset-headphones/720/720',
  'https://picsum.photos/seed/picset-abstract/720/720',
  'https://picsum.photos/seed/picset-glasses/720/720',
  'https://picsum.photos/seed/picset-shoe1/720/720',
  'https://picsum.photos/seed/picset-perfume/720/720',
  'https://picsum.photos/seed/picset-shoe2/720/720',
  'https://picsum.photos/seed/picset-lipstick/720/720',
  'https://picsum.photos/seed/picset-shoe3/720/720',
  'https://picsum.photos/seed/picset-bag1/720/720',
  'https://picsum.photos/seed/picset-shoe4/720/720',
  'https://picsum.photos/seed/picset-headphones2/720/720',
  'https://picsum.photos/seed/picset-headphones3/720/720',
  'https://picsum.photos/seed/picset-watch2/720/720',
  'https://picsum.photos/seed/picset-green/720/720',
] as const

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const

export function FeatureShowcase() {
  const t = useTranslations('landing')
  const locale = useLocale()
  const [openFaq, setOpenFaq] = useState<string>('q1')

  return (
    <section className="bg-[#f3f3f4] pb-28">
      <div className="mx-auto max-w-[1240px] space-y-[116px] px-4">
        <section id="suite-cards" className="space-y-8">
          <div className="grid gap-7 lg:grid-cols-2">
            <article className="rounded-[22px] border border-[#e0e1e5] bg-white p-9">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-[#f2f3f6] p-3.5 text-[#24262d]">
                  <Layers3 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-[38px] font-semibold leading-tight text-[#17181d]">{t('suites.genesis.title')}</h3>
                  <p className="mt-1 text-lg text-[#7d818c]">{t('suites.genesis.subtitle')}</p>
                </div>
              </div>
              <p className="mt-8 text-lg leading-[1.85] text-[#5d616d]">{t('suites.genesis.desc')}</p>
              <ul className="mt-7 space-y-3 text-base text-[#373b46]">
                <li className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('suites.genesis.bullet1')}</li>
                <li className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('suites.genesis.bullet2')}</li>
                <li className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('suites.genesis.bullet3')}</li>
              </ul>
              <Link href={`/${locale}/studio-genesis`} className="mt-8 inline-flex h-12 items-center gap-2 rounded-2xl bg-[#101116] px-6 text-base font-medium text-white hover:bg-[#1a1c24]">
                {t('suites.genesis.cta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>

            <article className="relative overflow-hidden rounded-[22px] border border-[#d7d8de] bg-[#101116]">
              <div className="grid h-full min-h-[420px] grid-cols-5 gap-1.5 p-1.5">
                {['studio1', 'studio2', 'studio3', 'studio4', 'studio5'].map((seed) => (
                  <div key={seed} className="overflow-hidden rounded-[14px] bg-zinc-800">
                    <img src={`https://picsum.photos/seed/${seed}/420/880`} alt={seed} className="h-full w-full object-cover opacity-95" loading="lazy" />
                  </div>
                ))}
              </div>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex h-16 w-24 items-center justify-center rounded-2xl bg-[#ff2d3d] text-white shadow-xl">
                  <Play className="h-8 w-8 fill-white" />
                </div>
              </div>
            </article>
          </div>

          <div className="grid gap-7 lg:grid-cols-2">
            <article className="relative overflow-hidden rounded-[22px] border border-[#d7d8de]">
              <img src="https://picsum.photos/seed/aestheticmirror/1200/760" alt="aesthetic-mirror-demo" className="h-full min-h-[380px] w-full object-cover" loading="lazy" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/20" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex h-16 w-24 items-center justify-center rounded-2xl bg-[#ff2d3d] text-white shadow-xl">
                  <Play className="h-8 w-8 fill-white" />
                </div>
              </div>
            </article>

            <article className="rounded-[22px] border border-[#e0e1e5] bg-white p-9">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-[#f2f3f6] p-3.5 text-[#24262d]">
                  <ImageIcon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-[38px] font-semibold leading-tight text-[#17181d]">{t('suites.mirror.title')}</h3>
                  <p className="mt-1 text-lg text-[#7d818c]">{t('suites.mirror.subtitle')}</p>
                </div>
              </div>
              <p className="mt-8 text-lg leading-[1.85] text-[#5d616d]">{t('suites.mirror.desc')}</p>
              <ul className="mt-7 space-y-3 text-base text-[#373b46]">
                <li className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('suites.mirror.bullet1')}</li>
                <li className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('suites.mirror.bullet2')}</li>
                <li className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('suites.mirror.bullet3')}</li>
              </ul>
              <Link href={`/${locale}/aesthetic-mirror`} className="mt-8 inline-flex h-12 items-center gap-2 rounded-2xl bg-[#101116] px-6 text-base font-medium text-white hover:bg-[#1a1c24]">
                {t('suites.mirror.cta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          </div>
        </section>

        <section className="text-center">
          <h2 className="text-[56px] font-semibold tracking-[-0.03em] text-[#17181d]">{t('steps.title')}</h2>
          <p className="mx-auto mt-5 max-w-[820px] text-[29px] text-[#7b7f8a]">{t('steps.subtitle')}</p>
          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {[
              { icon: Upload, id: 'step1' },
              { icon: Sparkles, id: 'step2' },
              { icon: Zap, id: 'step3' },
            ].map(({ icon: Icon, id }) => (
              <article key={id} className="px-4">
                <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-[#e7e8ec] text-[#1f2128]">
                  <Icon className="h-8 w-8" />
                </div>
                <p className="text-base font-medium text-[#5f636e]">{t(`steps.${id}.label` as Parameters<typeof t>[0])}</p>
                <h3 className="mt-2 text-[38px] font-semibold text-[#17181d]">{t(`steps.${id}.title` as Parameters<typeof t>[0])}</h3>
                <p className="mt-4 text-lg leading-[1.8] text-[#7a7f8a]">{t(`steps.${id}.desc` as Parameters<typeof t>[0])}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="text-center">
            <h2 className="text-[56px] font-semibold tracking-[-0.03em] text-[#17181d]">{t('highlights.title')}</h2>
            <p className="mx-auto mt-5 max-w-[900px] text-[29px] text-[#7b7f8a]">{t('highlights.subtitle')}</p>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HIGHLIGHTS.map(({ key, icon: Icon }) => (
              <article key={key} className="rounded-[18px] border border-[#e3e4e8] bg-white px-6 py-7 text-center">
                <Icon className="mx-auto h-8 w-8 text-[#1a1c24]" />
                <h3 className="mt-5 text-[30px] font-semibold text-[#17181d]">{t(`highlights.items.${key}.title` as Parameters<typeof t>[0])}</h3>
                <p className="mt-4 text-base leading-[1.7] text-[#777c87]">{t(`highlights.items.${key}.desc` as Parameters<typeof t>[0])}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="text-center">
            <h2 className="text-[56px] font-semibold tracking-[-0.03em] text-[#17181d]">{t('reasons.title')}</h2>
            <p className="mx-auto mt-5 max-w-[920px] text-[29px] text-[#7b7f8a]">{t('reasons.subtitle')}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { key: 'card1', icon: BadgeDollarSign },
              { key: 'card2', icon: MessageSquareText },
              { key: 'card3', icon: FileText },
            ].map(({ key, icon: Icon }) => (
              <article key={key} className="rounded-[28px] border border-[#e2e3e8] bg-white p-9">
                <Icon className="h-8 w-8 text-[#1c1f29]" />
                <h3 className="mt-5 text-[38px] font-semibold text-[#17181d]">{t(`reasons.${key}.title` as Parameters<typeof t>[0])}</h3>
                <p className="mt-4 text-xl leading-[1.8] text-[#707581]">{t(`reasons.${key}.desc` as Parameters<typeof t>[0])}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="text-center">
            <h2 className="text-[56px] font-semibold tracking-[-0.03em] text-[#17181d]">{t('showcase.title')}</h2>
            <p className="mx-auto mt-5 max-w-[900px] text-[29px] text-[#7b7f8a]">{t('showcase.subtitle')}</p>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {SHOWCASE_IMAGES.map((src, idx) => (
              <div key={src} className="overflow-hidden rounded-[14px] border border-[#dde0e5] bg-white">
                <img src={src} alt={`showcase-${idx + 1}`} className="aspect-square h-full w-full object-cover transition-transform duration-300 hover:scale-105" loading="lazy" />
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="text-center">
            <h2 className="text-[56px] font-semibold tracking-[-0.03em] text-[#17181d]">{t('faq.title')}</h2>
            <p className="mx-auto mt-5 max-w-[820px] text-[29px] text-[#7b7f8a]">{t('faq.subtitle')}</p>
          </div>
          <div className="mx-auto mt-12 max-w-[980px] space-y-5">
            {FAQ_KEYS.map((key) => {
              const opened = openFaq === key
              return (
                <div key={key} className="rounded-[18px] border border-[#e0e2e8] bg-white px-5 py-4">
                  <button type="button" onClick={() => setOpenFaq((prev) => (prev === key ? '' : key))} className="flex w-full items-center gap-4 text-left">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0f1f4] text-sm font-semibold text-[#20232c]">Q</span>
                    <span className="flex-1 text-[30px] font-semibold text-[#17181d]">{t(`faq.${key}.q` as Parameters<typeof t>[0])}</span>
                    <ChevronDown className={`h-5 w-5 shrink-0 text-[#7b7f8a] transition-transform ${opened ? 'rotate-180' : ''}`} />
                  </button>
                  {opened && <p className="ml-12 mt-4 text-xl leading-[1.8] text-[#6d727d]">{t(`faq.${key}.a` as Parameters<typeof t>[0])}</p>}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <button type="button" aria-label={t('supportAria')} className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#101116] text-white shadow-lg transition-transform hover:scale-105">
        <Headset className="h-6 w-6" />
      </button>
    </section>
  )
}
