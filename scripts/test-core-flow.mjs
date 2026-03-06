#!/usr/bin/env node
/**
 * 核心流程本地测试脚本
 *
 * 测试链路：
 *   Step 1: kimi-k2.5 (chat/vision)  — 图片+文字 → 蓝图 JSON
 *   Step 2: kimi-k2.5 (chat/SSE)     — 蓝图 → prompt 数组
 *   Step 3: gemini (images/edits)     — 原图+prompt → 新图片
 *
 * 用法：
 *   node scripts/test-core-flow.mjs                          # 用默认测试图
 *   node scripts/test-core-flow.mjs /path/to/product.jpg     # 用你自己的图
 *   node scripts/test-core-flow.mjs --step 1                 # 只测第1步
 *   node scripts/test-core-flow.mjs --step 2                 # 只测第2步（用mock蓝图）
 *   node scripts/test-core-flow.mjs --step 3                 # 只测第3步（用mock prompt）
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Load env from supabase/functions/.env.local ──────────────────────────────

function loadEnv() {
  const envPath = path.join(ROOT, 'supabase/functions/.env.local')
  if (!fs.existsSync(envPath)) {
    console.error('❌ 找不到 supabase/functions/.env.local')
    process.exit(1)
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
  }
  return env
}

const ENV = loadEnv()
const CHAT_KEY = ENV.QN_CHAT_API_KEY || ENV.QN_IMAGE_API_KEY
const CHAT_ENDPOINT = ENV.QN_CHAT_API_ENDPOINT || 'https://api.qnaigc.com/v1/chat/completions'
const CHAT_MODEL = ENV.QN_CHAT_MODEL || 'moonshotai/kimi-k2.5'
const DEFAULT_IMAGE_KEY = ENV.QN_IMAGE_API_KEY
const DEFAULT_IMAGE_ENDPOINT = ENV.QN_IMAGE_API_ENDPOINT || 'https://api.qnaigc.com/v1/images/edits'
const DEFAULT_IMAGE_MODEL = ENV.QN_IMAGE_MODEL || 'gemini-3.0-pro-image-preview'
const OPENROUTER_KEY = ENV.OPENROUTER_API_KEY || ''
const OPENROUTER_ENDPOINT = ENV.OPENROUTER_API_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions'

// Azure detection helpers
const isAzureOpenAI = (url) => url.includes('.openai.azure.com')
const isAzureAIFoundry = (url) => url.includes('.services.ai.azure.com')
const isAzure = (url) => isAzureOpenAI(url) || isAzureAIFoundry(url)
const isOpenRouter = (url) => {
  try {
    return new URL(url).hostname === 'openrouter.ai'
  } catch {
    return false
  }
}

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
let testImagePath = null
let onlyStep = null
let imageModel = DEFAULT_IMAGE_MODEL
let imageEndpoint = DEFAULT_IMAGE_ENDPOINT
let imageKey = DEFAULT_IMAGE_KEY
let imageSize = '2K'
let aspectRatio = '1:1'
let saveOutput = true

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--step') {
    onlyStep = parseInt(args[i + 1])
    i++
  } else if (args[i] === '--image-model') {
    imageModel = args[i + 1]
    i++
  } else if (args[i] === '--image-endpoint') {
    imageEndpoint = args[i + 1]
    i++
  } else if (args[i] === '--image-size') {
    imageSize = args[i + 1]
    i++
  } else if (args[i] === '--aspect-ratio') {
    aspectRatio = args[i + 1]
    i++
  } else if (args[i] === '--no-save') {
    saveOutput = false
  } else if (!args[i].startsWith('-')) {
    testImagePath = args[i]
  }
}

if (imageModel.startsWith('google/') && OPENROUTER_KEY && imageEndpoint === DEFAULT_IMAGE_ENDPOINT) {
  imageEndpoint = OPENROUTER_ENDPOINT
  imageKey = OPENROUTER_KEY
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function imageToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/png'
  const data = fs.readFileSync(filePath)
  return `data:${mime};base64,${data.toString('base64')}`
}

function log(emoji, msg) {
  console.log(`\n${emoji}  ${msg}`)
}

function logJson(label, obj) {
  const str = JSON.stringify(obj, null, 2)
  // 截断太长的输出
  if (str.length > 2000) {
    console.log(`   ${label}: ${str.slice(0, 2000)}...\n   (截断，共 ${str.length} 字符)`)
  } else {
    console.log(`   ${label}: ${str}`)
  }
}

function parseImageDimensions(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 30) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { w: view.getUint32(16), h: view.getUint32(20) }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker === 0xc0 || marker === 0xc2) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6]
        const w = (bytes[i + 7] << 8) | bytes[i + 8]
        return { w, h }
      }
      const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
      i += 2 + segLen
    }
  }
  return null
}

function aspectRatioToBaseSize(ratio) {
  switch (ratio) {
    case '2:3': return '2048x3072'
    case '3:2': return '3072x2048'
    case '3:4': return '1920x2560'
    case '4:3': return '2560x1920'
    case '9:16': return '1440x2560'
    case '16:9': return '2560x1440'
    case '4:5': return '2048x2560'
    case '5:4': return '2560x2048'
    case '21:9': return '3360x1440'
    default: return '2048x2048'
  }
}

function longestEdgeForSize(size) {
  if (size === '1K') return 1024
  if (size === '4K') return 4096
  return 2048
}

function scaledRequestSize(ratio, size) {
  const base = aspectRatioToBaseSize(ratio)
  const match = base.match(/^(\d+)x(\d+)$/)
  if (!match) return base
  const w = Number(match[1])
  const h = Number(match[2])
  const longest = Math.max(w, h)
  const target = longestEdgeForSize(size)
  if (longest === target) return base
  const scale = target / longest
  const round64 = (v) => Math.max(512, Math.round(v * scale / 64) * 64)
  return `${round64(w)}x${round64(h)}`
}

// ── 生成一个简单的测试图片（红色方块） ─────────────────────────────────────────

function createTestImageDataUrl() {
  // 最小的有效 PNG：8x8 红色方块
  // 如果用户没提供图片，我们创建一个简单的彩色 PNG
  log('📸', '没有提供测试图片，生成一个 100x100 的测试 PNG...')

  // 创建一个简单的 BMP 转 base64（更简单的方式）
  // 或者直接用一个极小的已知 PNG
  // 这里我们用 canvas-less 的方式创建最简单的纯色 PNG

  // 最简方案：用一个内嵌的 1x1 红色 PNG
  const tinyRedPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

  log('⚠️', '使用 1x1 像素测试图，建议用真实产品图测试：node scripts/test-core-flow.mjs ./your-product.jpg')
  return `data:image/png;base64,${tinyRedPng}`
}

// ── Step 1: 产品分析 (kimi-k2.5 vision) ─────────────────────────────────────

async function step1_analyzeProduct(imageDataUrl) {
  log('🔍', `Step 1: 产品分析 — ${CHAT_MODEL}`)
  console.log(`   模型: ${CHAT_MODEL}`)
  console.log(`   端点: ${CHAT_ENDPOINT}`)
  console.log(`   Azure: ${isAzure(CHAT_ENDPOINT) ? 'Yes' : 'No'}`)

  const startTime = Date.now()

  const messages = [
    {
      role: 'system',
      content: 'You are a world-class e-commerce visual director. Produce executable commercial image blueprints from product photos and brief. Return JSON only, no markdown fences.'
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Create blueprint JSON with this exact shape:
{
  "images": [
    {
      "title": "4-12 words title",
      "description": "1-2 sentence positioning",
      "design_content": "## Image [N]: ...\\n\\n**Design Goal**: ...\\n\\n**Product Appearance**: ...\\n\\n**Composition Plan**: ...\\n\\n**Text Content** (Using English): ...\\n\\n**Atmosphere Creation**: ..."
    }
  ],
  "design_specs": "# Overall Design Specifications\\n\\n## Color System\\n...\\n## Font System\\n..."
}
Constraints:
- Return exactly 2 objects in images.
- Every image plan must be different.
- For Text Content fields, write copy in English.
User brief:
Professional e-commerce product showcase`
        },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl }
        }
      ]
    }
  ]

  // Azure OpenAI: api-key header, no model in body
  // Azure AI Foundry: Api-Key header, no model in body
  // Others: Authorization Bearer, model in body
  const headers = { 'Content-Type': 'application/json' }
  const body = { messages, max_tokens: 2048, stream: false }

  if (isAzureOpenAI(CHAT_ENDPOINT)) {
    headers['api-key'] = CHAT_KEY
  } else if (isAzureAIFoundry(CHAT_ENDPOINT)) {
    headers['Api-Key'] = CHAT_KEY
  } else {
    headers['Authorization'] = `Bearer ${CHAT_KEY}`
    body.model = CHAT_MODEL
  }

  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const elapsed = Date.now() - startTime

  if (!res.ok) {
    const errorText = await res.text()
    console.error(`   ❌ HTTP ${res.status}: ${errorText}`)
    return null
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ''

  console.log(`   ✅ 响应成功 (${elapsed}ms)`)
  console.log(`   Token 使用: ${JSON.stringify(data?.usage ?? {})}`)

  // 尝试解析 JSON
  let blueprint = null
  try {
    // 先尝试直接解析
    blueprint = JSON.parse(content.trim())
  } catch {
    // 尝试从 markdown 代码块中提取
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) {
      try { blueprint = JSON.parse(match[1]) } catch {}
    }
    if (!blueprint) {
      const objMatch = content.match(/\{[\s\S]*\}$/)
      if (objMatch) {
        try { blueprint = JSON.parse(objMatch[0]) } catch {}
      }
    }
  }

  if (blueprint) {
    console.log(`   ✅ JSON 解析成功`)
    console.log(`   images 数量: ${blueprint.images?.length ?? 0}`)
    console.log(`   design_specs 长度: ${blueprint.design_specs?.length ?? 0} 字符`)
    if (blueprint.images?.[0]) {
      console.log(`   第一张标题: "${blueprint.images[0].title}"`)
    }
  } else {
    console.log(`   ⚠️ JSON 解析失败，原始内容:`)
    console.log(`   ${content.slice(0, 500)}`)
  }

  return { blueprint, rawContent: content }
}

// ── Step 2: 生成 Prompts (kimi-k2.5 SSE) ────────────────────────────────────

async function step2_generatePrompts(blueprint) {
  log('✍️', `Step 2: 生成 Prompts — ${CHAT_MODEL} (SSE stream)`)
  console.log(`   模型: ${CHAT_MODEL}`)

  const analysisJson = typeof blueprint === 'string' ? blueprint : JSON.stringify(blueprint, null, 2)

  const startTime = Date.now()

  const headers = { 'Content-Type': 'application/json' }
  const body = {
    messages: [
      {
        role: 'system',
        content: 'You are an e-commerce visual prompt engineering expert. Return a strict JSON array where each item only has a prompt field. No explanations.'
      },
      {
        role: 'user',
        content: `Generate exactly 2 prompt objects with this schema:
[{"prompt":"Subject: ... Composition: ... Background: ... Lighting: ... Style: ... Quality: ..."}]
Rules:
- Each prompt must represent a different scene/angle.
- Return JSON array only.
Analysis blueprint:
${analysisJson}`
      }
    ],
    max_tokens: 2048,
    stream: true,
  }

  if (isAzureOpenAI(CHAT_ENDPOINT)) {
    headers['api-key'] = CHAT_KEY
  } else if (isAzureAIFoundry(CHAT_ENDPOINT)) {
    headers['Api-Key'] = CHAT_KEY
  } else {
    headers['Authorization'] = `Bearer ${CHAT_KEY}`
    body.model = CHAT_MODEL
  }

  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorText = await res.text()
    console.error(`   ❌ HTTP ${res.status}: ${errorText}`)
    return null
  }

  // 读取 SSE 流
  let fullText = ''
  let chunkCount = 0
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue

      try {
        const parsed = JSON.parse(payload)
        const delta = parsed?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          fullText += delta
          chunkCount++
        }
      } catch {
        // 非 JSON 行，跳过
      }
    }
  }

  const elapsed = Date.now() - startTime
  console.log(`   ✅ SSE 流完成 (${elapsed}ms, ${chunkCount} chunks)`)
  console.log(`   原始输出长度: ${fullText.length} 字符`)

  // 解析 prompts
  let prompts = []
  try {
    // 清理可能的 markdown 包裹
    let cleanText = fullText.trim()
    const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) cleanText = match[1].trim()

    const arr = JSON.parse(cleanText)
    prompts = arr.map(p => p.prompt)
    console.log(`   ✅ JSON 解析成功，得到 ${prompts.length} 个 prompts`)
  } catch {
    // fallback: 按段落分割
    prompts = fullText.split(/\n{2,}/).filter(s => s.trim().length > 20)
    console.log(`   ⚠️ JSON 解析失败，fallback 段落分割得到 ${prompts.length} 个 prompts`)
  }

  for (let i = 0; i < prompts.length; i++) {
    console.log(`   Prompt ${i + 1}: "${prompts[i].slice(0, 120)}..."`)
  }

  return { prompts, rawText: fullText }
}

// ── Step 3: 生成图片 (gemini images/edits) ───────────────────────────────────

async function step3_generateImage(imageDataUrl, prompt) {
  log('🎨', `Step 3: 生成图片 — ${imageModel}`)
  console.log(`   模型: ${imageModel}`)
  console.log(`   端点: ${imageEndpoint}`)
  console.log(`   分辨率: ${imageSize}`)
  console.log(`   比例: ${aspectRatio}`)
  console.log(`   请求尺寸: ${scaledRequestSize(aspectRatio, imageSize)}`)
  console.log(`   Azure: ${isAzure(imageEndpoint) ? (isAzureAIFoundry(imageEndpoint) ? 'AI Foundry' : 'OpenAI') : 'No'}`)
  console.log(`   OpenRouter: ${isOpenRouter(imageEndpoint) ? 'Yes' : 'No'}`)
  console.log(`   Prompt: "${prompt.slice(0, 100)}..."`)

  const ecomPrefix = "Professional e-commerce product photography. High-end commercial catalog quality. " +
    "Studio lighting with soft shadows. Clean, premium aesthetic. Product is the hero — sharp focus, " +
    "realistic materials and textures. White or contextual lifestyle background. 4K ultra-detailed rendering. "
  const finalPrompt = ecomPrefix + prompt

  const startTime = Date.now()
  let res

  if (isOpenRouter(imageEndpoint)) {
    res = await fetch(imageEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${imageKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: imageModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: finalPrompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
        modalities: ['image', 'text'],
        image_config: {
          aspect_ratio: aspectRatio,
          image_size: imageSize,
        },
        provider: {
          require_parameters: true,
        },
      }),
    })
  } else if (isAzure(imageEndpoint)) {
    // Azure: multipart FormData for image edits
    // Extract raw base64 bytes from data URL
    const b64Part = imageDataUrl.split(',')[1]
    const binaryStr = atob(b64Part)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'image/png' })

    const form = new FormData()
    form.append('image', blob, 'image.png')
    form.append('prompt', finalPrompt)
    form.append('n', '1')
    form.append('size', scaledRequestSize(aspectRatio, imageSize))

    const headers = {}
    if (isAzureAIFoundry(imageEndpoint)) {
      headers['Api-Key'] = imageKey
      form.append('model', imageModel)
      form.append('output_format', 'png')
    } else {
      headers['Authorization'] = `Bearer ${imageKey}`
    }

    res = await fetch(imageEndpoint, { method: 'POST', headers, body: form })
  } else {
    // qnaigc / OpenAI-compatible: JSON body
    res = await fetch(imageEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${imageKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: imageModel,
        image: imageDataUrl,
        prompt: finalPrompt,
        n: 1,
        size: scaledRequestSize(aspectRatio, imageSize),
      }),
    })
  }

  const elapsed = Date.now() - startTime

  if (!res.ok) {
    const errorText = await res.text()
    console.error(`   ❌ HTTP ${res.status}: ${errorText}`)
    return null
  }

  const data = await res.json()

  // 提取 b64_json / URL
  let b64 = null
  let outputUrl = null
  if (Array.isArray(data?.data)) {
    for (const entry of data.data) {
      if (entry?.b64_json) {
        b64 = entry.b64_json
        // 去掉可能的 data:image 前缀
        if (b64.includes('base64,')) {
          b64 = b64.split('base64,')[1]
        }
        break
      }
      if (entry?.url) {
        outputUrl = entry.url
      }
    }
  }
  if (!b64 && Array.isArray(data?.choices)) {
    const msg = data.choices[0]?.message
    const imageUrl = msg?.images?.[0]?.image_url?.url || msg?.content?.find?.((part) => part?.type === 'image_url')?.image_url?.url || null
    if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
      b64 = imageUrl.split(',')[1] || null
    } else if (typeof imageUrl === 'string' && imageUrl) {
      outputUrl = imageUrl
    }
  }

  if (b64) {
    const sizeKB = Math.round(b64.length * 0.75 / 1024)
    const buffer = Buffer.from(b64, 'base64')
    const dims = parseImageDimensions(buffer)
    console.log(`   ✅ 图片生成成功 (${elapsed}ms)`)
    console.log(`   图片大小: ~${sizeKB} KB`)
    if (dims) console.log(`   实际尺寸: ${dims.w}x${dims.h}`)

    let outPath = null
    if (saveOutput) {
      const outDir = path.join(ROOT, 'scripts/test-output')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      outPath = path.join(outDir, `generated_${Date.now()}.png`)
      fs.writeFileSync(outPath, buffer)
      console.log(`   💾 已保存到: ${outPath}`)
    }

    return { b64, outputPath: outPath, dimensions: dims }
  } else if (outputUrl) {
    const imgRes = await fetch(outputUrl)
    const buffer = Buffer.from(await imgRes.arrayBuffer())
    const dims = parseImageDimensions(buffer)
    console.log(`   ✅ 图片生成成功 (${elapsed}ms)`)
    console.log(`   输出 URL: ${outputUrl}`)
    if (dims) console.log(`   实际尺寸: ${dims.w}x${dims.h}`)
    let outPath = null
    if (saveOutput) {
      const outDir = path.join(ROOT, 'scripts/test-output')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      outPath = path.join(outDir, `generated_${Date.now()}.png`)
      fs.writeFileSync(outPath, buffer)
      console.log(`   💾 已保存到: ${outPath}`)
    }
    return { outputUrl, outputPath: outPath, dimensions: dims }
  } else {
    console.log(`   ❌ 响应中没有找到 b64_json 或 url`)
    logJson('响应数据', data)
    return null
  }
}

// ── Mock data for individual step testing ────────────────────────────────────

const MOCK_BLUEPRINT = {
  images: [
    {
      title: "Hero Product Showcase",
      description: "Clean, premium product hero shot with studio lighting.",
      design_content: "## Image [1]: Hero Product Showcase\n\n**Design Goal**: Premium hero image\n**Product Appearance**: Yes\n**Composition Plan**: Center, 70% product\n**Atmosphere Creation**: Clean, minimal"
    },
    {
      title: "Lifestyle Context Scene",
      description: "Product in natural lifestyle setting.",
      design_content: "## Image [2]: Lifestyle Scene\n\n**Design Goal**: Lifestyle context\n**Product Appearance**: Yes\n**Composition Plan**: Rule of thirds\n**Atmosphere Creation**: Warm, inviting"
    }
  ],
  design_specs: "# Design Specs\n## Color: Neutral tones\n## Style: Premium e-commerce"
}

const MOCK_PROMPT = "Subject: A premium product photographed in a professional studio setting. Composition: Center-aligned with 70% product coverage. Background: Clean gradient white-to-light-grey. Lighting: Soft-box diffused key light with rim highlight. Style: High-end e-commerce photography. Quality: 4K, hyper-realistic, commercial grade."

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=' .repeat(60))
  console.log('  Shopix AI 核心流程本地测试')
  console.log('=' .repeat(60))
  console.log(`\n  Chat 模型: ${CHAT_MODEL}`)
  console.log(`  Image 模型: ${imageModel}`)
  console.log(`  Chat Key: ${CHAT_KEY ? CHAT_KEY.slice(0, 8) + '...' : '❌ 缺失'}`)
  console.log(`  Image Key: ${imageKey ? imageKey.slice(0, 8) + '...' : '❌ 缺失'}`)

  if (!CHAT_KEY || !imageKey) {
    console.error('\n❌ API Key 缺失，请检查 supabase/functions/.env.local')
    process.exit(1)
  }

  // 准备测试图片
  let imageDataUrl
  if (testImagePath) {
    const absPath = path.resolve(testImagePath)
    if (!fs.existsSync(absPath)) {
      console.error(`\n❌ 图片不存在: ${absPath}`)
      process.exit(1)
    }
    const sizeKB = Math.round(fs.statSync(absPath).size / 1024)
    log('📸', `使用测试图片: ${absPath} (${sizeKB} KB)`)
    imageDataUrl = imageToDataUrl(absPath)
  } else {
    imageDataUrl = createTestImageDataUrl()
  }

  let blueprint = null
  let prompts = null
  let results = { step1: null, step2: null, step3: null }

  // ── Step 1 ──
  if (!onlyStep || onlyStep === 1) {
    try {
      results.step1 = await step1_analyzeProduct(imageDataUrl)
      blueprint = results.step1?.blueprint
    } catch (e) {
      console.error(`   ❌ Step 1 异常: ${e.message}`)
    }
  }

  // ── Step 2 ──
  if (!onlyStep || onlyStep === 2) {
    const inputBlueprint = blueprint ?? MOCK_BLUEPRINT
    if (!blueprint && !onlyStep) {
      log('⚠️', 'Step 1 未返回有效蓝图，使用 mock 蓝图继续...')
    }
    if (onlyStep === 2) {
      log('ℹ️', '单步测试模式，使用 mock 蓝图')
    }
    try {
      results.step2 = await step2_generatePrompts(inputBlueprint)
      prompts = results.step2?.prompts
    } catch (e) {
      console.error(`   ❌ Step 2 异常: ${e.message}`)
    }
  }

  // ── Step 3 ──
  if (!onlyStep || onlyStep === 3) {
    const inputPrompt = prompts?.[0] ?? MOCK_PROMPT
    if (!prompts && !onlyStep) {
      log('⚠️', 'Step 2 未返回有效 prompt，使用 mock prompt 继续...')
    }
    if (onlyStep === 3) {
      log('ℹ️', '单步测试模式，使用 mock prompt')
    }
    try {
      results.step3 = await step3_generateImage(imageDataUrl, inputPrompt)
    } catch (e) {
      console.error(`   ❌ Step 3 异常: ${e.message}`)
    }
  }

  // ── Summary ──
  log('📊', '测试总结')
  console.log('   ─'.repeat(25))

  const status = (r) => r ? '✅ 通过' : '❌ 失败'

  if (!onlyStep || onlyStep === 1)
    console.log(`   Step 1 (${CHAT_MODEL} vision → 蓝图):     ${status(results.step1?.blueprint)}`)
  if (!onlyStep || onlyStep === 2)
    console.log(`   Step 2 (${CHAT_MODEL} SSE → prompts):      ${status(results.step2?.prompts?.length > 0)}`)
  if (!onlyStep || onlyStep === 3)
    console.log(`   Step 3 (${imageModel} → 图片):           ${status(results.step3?.b64 || results.step3?.outputUrl)}`)

  console.log('')

  const allPassed = (!onlyStep)
    ? results.step1?.blueprint && results.step2?.prompts?.length > 0 && results.step3?.b64
    : true

  if (allPassed) {
    console.log('   🎉 核心流程测试通过！')
  } else {
    console.log('   ⚠️ 部分步骤失败，请查看上方详细日志')
  }

  console.log('')
}

main().catch(e => {
  console.error(`\n💥 未捕获异常: ${e.message}`)
  console.error(e.stack)
  process.exit(1)
})
