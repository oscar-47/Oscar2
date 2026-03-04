# Feature Plan: P0-02 平台最低数量规则

## 问题/需求
不同电商平台对产品图有最低数量要求。当用户选择了目标平台后，分析阶段生成的图片数量需自动满足该平台的最低要求。界面需显示平台规则提示，生成时强制校验选中数量。

## 设计决策

### 平台规则数据（前端常量，不需要后端）
```typescript
export type EcommercePlatform = 'none' | 'taobao' | 'tmall' | 'jd' | 'pdd' | 'amazon' | 'shopee' | 'ebay' | 'tiktok'

export interface PlatformRule {
  value: EcommercePlatform
  minImages: number
}
```

Labels via i18n (messages/en.json, messages/zh.json) — single source of truth.

规则表：
| Platform | minImages |
|----------|-----------|
| none | 1 |
| taobao | 5 |
| tmall | 5 |
| jd | 5 |
| pdd | 5 |
| amazon | 7 |
| shopee | 8 |
| ebay | 5 |
| tiktok | 5 |

### 核心逻辑
1. 用户选择平台 → `imageCount` 自动设为 `max(currentImageCount, platform.minImages)`
2. 当平台选择后，imageCount 选择器的最小值锁定为 `platform.minImages`
3. **前端补足仅作防御性兜底** — 因为 imageCount 已 >= minImages，后端分析正常会返回足够数量。如果极端情况 AI 返回不够，前端 round-robin 复制补足。
4. **生成时硬校验** — handleGenerate 检查 `selectedCount >= platformMin`，不够则 toast 提示，阻止生成
5. **Preview 阶段** — 删除/反选后如果 selectedCount < platformMin，Generate 按钮 disabled + 提示

### 补足策略（防御性兜底）
当 AI 返回 M 张，平台要求 N 张（M < N），且 M > 0：
- Round-robin 复制 plans[i % plans.length]，标题加 "(补充)" / "(Supplementary)"
- 新 plan 获得新 UUID，自动加入 selectedPlanIds
- 如果 M === 0（AI 返回空）→ 不补足，显示分析失败错误，和现有 "Analysis output format mismatch" 一样走 error path

## 影响范围
- 修改文件:
  1. `types/index.ts` — 新增 EcommercePlatform type, PlatformRule interface, PLATFORM_RULES 常量, getPlatformMinImages helper
  2. `components/studio/StudioGenesisForm.tsx` — 平台选择器 UI, imageCount 联动, 分析后补足, 生成时硬校验, Preview 阶段 selectedCount 校验
  3. `messages/en.json` — i18n keys (platform labels, hints, warnings)
  4. `messages/zh.json` — i18n keys
- 新增文件: 无
- 删除文件: 无

## 实现方案

### Step 1: types/index.ts — 添加平台类型和规则
- 新增 `EcommercePlatform` union type
- 新增 `PlatformRule` interface (value + minImages only, labels via i18n)
- 新增 `PLATFORM_RULES: readonly PlatformRule[]` 常量
- 新增 `getPlatformMinImages(platform: EcommercePlatform): number` helper

### Step 2: StudioGenesisForm.tsx — 平台选择器 + 联动
- 新增 state: `const [platform, setPlatform] = useState<EcommercePlatform>('none')`
- 在 imageCount 选择器上方添加平台选择器（Select dropdown）
- 平台变更时：`setImageCount(prev => Math.max(prev, getPlatformMinImages(newPlatform)))`
- imageCount 选项过滤：`IMAGE_COUNTS.filter(n => n >= getPlatformMinImages(platform))`
- 平台 !== 'none' 时，选择器下方显示提示："该平台最少需要 N 张图片"

### Step 3: StudioGenesisForm.tsx — 分析后防御性补足
- handleAnalyze blueprint 处理阶段，在 plans 创建后：
```typescript
// Fail-fast on zero plans (covers both platform and non-platform paths)
if (plans.length === 0) {
  throw new Error('Analysis returned no image plans')
}
const minCount = getPlatformMinImages(platform)
if (plans.length < minCount && platform !== 'none') {
  const deficit = minCount - plans.length
  for (let i = 0; i < deficit; i++) {
    const source = plans[i % plans.length]
    plans.push({
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} ${isZh ? '(补充)' : '(Supplementary)'}`,
    })
  }
}
```

### Step 4: StudioGenesisForm.tsx — 生成时硬校验
- handleGenerate 开头加检查：
```typescript
const platformMin = getPlatformMinImages(platform)
if (platform !== 'none' && selectedCount < platformMin) {
  setErrorMessage(t('platformMinWarning', { min: platformMin }))
  return
}
```
- Generate 按钮 disabled 条件增加：`(platform !== 'none' && selectedCount < platformMin)`
- 按钮旁/下方显示警告文本

### Step 5: i18n — messages/en.json & messages/zh.json
- `studio.genesis.platform` — "Target Platform" / "目标平台"
- `studio.genesis.platformNone` — "No specific platform" / "不指定平台"
- `studio.genesis.platformTaobao` — "Taobao" / "淘宝"
- ... (每个平台)
- `studio.genesis.platformHint` — "This platform requires at least {min} images" / "该平台最少需要 {min} 张图片"
- `studio.genesis.platformMinWarning` — "Please select at least {min} images for this platform" / "请至少选择 {min} 张图片以满足该平台要求"

## 注意事项
- **不影响 clothing studio / ecommerce studio** — 改动仅限 StudioGenesisForm
- **不选平台时** (none) — 行为和现有完全一致，imageCount 自由选 1-15，无生成校验
- **平台规则纯前端常量** — 不涉及后端改动，不需要部署 edge function
- **零 plan 不补足** — AI 返回空则走已有 error path，不尝试凭空创建
- **三层保护**: ① imageCount >= min 让 AI 生成够 ② 分析后防御补足 ③ 生成时硬校验

## 验证方式
- [ ] tsc 通过
- [ ] 选择淘宝 → imageCount 自动>=5，分析结果<5时补足
- [ ] 选择亚马逊 → imageCount 自动>=7
- [ ] 选择 none → 行为不变，imageCount 1-15 自由选
- [ ] 平台提示文本正确显示中英文
- [ ] 切换平台时 imageCount 只增不减
- [ ] Preview 阶段反选到低于 platformMin → Generate disabled + 警告
- [ ] 生成时 selectedCount < platformMin → 被阻止 + 错误提示
