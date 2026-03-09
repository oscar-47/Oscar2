import { expect, test } from '@playwright/test'

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://shopix.ai').replace(/\/$/, '')

test.describe('public seo smoke', () => {
  test('root redirects to english landing page', async ({ page, request }) => {
    const response = await request.get('/', { failOnStatusCode: false, maxRedirects: 0 })
    expect([307, 308]).toContain(response.status())
    expect(response.headers().location).toBe('/en')

    await page.goto('/')
    await expect(page).toHaveURL(/\/en$/)
    await expect(page.locator('h1')).toContainText('Create Ecommerce Product Images')
  })

  test.describe('localized marketing pages', () => {
    const cases = [
      {
        locale: 'en',
        title: 'Shopix AI | AI Ecommerce Product Image Generator for Global Sellers',
        descriptionIncludes: 'AI ecommerce product image generator',
        canonical: `${siteUrl}/en`,
      },
      {
        locale: 'zh',
        title: 'Shopix AI | 电商生图、AI商品图生成与商品图片精修工具',
        descriptionIncludes: '电商生图',
        canonical: `${siteUrl}/zh`,
      },
    ] as const

    for (const entry of cases) {
      test(`${entry.locale} page exposes metadata and structured data`, async ({ page }) => {
        await page.goto(`/${entry.locale}`)

        await expect(page).toHaveTitle(entry.title)
        await expect(page.locator('meta[name="description"]')).toHaveAttribute(
          'content',
          new RegExp(entry.descriptionIncludes),
        )
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', entry.canonical)
        await expect(
          page.locator(`link[rel="alternate"][hreflang="${entry.locale}"]`),
        ).toHaveAttribute('href', entry.canonical)
        await expect(
          page.locator('link[rel="alternate"][hreflang="x-default"]'),
        ).toHaveAttribute('href', `${siteUrl}/en`)
        await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', entry.canonical)
        await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary')

        const structuredDataScripts = page.locator('script[type="application/ld+json"]')
        await expect(structuredDataScripts).toHaveCount(3)

        const structuredDataText = await structuredDataScripts.allTextContents()
        expect(structuredDataText.join(' ')).toContain('schema.org')
        expect(structuredDataText.join(' ')).toContain('SoftwareApplication')
      })
    }
  })

  test('robots.txt is accessible and plain text', async ({ request }) => {
    const response = await request.get('/robots.txt')
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('text/plain')

    const body = await response.text()
    expect(body).toContain('User-Agent: *')
    expect(body).toContain(`Sitemap: ${siteUrl}/sitemap.xml`)
    expect(body).not.toContain('<html')
  })

  test('sitemap.xml contains localized landing and legal pages', async ({ request }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('application/xml')

    const body = await response.text()
    expect(body).toContain(`${siteUrl}/en`)
    expect(body).toContain(`${siteUrl}/zh`)
    expect(body).toContain(`${siteUrl}/en/terms`)
    expect(body).toContain(`${siteUrl}/zh/privacy`)
  })

  test('legal pages are reachable', async ({ request }) => {
    for (const pathname of ['/en/terms', '/zh/terms', '/en/privacy', '/zh/privacy']) {
      const response = await request.get(pathname)
      expect(response.ok(), `${pathname} should return 200`).toBeTruthy()
      expect(response.headers()['content-type']).toContain('text/html')
    }
  })
})
