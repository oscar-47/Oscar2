# Feature Plan: P0-03 关键参数变更强制重新分析

## 问题/需求
当用户在 preview 阶段修改了关键参数（imageCount, outputLanguage, platform），分析结果已与参数不一致。需要检测这种不一致并阻止直接生成，引导用户重新分析。

## 设计决策

### 方案：参数快照对比 + 解锁 preview 阶段关键参数
1. 解锁 preview 阶段的关键参数（imageCount, outputLanguage, platform）让用户可以修改
2. 保存"分析时参数快照"，对比当前参数
3. 不一致时 UI 切换为 "重新分析" 按钮

**关键参数**：imageCount, outputLanguage, platform
**非关键参数**（preview 仍锁定）：model, aspectRatio, imageSize — 这些影响生成不影响分析

### 解锁策略
当前 `leftParamsDisabled = leftPanelDisabled || phase === 'preview' || phase === 'complete'`
改为两级控制：
- `keyParamsDisabled`: 仅在 analyzing/generating/complete 时禁用（preview 可编辑）
- `genParamsDisabled`: 现有行为不变（preview 也禁用 model/aspectRatio/imageSize）

### UX
- needsReanalyze = true 时：
  - 黄色警告横幅："关键参数已变更，请重新分析"
  - 按钮文案改为 "重新分析" / "Re-Analyze"
  - 按钮 onClick = handleAnalyze（不是 handleGenerate）
  - 按钮不受 insufficientCredits/selectedCount 等生成条件限制
- needsReanalyze = false 时：现有行为完全不变

### platform 作为关键参数的理由
虽然 platform 本身不传给 analyzeProductV2，但 platform 变更会通过 handlePlatformChange 改变 imageCount（auto-bump），而 imageCount IS sent to analysis. 所以 platform 变更间接影响分析结果。且 platform 变更后补足逻辑也需要重跑。

## 影响范围
- 修改文件:
  1. `components/studio/StudioGenesisForm.tsx` — 解锁关键参数、snapshot state、needsReanalyze、UI 条件、硬防护
  2. `messages/en.json` — i18n keys
  3. `messages/zh.json` — i18n keys
- 新增/删除文件: 无

## 实现方案

### Step 1: StudioGenesisForm.tsx — 拆分 disabled 控制
Change:
```typescript
// Before:
const leftParamsDisabled = leftPanelDisabled || phase === 'preview' || phase === 'complete'

// After:
const keyParamsDisabled = phase === 'analyzing' || phase === 'generating' || phase === 'complete'
const genParamsDisabled = leftPanelDisabled || phase === 'preview' || phase === 'complete'
```
- imageCount selector: `disabled={keyParamsDisabled}` (editable in preview)
- outputLanguage selector: `disabled={keyParamsDisabled}` (editable in preview)
- platform selector: `disabled={keyParamsDisabled}` (editable in preview)
- model selector: `disabled={genParamsDisabled}` (still locked in preview)
- aspectRatio selector: `disabled={genParamsDisabled}` (still locked in preview)
- imageSize selector: `disabled={genParamsDisabled}` (still locked in preview)
- Keep `leftParamsDisabled` for product image upload and requirements textarea (still locked in preview)

### Step 2: StudioGenesisForm.tsx — Snapshot state
- Add local type:
```typescript
interface AnalysisParamSnapshot {
  imageCount: number
  outputLanguage: OutputLanguage
  platform: EcommercePlatform
}
```
- Add state: `const [analysisParams, setAnalysisParams] = useState<AnalysisParamSnapshot | null>(null)`
- At end of handleAnalyze success (after setPhase('preview')):
  `setAnalysisParams({ imageCount, outputLanguage, platform })`
- Reset to null in: handleBackToInput, handleNewGeneration, handleStop

### Step 3: StudioGenesisForm.tsx — Derived needsReanalyze
Compute in render body (derived, not state):
```typescript
const needsReanalyze = phase === 'preview' && analysisParams !== null && (
  analysisParams.imageCount !== imageCount ||
  analysisParams.outputLanguage !== outputLanguage ||
  analysisParams.platform !== platform
)
```

### Step 4: StudioGenesisForm.tsx — Preview UI changes
In preview phase render (renderLeftButton around line 900):
- Add warning banner BEFORE the turbo/generate section:
```tsx
{needsReanalyze && (
  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
    <p className="font-medium">{t('reanalyzeWarning')}</p>
  </div>
)}
```
- Conditionally render button:
```tsx
{needsReanalyze ? (
  <Button size="lg" onClick={handleAnalyze}
    className="h-14 w-full rounded-3xl bg-amber-600 text-[17px] font-semibold text-white hover:bg-amber-700">
    <RefreshCw className="mr-2 h-5 w-5" />
    {t('reanalyze')}
  </Button>
) : (
  // existing Generate button unchanged
)}
```
Note: Re-Analyze button has NO disabled conditions (always clickable in preview when dirty).

### Step 5: StudioGenesisForm.tsx — Hard guard in handleGenerate (defensive)
Even though UI swaps the button, add a hard guard as defense:
```typescript
// At the very start of handleGenerate:
if (analysisParams && (
  analysisParams.imageCount !== imageCount ||
  analysisParams.outputLanguage !== outputLanguage ||
  analysisParams.platform !== platform
)) {
  setErrorMessage(t('reanalyzeWarning'))
  return
}
```

### Step 6: i18n
**en.json** (add under studio.genesis, before "steps"):
```json
"reanalyzeWarning": "Key parameters changed since last analysis. Please re-analyze.",
"reanalyze": "Re-Analyze"
```

**zh.json**:
```json
"reanalyzeWarning": "关键参数已变更，请重新分析以更新设计方案。",
"reanalyze": "重新分析"
```

## 注意事项
- **Normal flow unchanged** — no param change in preview → needsReanalyze false → Generate works as before
- **handleAnalyze reuse** — called directly, resets to 'analyzing' phase, rebuilds blueprint, sets new snapshot on success
- **After re-analysis, snapshot updates** — needsReanalyze becomes false, Generate button returns
- **Import RefreshCw** from lucide-react (already imported file uses other lucide icons)
- **genParamsDisabled keeps preview lock** for model/aspectRatio/imageSize — these affect generation not analysis
- **handleGenerate dep array** — already includes platform; add analysisParams

## 验证方式
- [ ] tsc 通过
- [ ] Normal flow: Analyze → Generate without changing params → works as before
- [ ] Change imageCount in preview → warning + "Re-Analyze" button appears
- [ ] Change outputLanguage in preview → same
- [ ] Change platform in preview → same
- [ ] Change model/aspectRatio/imageSize in preview → NOT possible (locked), no warning
- [ ] Click "Re-Analyze" → runs analysis, after success → warning gone, Generate back
- [ ] Hard guard: if somehow handleGenerate called with stale params → blocked with error
