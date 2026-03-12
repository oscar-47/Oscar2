import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { buildMarketingMetadata, type SiteLocale } from '@/lib/site'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return buildMarketingMetadata(locale as SiteLocale)
}

export async function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'zh' }]
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  redirect(`/${locale}/ecom-studio`)
}
