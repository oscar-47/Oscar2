# Feature Plan: P0-06 新模型接入与计费一致性

## 问题/需求
1. **Billing inconsistency (CRITICAL)**: `generate-image/index.ts` `computeCost` ignores model — charges flat 5/8/12/17 regardless of model. `process-generation-job/index.ts` uses `job.cost_amount` (from generate-image) with model-aware `computeCost` as fallback. So 3cr models (or-gemini-2.5-flash) are overcharged at 5cr, and future 15cr models (midjourney) would be undercharged at 5cr.
2. Backend `resolveImageRoute()` has no routing entries for 4 new models.
3. Frontend `DEFAULT_CREDIT_COSTS` missing 4 new models.
4. No API keys for new providers yet.

## 设计决策

### Two-stage approach (Codex reviewer recommended):
- **This PR**: Fix billing consistency (generate-image computeCost) + add routing stubs + frontend types
- **Later**: Add to AVAILABLE_MODELS when API keys are configured

### Key fix: generate-image computeCost
Replace the model-ignoring `computeCost` in `generate-image/index.ts` with a model-aware version matching `process-generation-job/index.ts`.

## 影响范围
- 修改文件:
  1. `supabase/functions/generate-image/index.ts` — fix computeCost to be model-aware
  2. `supabase/functions/process-generation-job/index.ts` — routing entries, provider type expansion
  3. `types/index.ts` — GenerationModel, DEFAULT_CREDIT_COSTS
- 新增/删除文件: 无

## 实现方案

### Step 1: generate-image/index.ts — Fix computeCost to match process-generation-job
Replace:
```typescript
function computeCost(_model: string, turboEnabled: boolean, imageSize: string): number {
  if (!turboEnabled) return 5;
  if (imageSize === "1K") return 8;
  if (imageSize === "2K") return 12;
  return 17;
}
```
With:
```typescript
function computeCost(model: string, turboEnabled: boolean, imageSize: string): number {
  const MODEL_BASE: Record<string, number> = {
    "or-gemini-2.5-flash": 3, "or-gemini-3.1-flash": 5, "or-gemini-3-pro": 10,
    "ta-gemini-2.5-flash": 3, "ta-gemini-3.1-flash": 3, "ta-gemini-3-pro": 5,
    "midjourney": 15, "sd-3.5-ultra": 8, "dall-e-4": 12, "ideogram-3": 10,
    "azure-flux": 5, "gpt-image": 5, "qiniu-gemini-pro": 5, "qiniu-gemini-flash": 5,
    "volc-seedream-4.5": 5, "volc-seedream-5.0-lite": 5,
    "flux-kontext-pro": 5, "gemini-pro-image": 5, "gemini-flash-image": 5,
  };
  const base = MODEL_BASE[model] ?? 5;
  if (!turboEnabled) return base;
  if (imageSize === "1K") return base + 3;
  if (imageSize === "2K") return base + 7;
  return base + 12;
}
```
This is identical to the `computeCost` in `process-generation-job/index.ts`.

### Step 2: process-generation-job/index.ts — Expand ImageRoute provider type
```typescript
type ImageRoute = {
  provider: "azure" | "openai" | "qiniu" | "volcengine" | "openrouter" | "toapis" | "goapi" | "stability" | "ideogram" | "default";
  model?: string;
  endpoint?: string;
  apiKey?: string;
};
```

### Step 3: process-generation-job/index.ts — Add routing entries
Add before the OpenRouter block in `resolveImageRoute`:
```typescript
if (model === "midjourney") {
  return {
    provider: "goapi",
    endpoint: Deno.env.get("GOAPI_API_ENDPOINT") ?? "https://api.goapi.ai/v1/images/generations",
    apiKey: Deno.env.get("GOAPI_API_KEY") ?? "",
    model: "midjourney",
  };
}

if (model === "sd-3.5-ultra") {
  return {
    provider: "stability",
    endpoint: Deno.env.get("STABILITY_API_ENDPOINT") ?? "https://api.stability.ai/v2beta/stable-image/generate/ultra",
    apiKey: Deno.env.get("STABILITY_API_KEY") ?? "",
    model: "sd3.5-ultra",
  };
}

if (model === "dall-e-4") {
  return {
    provider: "openai",
    endpoint: Deno.env.get("DALLE4_API_ENDPOINT") ?? "https://api.openai.com/v1/images/generations",
    apiKey: Deno.env.get("DALLE4_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
    model: "dall-e-4",
  };
}

if (model === "ideogram-3") {
  return {
    provider: "ideogram",
    endpoint: Deno.env.get("IDEOGRAM_API_ENDPOINT") ?? "https://api.ideogram.ai/generate",
    apiKey: Deno.env.get("IDEOGRAM_API_KEY") ?? "",
    model: "V_3",
  };
}
```

Note: `callQnImageAPI` detects provider by endpoint hostname (isGoAPI, isStabilityAI, etc.). The default URLs are correct for this detection. If env vars are set to proxied URLs, the hostname detection may fail — but this is an existing limitation of all providers and not introduced by this change.

### Step 4: types/index.ts — Add to GenerationModel type
Add to union: `| 'midjourney' | 'sd-3.5-ultra' | 'dall-e-4' | 'ideogram-3'`

### Step 5: types/index.ts — Add to DEFAULT_CREDIT_COSTS
```typescript
'midjourney': 15,
'sd-3.5-ultra': 8,
'dall-e-4': 12,
'ideogram-3': 10,
```

### Step 6: Deploy edge functions
```bash
supabase functions deploy generate-image --project-ref fnllaezzqarlwtyvecqn
supabase functions deploy process-generation-job --project-ref fnllaezzqarlwtyvecqn
```

## 注意事项
- **Critical billing fix**: generate-image was charging flat rates ignoring model. This affected existing models too (or-gemini-2.5-flash charged 5 instead of 3).
- **Models NOT in AVAILABLE_MODELS** — won't appear in UI until API keys are configured.
- **callQnImageAPI protocol support already exists** — no changes needed in `_shared/qn-image.ts`.
- **dall-e-4 reuses openai provider** — same provider as gpt-image but different endpoint.
- **Two computeCost copies** — one in generate-image (queue cost), one in process-generation-job (fallback). Both must stay in sync. A shared module could DRY this but adds deployment complexity for edge functions.
- **Required env vars** (for future enablement):
  - `GOAPI_API_ENDPOINT`, `GOAPI_API_KEY`
  - `STABILITY_API_ENDPOINT`, `STABILITY_API_KEY`
  - `IDEOGRAM_API_ENDPOINT`, `IDEOGRAM_API_KEY`
  - `DALLE4_API_ENDPOINT`, `DALLE4_API_KEY`

## 验证方式
- [ ] tsc 通过
- [ ] generate-image computeCost matches process-generation-job computeCost for all models
- [ ] Frontend DEFAULT_CREDIT_COSTS matches both backend computeCost functions
- [ ] resolveImageRoute returns correct provider/endpoint for each new model
- [ ] New models don't appear in UI (not in AVAILABLE_MODELS)
- [ ] Existing models unaffected
- [ ] Edge functions deployed successfully
