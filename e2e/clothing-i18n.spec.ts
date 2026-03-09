import { expect, test, type Page } from '@playwright/test'

async function waitForClothingStudioInteractivity(page: Page) {
  // In Next.js dev mode, the page content can render before client handlers hydrate.
  await page.waitForTimeout(500)
}

async function assertBasicPhotoSetLocale(
  page: Page,
  locale: 'en' | 'zh',
  copy: {
    heading: string
    selectorTitle: string
    selectedZero: string
    selectedTwo: string
    whiteBg: string
    threeD: string
    mannequin: string
    detail: string
    sellingPoint: string
  },
) {
  await page.goto(`/${locale}/clothing-studio`, { waitUntil: 'domcontentloaded' })
  await waitForClothingStudioInteractivity(page)
  await expect(page.getByRole('heading', { name: copy.heading })).toBeVisible()
  await expect(page.getByTestId('clothing-generation-selector')).toContainText(copy.selectorTitle)
  await expect(page.getByTestId('generation-type-white-bg')).toContainText(copy.whiteBg)
  await expect(page.getByTestId('generation-type-3d')).toContainText(copy.threeD)
  await expect(page.getByTestId('generation-type-mannequin')).toContainText(copy.mannequin)
  await expect(page.getByTestId('generation-type-detail')).toContainText(copy.detail)
  await expect(page.getByTestId('generation-type-selling-point')).toContainText(copy.sellingPoint)

  await expect(page.getByTestId('clothing-generation-selected-count')).toHaveText(copy.selectedZero)
  await page.getByTestId('generation-type-white-bg-front').click()
  await page.getByTestId('generation-type-detail-increase').click()
  await expect(page.getByTestId('clothing-generation-selected-count')).toHaveText(copy.selectedTwo)
}

async function assertTryOnLocale(
  page: Page,
  locale: 'en' | 'zh',
  copy: {
    tab: RegExp
    title: string
    button: string
    uploadLabel: string
  },
) {
  await page.goto(`/${locale}/clothing-studio`, { waitUntil: 'domcontentloaded' })
  await waitForClothingStudioInteractivity(page)
  await page.getByRole('tab', { name: copy.tab }).click()
  await expect(page.getByTestId('clothing-model-image-section')).toContainText(copy.title)
  await expect(page.getByTestId('clothing-generate-ai-model')).toContainText(copy.button)
  await expect(page.getByTestId('clothing-model-image-section')).toContainText(copy.uploadLabel)
}

test.describe('clothing studio locale regression', () => {
  test('english clothing ui copy stays in english', async ({ page }) => {
    await assertBasicPhotoSetLocale(page, 'en', {
      heading: 'AI-Powered Clothing Photo Set Generator',
      selectorTitle: 'Select Generation Types',
      selectedZero: 'Selected 0',
      selectedTwo: 'Selected 2',
      whiteBg: 'White Background Retouched',
      threeD: '3D Showcase',
      mannequin: 'Mannequin Shot',
      detail: 'Detail Close-up',
      sellingPoint: 'Selling Point Image',
    })

    await assertTryOnLocale(page, 'en', {
      tab: /Model Try-On/i,
      title: 'Subject Image',
      button: 'Generate AI Model',
      uploadLabel: 'Upload a subject image or use AI to generate a real model',
    })
  })

  test('chinese clothing ui copy stays in chinese', async ({ page }) => {
    await assertBasicPhotoSetLocale(page, 'zh', {
      heading: '智能生成服装详情图组',
      selectorTitle: '选择生成类型',
      selectedZero: '已选 0 项',
      selectedTwo: '已选 2 项',
      whiteBg: '白底精修图',
      threeD: '3D立体效果图',
      mannequin: '人台图',
      detail: '细节特写图',
      sellingPoint: '卖点图',
    })

    await assertTryOnLocale(page, 'zh', {
      tab: /模特试穿/,
      title: '主体图片',
      button: 'AI生成模特',
      uploadLabel: '上传主体图片或使用AI生成真人模特',
    })
  })
})
