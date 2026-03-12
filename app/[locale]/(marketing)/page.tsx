import type { Metadata } from 'next'
import { Hero } from '@/components/marketing/Hero'
import { ShowcaseGallery } from '@/components/marketing/ShowcaseGallery'
import { FeatureShowcase } from '@/components/marketing/FeatureShowcase'
import { buildMarketingMetadata, buildMarketingStructuredData, type SiteLocale } from '@/lib/site'

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
  const structuredData = buildMarketingStructuredData(locale as SiteLocale)

  return (
    <>
      {structuredData.map((entry, index) => (
        <script
          key={`structured-data-${index}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
        />
      ))}
      <Hero />
      <FeatureShowcase />
      <ShowcaseGallery />
    </>
  )
}
