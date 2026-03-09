import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/marketing/LegalDocumentPage'
import { buildLegalMetadata, type SiteLocale } from '@/lib/site'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return buildLegalMetadata(locale as SiteLocale, 'terms')
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return <LegalDocumentPage locale={locale as SiteLocale} kind="terms" />
}
