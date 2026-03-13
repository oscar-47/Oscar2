import assert from 'node:assert/strict'
import { formatJobDisplaySemantics, getJobDisplaySemantics } from '../lib/job-display.ts'

function translate(key) {
  return key
}

function resolve(input) {
  return formatJobDisplaySemantics(getJobDisplaySemantics(input), translate)
}

{
  const semantics = getJobDisplaySemantics({
    type: 'ANALYSIS',
    payload: { studioType: 'genesis' },
  })
  assert.equal(semantics.businessModule, 'studio-genesis')
  assert.equal(semantics.detailMode, 'blueprint-analysis')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'IMAGE_GEN',
    payload: { studioType: 'genesis', metadata: { hero_plan_title: 'Hero Card 1' } },
  })
  assert.equal(semantics.businessModule, 'studio-genesis')
  assert.equal(semantics.detailMode, 'hero-image-generation')
  assert.equal(semantics.detailTitle, 'Hero Card 1')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'ANALYSIS',
    payload: { studioType: 'ecom-detail' },
  })
  assert.equal(semantics.businessModule, 'ecom-studio')
  assert.equal(semantics.detailMode, 'detail-plan-analysis')
}

{
  const labels = resolve({
    type: 'IMAGE_GEN',
    payload: { metadata: { module_name: 'Fabric Closeup' } },
  })
  assert.equal(labels.businessModuleLabel, 'businessModule.ecom-studio')
  assert.equal(labels.detailLabel, 'Fabric Closeup')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'STYLE_REPLICATE',
    payload: { mode: 'single' },
  })
  assert.equal(semantics.businessModule, 'aesthetic-mirror')
  assert.equal(semantics.detailMode, 'single-reference')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'STYLE_REPLICATE',
    payload: { mode: 'batch' },
  })
  assert.equal(semantics.businessModule, 'aesthetic-mirror')
  assert.equal(semantics.detailMode, 'batch-reference')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'STYLE_REPLICATE',
    payload: { mode: 'refinement' },
  })
  assert.equal(semantics.businessModule, 'refinement-studio')
  assert.equal(semantics.detailMode, 'refinement')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'ANALYSIS',
    payload: { clothingMode: 'product_analysis' },
  })
  assert.equal(semantics.businessModule, 'clothing-studio')
  assert.equal(semantics.detailMode, 'basic-photo-set')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'IMAGE_GEN',
    payload: { workflowMode: 'model' },
  })
  assert.equal(semantics.businessModule, 'clothing-studio')
  assert.equal(semantics.detailMode, 'model-try-on')
}

{
  const semantics = getJobDisplaySemantics({
    type: 'IMAGE_GEN',
    payload: {},
  })
  assert.equal(semantics.businessModule, 'unknown')
  assert.equal(semantics.detailLabelKey, 'type.IMAGE_GEN')
}

console.log('job display semantics smoke test passed')
