#!/usr/bin/env node

import assert from 'node:assert/strict'
import { normalizeEcommerceAnalysisResult } from '../lib/studio/ecom-analysis.ts'

const fallback = {
  description: 'fallback description',
  platformStyle: 'international',
  isZh: true,
}

const legacyPayload = {
  optimized_description: 'legacy optimized',
  selling_points: ['A', 'B'],
  detail_focus_areas: ['细节1', '细节2'],
  main_image_prompt: 'legacy main prompt',
  detail_prompts: ['legacy detail 1', 'legacy detail 2'],
  platform_style: 'domestic',
}

const blueprintPayload = {
  design_specs: '# specs',
  images: [
    {
      title: '主图方案',
      description: '主图定位',
      design_content: 'blueprint main prompt',
    },
    {
      title: '细节方案1',
      description: '细节定位1',
      design_content: 'blueprint detail prompt 1',
    },
    {
      title: '细节方案2',
      description: '细节定位2',
      design_content: 'blueprint detail prompt 2',
    },
  ],
}

const wrappedPayload = {
  data: legacyPayload,
}

const badPayload = {
  images: [],
}

function testLegacy() {
  const result = normalizeEcommerceAnalysisResult(legacyPayload, fallback)
  assert.ok(result, 'legacy payload should be normalized')
  assert.equal(result.main_image_prompt, 'legacy main prompt')
  assert.deepEqual(result.detail_prompts, ['legacy detail 1', 'legacy detail 2'])
  assert.equal(result.platform_style, 'domestic')
}

function testBlueprintObject() {
  const result = normalizeEcommerceAnalysisResult(blueprintPayload, fallback)
  assert.ok(result, 'blueprint payload should be normalized')
  assert.equal(result.main_image_prompt, 'blueprint main prompt')
  assert.deepEqual(result.detail_prompts, ['blueprint detail prompt 1', 'blueprint detail prompt 2'])
  assert.deepEqual(result.detail_focus_areas, ['细节方案1', '细节方案2'])
  assert.equal(result.platform_style, 'international')
}

function testBlueprintString() {
  const result = normalizeEcommerceAnalysisResult(JSON.stringify(blueprintPayload), fallback)
  assert.ok(result, 'stringified blueprint payload should be normalized')
  assert.equal(result.main_image_prompt, 'blueprint main prompt')
}

function testWrappedPayload() {
  const result = normalizeEcommerceAnalysisResult(wrappedPayload, fallback)
  assert.ok(result, 'wrapped payload should be normalized')
  assert.equal(result.main_image_prompt, 'legacy main prompt')
}

function testBadPayload() {
  const result = normalizeEcommerceAnalysisResult(badPayload, fallback)
  assert.equal(result, null, 'invalid payload should return null')
}

function main() {
  testLegacy()
  testBlueprintObject()
  testBlueprintString()
  testWrappedPayload()
  testBadPayload()
  console.log('OK: ecom analysis normalizer smoke passed')
}

main()
