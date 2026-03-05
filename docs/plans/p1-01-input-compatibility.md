# Feature Plan: P1-01 输入规则兼容

## 现状分析
StudioGenesisForm 已有:
- Free-form textarea for `requirements`
- Empty input → sends `undefined` → backend uses "（无额外需求）" fallback → works
- Free text → sent as-is → works
- No structured template or quick-fill option

Backend (process-generation-job):
- `sanitizeString(payload.requirements, "")` with fallback text in prompts
- Handles empty, short, and long text

## 需求
支持三种输入形态：
1. **固定句式** — "我的商品是[商品名]，卖点是[卖点]" 模板
2. **自由输入** — 任意文本描述（already works）
3. **空输入** — 留空直接分析（already works）

## 设计决策

### Approach: Add template quick-fill chips + improved placeholder
- Add clickable template chips above textarea that fill in a structured prompt
- Improve placeholder to show all 3 input styles
- No backend changes — backend already handles all inputs gracefully
- No validation changes — empty is fine, anything goes

### Templates (locale-aware)
ZH:
- "我的商品是{name}，主要卖点是{points}，目标客群是{audience}"
EN:
- "My product is {name}, key features are {points}, target audience is {audience}"

These are fill-in templates, not rigid parsers. User can modify freely after clicking.

## 影响范围
- 修改文件:
  1. `components/studio/StudioGenesisForm.tsx` — template chips UI
  2. `messages/en.json` — i18n keys
  3. `messages/zh.json` — i18n keys
- 新增/删除文件: 无
- 后端: 无改动

## 实现方案

### Step 1: StudioGenesisForm.tsx — Add template chips
Above the textarea, add a row of template chips:
```tsx
{phase === 'input' && (
  <div className="flex flex-wrap gap-2 mb-2">
    <button
      type="button"
      onClick={() => setRequirements(isZh
        ? '我的商品是____，主要卖点是____，目标客群是____'
        : 'My product is ____, key features are ____, target audience is ____'
      )}
      className="rounded-full border border-[#d0d4dc] bg-white px-3 py-1 text-xs text-[#5a5e6b] hover:bg-[#f1f3f6] transition-colors"
    >
      {t('templateStructured')}
    </button>
    <button
      type="button"
      onClick={() => setRequirements('')}
      className="rounded-full border border-[#d0d4dc] bg-white px-3 py-1 text-xs text-[#5a5e6b] hover:bg-[#f1f3f6] transition-colors"
    >
      {t('templateFree')}
    </button>
  </div>
)}
```

### Step 2: StudioGenesisForm.tsx — Improve placeholder
Update textarea placeholder to show supported formats:
ZH: "支持三种输入方式：\n1. 固定句式：我的商品是____，卖点是____\n2. 自由描述：任意文字描述产品和需求\n3. 留空：仅通过产品图进行AI分析"
EN: "Three input styles supported:\n1. Template: My product is ____, features are ____\n2. Free text: Describe your product freely\n3. Empty: Let AI analyze from images alone"

### Step 3: i18n
**en.json**:
```json
"templateStructured": "Use template",
"templateFree": "Clear"
```

**zh.json**:
```json
"templateStructured": "使用模板",
"templateFree": "清空"
```

## 注意事项
- **No backend changes** — all input forms already work
- **No validation** — empty/short/long/structured all accepted
- **Template is just a starting point** — user can freely edit after clicking
- **Clear button** — lets user easily clear and start with empty input
- **Only shown in input phase** — disabled/hidden in other phases (leftPanelDisabled handles this)

## 验证方式
- [ ] tsc 通过
- [ ] Click "使用模板" → textarea filled with structured template
- [ ] Click "清空" → textarea cleared
- [ ] Empty input → Analyze succeeds
- [ ] Free text → Analyze succeeds
- [ ] Template text → Analyze succeeds
- [ ] Placeholder shows all 3 input styles
