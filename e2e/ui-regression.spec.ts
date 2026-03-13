import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('dashboard nav order is correct in zh', async ({ page }) => {
  await page.goto('/zh/studio-genesis', { waitUntil: 'networkidle' })

  const navTexts = await page.locator('header nav a').evaluateAll((links) =>
    links.map((link) => link.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean),
  )

  expect(navTexts).toEqual([
    '主图',
    '详情图',
    '风格复刻',
    '服装',
    '精修',
    '套餐',
  ])
})

test('studio genesis shows the current route and default controls', async ({ page }) => {
  await page.goto('/zh/studio-genesis-2', { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/\/zh\/studio-genesis$/)

  await page.goto('/zh/studio-genesis', { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { name: '主图生成' })).toBeVisible()
  await expect(page.getByText('商业主图工作流')).toBeVisible()
  const comboTexts = await page
    .getByRole('combobox')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean),
    )
  expect(comboTexts).toContain('均衡 (Nano Banana 2)')
  expect(comboTexts).toContain('3:4 竖版')
  expect(comboTexts).toContain('1 张图片')
})

test('aesthetic mirror uses tab triggers for mode switch', async ({ page }) => {
  await page.goto('/zh/aesthetic-mirror', { waitUntil: 'networkidle' })

  const singleTab = page.getByRole('tab', { name: /单图复刻|Single Replicate/i })
  const batchTab = page.getByRole('tab', { name: /批量复刻|Batch Replicate/i })

  await expect(singleTab).toHaveAttribute('data-state', 'active')
  await batchTab.click()
  await expect(batchTab).toHaveAttribute('data-state', 'active')
  await expect(singleTab).toHaveAttribute('data-state', 'inactive')
})

test('pricing page shows fixed tier copy', async ({ page }) => {
  await page.goto('/zh/pricing', { waitUntil: 'networkidle' })

  await expect(page.getByText('单次购买（原价）')).toBeVisible()
  await expect(page.getByText('月订阅（约95折）')).toBeVisible()
  await expect(page.getByText('季订阅（约9折）')).toBeVisible()
  await expect(page.getByText('年订阅（约8.5折）')).toBeVisible()
  await expect(page.getByText('极速：15积分/张')).toBeVisible()
  await expect(page.getByText('均衡：30积分/张')).toBeVisible()
  await expect(page.getByText('高质：50积分/张')).toBeVisible()
})

test('ecom studio module cards do not show creator program chips', async ({ page }) => {
  await page.goto('/zh/ecom-studio', { waitUntil: 'networkidle' })

  await expect(page.locator('main').getByText('小PP推荐官活动')).toHaveCount(0)
})

test('dashboard exposes floating feedback entry', async ({ page }) => {
  await page.goto('/zh/studio-genesis', { waitUntil: 'domcontentloaded' })

  const feedbackLink = page.getByRole('link', { name: '打开反馈入口' })
  await expect(feedbackLink).toBeVisible()
  await expect(feedbackLink).toHaveAttribute('href', /\/zh\/profile#support-feedback|#support-feedback/)
})
