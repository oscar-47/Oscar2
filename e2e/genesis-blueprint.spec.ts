import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test.describe.configure({ mode: 'serial' })
test.use({ storageState: resolve(process.cwd(), 'e2e/.auth/ta-pro-admin.json') })

const PRODUCT_IMAGE = resolve(process.cwd(), 'tmp/e2e-inputs/product-red-sneaker.jpg')
const SUPABASE_URL = 'https://fnllaezzqarlwtyvecqn.supabase.co'
const USER_ID = '739ab7d6-29d4-46c9-9fb9-8cba8b99f9fc'
const USER_EMAIL = '951454612@qq.com'
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s1WzxQAAAAASUVORK5CYII='
const PICSET_FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), 'e2e/fixtures/picset-genesis-har.fixture.json'), 'utf8'),
) as {
  blueprint: Record<string, unknown>
}

test('genesis blueprint analysis feeds editable copy and generation payloads', async ({ page }) => {
  let promptRequestBody: Record<string, unknown> | null = null
  const generateImageBodies: Record<string, unknown>[] = []

  await page.route(`${SUPABASE_URL}/auth/v1/user**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        email: USER_EMAIL,
      }),
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/profiles**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: USER_ID,
        subscription_credits: 2000,
        purchased_credits: 0,
      }),
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/generation_jobs**`, async (route) => {
    const url = new URL(route.request().url())
    const idFilter = url.searchParams.get('id')
    const jobId = idFilter?.replace(/^eq\./, '') ?? ''

    if (jobId === 'analysis-job-1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'analysis-job-1',
          status: 'success',
          error_message: null,
          result_url: null,
          result_data: {
            product_summary: '轻量缓震跑鞋，强调鞋底回弹和高端商业质感。',
            copy_plan: '丝缎光泽 一步入镜',
            product_visual_identity: {
              product_name: '轻量跑鞋',
              product_type: '运动鞋',
              materials: ['网布', '橡胶', 'TPU'],
              colors: ['正红色', '纯白色'],
              shape_features: ['低帮', '厚底', '流线鞋身'],
              must_preserve: ['鞋身主配色', '鞋带结构', '鞋底轮廓'],
            },
            style_directions: [
              {
                key: 'sceneStyle',
                label: '场景风格',
                recommended: '都市商业大片',
                options: ['都市商业大片', '极简棚拍', '速度感街拍'],
              },
              {
                key: 'lighting',
                label: '光线氛围',
                recommended: '柔和侧逆光',
                options: ['柔和侧逆光', '高对比轮廓光', '漫反射柔光'],
              },
              {
                key: 'composition',
                label: '构图方式',
                recommended: '主角居中偏下',
                options: ['主角居中偏下', '对角线动势', '近景特写'],
              },
            ],
            copy_analysis: {
              mode: 'user-brief',
              source_brief: '轻量缓震跑鞋，高级商业感主图',
              brief_summary: '短句式、商业化、适合主图排版。',
              product_summary: '轻量缓震跑鞋',
              resolved_output_language: 'zh',
              shared_copy: '丝缎光泽 一步入镜',
              can_clear_to_visual_only: true,
              per_plan_adaptations: [
                {
                  plan_index: 0,
                  plan_type: 'hero',
                  copy_role: 'headline+support',
                  adaptation_summary: '右上留白放主标题，左下放短辅助句。',
                },
                {
                  plan_index: 1,
                  plan_type: 'angle',
                  copy_role: 'label',
                  adaptation_summary: '只保留一个短标签，避免画面拥堵。',
                },
                {
                  plan_index: 2,
                  plan_type: 'feature',
                  copy_role: 'headline',
                  adaptation_summary: '主标题放底部安全区，突出鞋底回弹。',
                },
                {
                  plan_index: 3,
                  plan_type: 'feature',
                  copy_role: 'none',
                  adaptation_summary: '纯视觉特写，不添加文字。',
                },
              ],
            },
            design_specs: [
              '# 整体设计规范',
              '> 所有图片必须遵循以下统一规范，确保视觉连贯性',
              '## 色彩系统',
              '- 主色调：正红色、珍珠白、暖灰石材。',
              '## 字体系统/文案系统',
              '- 主标题控制在 12 个中文字符内，辅助短句控制在 18 个中文字符内。',
              '## 视觉语言',
              '- 使用流线型道具、抛光地面和速度残影来强化商业感。',
              '## 摄影风格',
              '- 柔和侧逆光，85mm 商业产品镜头，中浅景深。',
              '## 品质要求',
              '- 专业产品摄影 / 商业广告级 / 超写实。',
            ].join('\n'),
            images: [
              {
                id: 'hero-plan-1',
                title: '首图大片',
                description: '鞋身主体居中，背景保留干净留白。',
                design_content: '暖灰抛光地面，右上安全留白，柔和侧逆光勾边，商业质感明显。',
              },
              {
                id: 'hero-plan-2',
                title: '结构角度',
                description: '展示鞋侧面流线轮廓。',
                design_content: '轻微透视角度，背景简洁，局部高光强调鞋侧材质。',
              },
              {
                id: 'hero-plan-3',
                title: '鞋底特写',
                description: '突出缓震和纹理结构。',
                design_content: '近景特写，鞋底纹理清晰，局部高反差突出回弹感。',
              },
              {
                id: 'hero-plan-4',
                title: '动势收尾',
                description: '表现速度和轻量感。',
                design_content: '速度残影与流线背景结合，主体仍然清晰，禁止文字遮挡产品。',
              },
            ],
          },
        }),
      })
      return
    }

    const imageJobMatch = jobId.match(/^image-job-(\d+)$/)
    if (imageJobMatch) {
      const index = Number(imageJobMatch[1])
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: jobId,
          status: 'success',
          error_message: null,
          result_url: TINY_PNG_DATA_URL,
          result_data: {
            outputs: [{ url: TINY_PNG_DATA_URL }],
            metadata: {
              batch_index: index,
            },
          },
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/get-oss-sts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'supabase_compat',
        bucket: 'temp',
        endpoint: 'https://mock-storage.local/public',
        objectKey: `uploads/${Date.now()}_product-red-sneaker.jpg`,
        uploadUrl: 'https://mock-storage.local/upload',
        uploadMethod: 'PUT',
        formFields: null,
        securityToken: null,
      }),
    })
  })

  await page.route('https://mock-storage.local/upload', async (route) => {
    await route.fulfill({ status: 200, body: '' })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/analyze-product-v2`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: 'analysis-job-1' }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/process-generation-job`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/generate-prompts-v2`, async (route) => {
    promptRequestBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
      body: [
        'data: {"fullText":"[',
        '{\\"title\\":\\"首图大片\\",\\"prompt\\":\\"Commercial hero shot of the same red running shoe on polished warm gray floor, soft rim light, premium whitespace for typography, text must not cover the product\\",\\"negative_prompt\\":\\"blurry, distorted shoe\\"}',
        ']"}',
        'data: [DONE]',
        '',
      ].join('\n'),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/generate-image`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    generateImageBodies.push(body)
    const nextIndex = generateImageBodies.length - 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: `image-job-${nextIndex}` }),
    })
  })

  await page.goto('/zh/studio-genesis', { waitUntil: 'networkidle' })

  await page.locator('input[type="file"]').first().setInputFiles(PRODUCT_IMAGE)
  await page.locator('#sg-req').fill('我的商品是轻量缓震跑鞋，主要卖点是鞋底回弹、鞋身轻量、高级商业感')
  await page.getByRole('button', { name: /分析产品|Analyze Product/i }).click()

  await expect(page.getByRole('heading', { name: '共享主文案' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '风格微调' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '首图大片' })).toBeVisible()

  const sharedCopy = page.getByPlaceholder(/输入短句式共享主文案|Enter compact shared master copy/i)
  await expect(sharedCopy).toHaveValue('丝缎光泽 一步入镜')
  await sharedCopy.fill('轻到一眼心动')

  await page.getByRole('button', { name: /整体设计规范|Design Specifications/i }).click()
  const designSpecsTextarea = page.locator('textarea').nth(2)
  await expect(designSpecsTextarea).toBeVisible()
  await designSpecsTextarea.fill([
    '# 整体设计规范',
    '## 视觉语言',
    '- 右上必须预留标题安全区。',
    '## 品质要求',
    '- 商业大片级质感，避免平庸棚拍。',
    '## 验证标记',
    '- e2e blueprint updated',
  ].join('\n'))

  await page.getByRole('button', { name: /确认生成 1 张主图|Generate 1 hero image/i }).click()

  await expect.poll(() => Boolean(promptRequestBody), { timeout: 15_000 }).toBe(true)
  await expect.poll(() => generateImageBodies.length, { timeout: 15_000 }).toBe(1)
  await expect(page.getByRole('button', { name: /新建生成|New Generation/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('img[src^="data:image/png;base64"]')).toHaveCount(1)

  expect(promptRequestBody).not.toBeNull()
  expect(promptRequestBody?.module).toBe('genesis')

  const analysisJson = (promptRequestBody?.analysisJson ?? {}) as Record<string, unknown>
  const copyAnalysis = (analysisJson.copy_analysis ?? {}) as Record<string, unknown>
  expect(copyAnalysis.shared_copy).toBe('轻到一眼心动')
  const normalizedDesignSpecs = String(analysisJson.design_specs ?? '')
  expect(normalizedDesignSpecs).toContain('# 整体设计规范')
  expect(normalizedDesignSpecs).toContain('## 色彩系统')
  expect(normalizedDesignSpecs).toContain('## 字体系统/文案系统')
  expect(normalizedDesignSpecs).toContain('## 视觉语言')
  expect(normalizedDesignSpecs).toContain('## 摄影风格')
  expect(normalizedDesignSpecs).toContain('## 品质要求')
  expect(normalizedDesignSpecs).toContain('e2e blueprint updated')

  expect(
    generateImageBodies.every((body) => {
      const metadata = (body.metadata ?? {}) as Record<string, unknown>
      return typeof metadata.hero_plan_title === 'string' && metadata.hero_plan_title.length > 0
    }),
  ).toBe(true)
})

test('studio genesis 2 mirrors picset blueprint payloads without shared copy', async ({ page }) => {
  let analysisRequestBody: Record<string, unknown> | null = null
  let promptRequestBody: Record<string, unknown> | null = null
  const generateImageBodies: Record<string, unknown>[] = []

  await page.route(`${SUPABASE_URL}/auth/v1/user**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        email: USER_EMAIL,
      }),
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/profiles**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: USER_ID,
        subscription_credits: 2000,
        purchased_credits: 0,
      }),
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/generation_jobs**`, async (route) => {
    const url = new URL(route.request().url())
    const idFilter = url.searchParams.get('id')
    const jobId = idFilter?.replace(/^eq\./, '') ?? ''

    if (jobId === 'analysis-job-genesis2') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: jobId,
          status: 'success',
          error_message: null,
          result_url: null,
          result_data: PICSET_FIXTURE.blueprint,
        }),
      })
      return
    }

    if (jobId === 'image-job-genesis2-0') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: jobId,
          status: 'success',
          error_message: null,
          result_url: TINY_PNG_DATA_URL,
          result_data: {
            outputs: [{ url: TINY_PNG_DATA_URL }],
            metadata: { batch_index: 0 },
          },
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/get-oss-sts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'supabase_compat',
        bucket: 'temp',
        endpoint: 'https://mock-storage.local/public',
        objectKey: `uploads/${Date.now()}_product-red-sneaker.jpg`,
        uploadUrl: 'https://mock-storage.local/upload',
        uploadMethod: 'PUT',
        formFields: null,
        securityToken: null,
      }),
    })
  })

  await page.route('https://mock-storage.local/upload', async (route) => {
    await route.fulfill({ status: 200, body: '' })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/analyze-product-v2`, async (route) => {
    analysisRequestBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: 'analysis-job-genesis2' }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/process-generation-job`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/generate-prompts-v2`, async (route) => {
    promptRequestBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
      body: 'data: {"fullText":"[{\\"title\\":\\"The Future of Fluid Protection\\",\\"prompt\\":\\"Subject: The same iridescent iPhone case. Composition: Centered hero layout with safe whitespace. Background: Clean white set. Lighting: Soft studio key plus rim light. Style: premium tech campaign. Quality: crisp hyper-real detail.\\",\\"negative_prompt\\":\\"blurry, wrong colorway, missing logo\\"}]"}\n' +
        'data: [DONE]\n\n',
    })
  })

  await page.route(`${SUPABASE_URL}/functions/v1/generate-image`, async (route) => {
    generateImageBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: 'image-job-genesis2-0' }),
    })
  })

  await page.goto('/zh/studio-genesis-2', { waitUntil: 'networkidle' })

  await page.locator('input[type="file"]').first().setInputFiles(PRODUCT_IMAGE)
  await page.locator('textarea').first().fill('做一张高端科技感中文主图，强调环保材质和流光质感。')
  await page.getByRole('button', { name: /Analyze & Blueprint/i }).click()

  await expect(page.getByRole('heading', { name: 'The Future of Fluid Protection' })).toBeVisible()
  await expect(page.getByText(/共享主文案|Shared Master Copy/i)).toHaveCount(0)

  await page.getByRole('button', { name: /Design Specifications|整体设计规范/i }).click()
  await expect(page.locator('textarea').last()).toHaveValue(/# Overall Design Specifications/)

  await page.getByRole('button', { name: /确认生成 1 张主图|Generate 1 Hero Images|Generate 1 Hero Image/i }).click()

  await expect.poll(() => Boolean(analysisRequestBody), { timeout: 15_000 }).toBe(true)
  await expect.poll(() => Boolean(promptRequestBody), { timeout: 15_000 }).toBe(true)
  await expect.poll(() => generateImageBodies.length, { timeout: 15_000 }).toBe(1)

  expect(analysisRequestBody).not.toBeNull()
  expect(analysisRequestBody?.uiLanguage).toBe('zh')
  expect(analysisRequestBody?.targetLanguage).toBe('zh')
  expect(analysisRequestBody?.outputLanguage).toBe('zh')
  expect(analysisRequestBody?.studioType).toBe('genesis')
  expect(analysisRequestBody?.promptProfile).toBe('default')

  expect(promptRequestBody).not.toBeNull()
  expect(promptRequestBody?.module).toBe('genesis')
  expect(promptRequestBody?.promptProfile).toBe('default')
  expect(promptRequestBody?.imageCount).toBe(1)
  expect(promptRequestBody?.targetLanguage).toBe('zh')
  expect(promptRequestBody?.outputLanguage).toBe('zh')
  expect(typeof promptRequestBody?.design_specs).toBe('string')

  const analysisJson = (promptRequestBody?.analysisJson ?? {}) as Record<string, unknown>
  expect('copy_analysis' in analysisJson).toBe(false)
  expect(String(analysisJson.design_specs ?? '')).toContain('# Overall Design Specifications')

  const images = Array.isArray(analysisJson.images) ? analysisJson.images as Array<Record<string, unknown>> : []
  expect(images[0]?.title).toBe('The Future of Fluid Protection')
  expect(String(images[0]?.design_content ?? '')).toContain('Text Content')
  expect(String(generateImageBodies[0]?.prompt ?? '')).toContain('Subject:')
  expect(generateImageBodies[0]?.negativePrompt).toBe('blurry, wrong colorway, missing logo')
  const imageMetadata = (generateImageBodies[0]?.metadata ?? {}) as Record<string, unknown>
  expect(imageMetadata.hero_plan_title).toBe('The Future of Fluid Protection')
  expect(String(imageMetadata.hero_plan_description ?? '')).toContain('high-angle hero shot')
  expect(imageMetadata.product_visual_identity).toBeTruthy()
})
