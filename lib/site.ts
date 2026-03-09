import type { Metadata } from 'next'

export const DEFAULT_SITE_URL = 'https://shopix.ai'
export const SUPPORTED_LOCALES = ['en', 'zh'] as const

export type SiteLocale = (typeof SUPPORTED_LOCALES)[number]
export type LegalDocumentKind = 'terms' | 'privacy'

interface LocaleSeoContent {
  title: string
  description: string
  shortDescription: string
  siteName: string
  navTagline: string
  legal: Record<
    LegalDocumentKind,
    {
      title: string
      description: string
      heading: string
      intro: string
      sections: Array<{ title: string; body: string[] }>
    }
  >
  softwareApplicationName: string
  softwareApplicationCategory: string
}

const localeSeoContent: Record<SiteLocale, LocaleSeoContent> = {
  en: {
    title: 'Shopix AI | AI Ecommerce Product Image Generator for Global Sellers',
    description:
      'Shopix AI is an AI ecommerce product image generator for hero images, product photo editing, detail-page creatives, and batch visual creation across Amazon, Shopify, TikTok Shop, Taobao, and more.',
    shortDescription: 'AI ecommerce product image generator and product photo editing suite.',
    siteName: 'Shopix AI',
    navTagline: 'AI Ecommerce Imaging',
    softwareApplicationName: 'Shopix AI Ecommerce Image Studio',
    softwareApplicationCategory: 'BusinessApplication',
    legal: {
      terms: {
        title: 'Terms of Service | Shopix AI',
        description:
          'Terms of Service for using Shopix AI ecommerce image generation, editing, and visual creation tools.',
        heading: 'Terms of Service',
        intro:
          'These Terms of Service govern access to Shopix AI, including AI ecommerce product image generation, editing, and related workflow tools.',
        sections: [
          {
            title: 'Use of the Service',
            body: [
              'You may use Shopix AI only for lawful business or creative purposes. You are responsible for the content you upload, generate, edit, or publish through the service.',
              'You must not use the platform to infringe intellectual property rights, impersonate others, or create illegal, deceptive, or harmful content.',
            ],
          },
          {
            title: 'Accounts and Billing',
            body: [
              'You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.',
              'Paid plans, credits, and subscriptions are governed by the pricing terms shown at purchase. Fees already charged are generally non-refundable unless required by law.',
            ],
          },
          {
            title: 'Generated Content and Availability',
            body: [
              'You retain responsibility for verifying that generated outputs are accurate, commercially suitable, and compliant with platform policies before use.',
              'We may update, suspend, or discontinue features when necessary to maintain security, performance, or service quality.',
            ],
          },
        ],
      },
      privacy: {
        title: 'Privacy Policy | Shopix AI',
        description:
          'Privacy Policy explaining how Shopix AI handles account data, uploaded assets, and generated ecommerce visuals.',
        heading: 'Privacy Policy',
        intro:
          'This Privacy Policy explains how Shopix AI collects, uses, and protects information related to ecommerce image generation and editing workflows.',
        sections: [
          {
            title: 'Information We Collect',
            body: [
              'We may collect account information, billing data, uploaded product images, generated assets, and technical logs needed to operate and secure the service.',
              'We also collect usage data such as device, browser, and interaction information to improve reliability and product experience.',
            ],
          },
          {
            title: 'How We Use Information',
            body: [
              'We use collected information to authenticate users, process payments, generate and store requested outputs, support customers, and improve the platform.',
              'We may analyze aggregated usage patterns to optimize performance, model routing, and product quality.',
            ],
          },
          {
            title: 'Data Protection and Retention',
            body: [
              'We apply reasonable technical and organizational safeguards to protect stored data. No internet service can guarantee absolute security.',
              'We retain information only as long as necessary for operational, legal, billing, or security purposes, or until deletion is requested where supported.',
            ],
          },
        ],
      },
    },
  },
  zh: {
    title: 'Shopix AI | 电商生图、AI商品图生成与商品图片精修工具',
    description:
      'Shopix AI 提供电商生图、AI商品图生成、电商主图生成、商品图片精修与详情页素材生成能力，覆盖 Amazon、TikTok Shop、淘宝、天猫、京东等海内外电商平台。',
    shortDescription: '电商生图、AI商品图生成与商品图片精修平台。',
    siteName: 'Shopix AI',
    navTagline: 'AI 电商生图工具',
    softwareApplicationName: 'Shopix AI 电商生图工作台',
    softwareApplicationCategory: 'BusinessApplication',
    legal: {
      terms: {
        title: '服务条款 | Shopix AI',
        description: '使用 Shopix AI 电商生图、商品图生成与图片精修服务的条款说明。',
        heading: '服务条款',
        intro:
          '本服务条款适用于你访问和使用 Shopix AI，包括电商生图、AI 商品图生成、图片精修与相关工作流工具。',
        sections: [
          {
            title: '服务使用',
            body: [
              '你只能将 Shopix AI 用于合法的商业或创意用途，并对通过平台上传、编辑、生成和发布的内容负责。',
              '你不得使用本平台侵犯知识产权、冒充他人，或生成违法、误导性、侵害性内容。',
            ],
          },
          {
            title: '账号与计费',
            body: [
              '你需要妥善保管账号凭据，并对账号下发生的所有行为负责。',
              '套餐、积分与订阅的价格以购买时页面展示为准；除法律另有规定外，已支付费用通常不予退还。',
            ],
          },
          {
            title: '生成结果与服务可用性',
            body: [
              '你需要在商业使用前自行确认生成结果的准确性、适用性以及对平台规则的符合性。',
              '为保障安全、性能与服务质量，我们可能对部分功能进行更新、暂停或下线。',
            ],
          },
        ],
      },
      privacy: {
        title: '隐私政策 | Shopix AI',
        description: '了解 Shopix AI 如何处理账号信息、上传素材与生成的电商图片数据。',
        heading: '隐私政策',
        intro:
          '本隐私政策说明 Shopix AI 在电商生图、商品图生成和图片精修流程中如何收集、使用和保护相关信息。',
        sections: [
          {
            title: '我们收集的信息',
            body: [
              '我们可能收集账号信息、账单信息、上传的商品图片、生成结果，以及用于保障服务运行和安全的技术日志。',
              '我们也会收集设备、浏览器和交互数据，用于提升稳定性与产品体验。',
            ],
          },
          {
            title: '信息的使用方式',
            body: [
              '我们使用这些信息来完成用户认证、支付处理、生成与存储结果、客户支持以及产品改进。',
              '我们也可能基于聚合后的使用数据优化系统性能、模型路由和生成质量。',
            ],
          },
          {
            title: '数据保护与保存',
            body: [
              '我们会采取合理的技术与组织措施保护数据安全，但任何互联网服务都无法保证绝对安全。',
              '除运营、法律、账单或安全需要外，我们只会在必要期限内保存数据，并在支持的情况下响应删除请求。',
            ],
          },
        ],
      },
    },
  },
}

function normalizeSiteUrl(value: string | undefined): string {
  const siteUrl = value?.trim() || DEFAULT_SITE_URL
  return siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl
}

export function getSiteUrl(): string {
  const explicitSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const appUrl = process.env.APP_URL?.trim()
  const nonLocalAppUrl =
    appUrl && !/localhost|127\.0\.0\.1/.test(appUrl) ? appUrl : undefined

  return normalizeSiteUrl(explicitSiteUrl || nonLocalAppUrl)
}

export function getSiteHost(): string {
  return new URL(getSiteUrl()).host
}

export function getLocaleSeoContent(locale: SiteLocale): LocaleSeoContent {
  return localeSeoContent[locale]
}

export function getLocalizedPath(locale: SiteLocale, pathname = ''): string {
  const normalizedPath = pathname ? (pathname.startsWith('/') ? pathname : `/${pathname}`) : ''
  return `/${locale}${normalizedPath}`
}

export function getLocalizedUrl(locale: SiteLocale, pathname = ''): string {
  return `${getSiteUrl()}${getLocalizedPath(locale, pathname)}`
}

export function getAlternates(pathname = ''): Metadata['alternates'] {
  return {
    canonical: getLocalizedUrl('en', pathname),
    languages: {
      en: getLocalizedUrl('en', pathname),
      zh: getLocalizedUrl('zh', pathname),
      'x-default': getLocalizedUrl('en', pathname),
    },
  }
}

export function getLocaleAlternates(locale: SiteLocale, pathname = ''): Metadata['alternates'] {
  return {
    canonical: getLocalizedUrl(locale, pathname),
    languages: {
      en: getLocalizedUrl('en', pathname),
      zh: getLocalizedUrl('zh', pathname),
      'x-default': getLocalizedUrl('en', pathname),
    },
  }
}

export function getOpenGraphLocale(locale: SiteLocale): string {
  return locale === 'zh' ? 'zh_CN' : 'en_US'
}

export function buildMarketingMetadata(locale: SiteLocale): Metadata {
  const content = getLocaleSeoContent(locale)
  return {
    title: content.title,
    description: content.description,
    alternates: getLocaleAlternates(locale),
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    openGraph: {
      type: 'website',
      locale: getOpenGraphLocale(locale),
      url: getLocalizedUrl(locale),
      title: content.title,
      description: content.description,
      siteName: content.siteName,
    },
    twitter: {
      card: 'summary',
      title: content.title,
      description: content.description,
    },
  }
}

export function buildLegalMetadata(locale: SiteLocale, kind: LegalDocumentKind): Metadata {
  const legal = getLocaleSeoContent(locale).legal[kind]
  return {
    title: legal.title,
    description: legal.description,
    alternates: getLocaleAlternates(locale, `/${kind}`),
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: 'article',
      locale: getOpenGraphLocale(locale),
      url: getLocalizedUrl(locale, `/${kind}`),
      title: legal.title,
      description: legal.description,
      siteName: getLocaleSeoContent(locale).siteName,
    },
    twitter: {
      card: 'summary',
      title: legal.title,
      description: legal.description,
    },
  }
}

export function buildMarketingStructuredData(locale: SiteLocale) {
  const content = getLocaleSeoContent(locale)
  const siteUrl = getSiteUrl()
  const localeUrl = getLocalizedUrl(locale)

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: content.siteName,
      url: siteUrl,
      description: content.description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: content.siteName,
      url: siteUrl,
      inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
      description: content.description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: content.softwareApplicationName,
      applicationCategory: content.softwareApplicationCategory,
      operatingSystem: 'Web',
      url: localeUrl,
      inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
      description: content.description,
      offers: {
        '@type': 'Offer',
        availability: 'https://schema.org/OnlineOnly',
        price: '0',
        priceCurrency: 'USD',
      },
    },
  ]
}
