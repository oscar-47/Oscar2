import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test.describe.configure({ mode: 'serial' })

const PRODUCT_IMAGE = resolve(process.cwd(), 'tmp/e2e-inputs/product-red-sneaker.jpg')

test('core generation textareas expose character limits', async ({ page }) => {
  await page.goto('/zh/studio-genesis')
  await expect(page.locator('#sg-req')).toHaveAttribute('maxlength', '300')

  await page.goto('/zh/ecom-studio')
  await expect(
    page.getByPlaceholder('输入产品信息、目标人群、核心卖点、场景偏好或促销重点...'),
  ).toHaveAttribute('maxlength', '300')

  await page.goto('/zh/refinement-studio')
  await expect(
    page.getByPlaceholder('例如：去除背景杂物、增强产品光泽、修复划痕、去除图片文字、提升整体清晰度...'),
  ).toHaveAttribute('maxlength', '300')
})

test('refinement blocks unrelated text before calling the API', async ({ page }) => {
  let analyzeSingleCalls = 0

  page.on('request', (request) => {
    if (request.url().includes('/functions/v1/analyze-single')) {
      analyzeSingleCalls += 1
    }
  })

  await page.goto('/zh/refinement-studio')
  await page.locator('input[type="file"]').first().setInputFiles(PRODUCT_IMAGE)

  const brief = page.getByPlaceholder('例如：去除背景杂物、增强产品光泽、修复划痕、去除图片文字、提升整体清晰度...')
  await brief.fill('帮我写一篇 Python 股票量化交易论文，顺便 debug 这个脚本，asdfasdf!!!!')

  await page.getByRole('button', { name: /开始一键精修/ }).click()

  await expect(page.getByText(/账号封禁/)).toBeVisible()
  expect(analyzeSingleCalls).toBe(0)
})
