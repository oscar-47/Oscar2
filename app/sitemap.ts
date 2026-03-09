import type { MetadataRoute } from 'next'
import { getLocalizedUrl, type SiteLocale } from '@/lib/site'

const localeEntries: SiteLocale[] = ['en', 'zh']
const pathEntries = ['', '/terms', '/privacy']

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  return localeEntries.flatMap((locale) =>
    pathEntries.map((path) => ({
      url: getLocalizedUrl(locale, path),
      lastModified: now,
      changeFrequency: path === '' ? 'weekly' : 'monthly',
      priority: path === '' ? 1 : 0.4,
    })),
  )
}
