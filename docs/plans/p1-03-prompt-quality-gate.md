# Feature Plan: P1-03 提示词质量门禁

## 现状分析
- Prompts generated via streaming LLM → parsed via parsePromptArray → used directly in generateImage()
- GeneratedPrompt has 5 fields: prompt, title, negative_prompt, marketing_hook, priority
- **Only `prompt` is used** — title/negative_prompt/marketing_hook/priority are parsed but discarded
- No quality validation on prompt content
- Users never see prompts before generation → waste credits on bad prompts

## 需求
Add lightweight quality gate:
1. Show generated prompt preview in each ImagePlanCard during preview phase
2. Validate prompt quality after generation (length, completeness)
3. Show quality warnings but don't block generation
4. Allow users to edit prompts before generating

## 设计决策

### Approach: Embed prompt preview in existing preview phase
- **No new phase** — add prompt display to existing ImagePlanCard in preview
- After prompt generation completes, store full GeneratedPrompt[] (not just prompt strings)
- Show prompt text in each card (collapsed by default, expandable)
- Run quality validation and show warnings inline
- Allow prompt editing in the card

### Quality checks (warning only, never blocking):
1. Prompt too short (< 50 chars) → warning
2. Prompt array count mismatch (< selected plans) → warning
3. Parsing fell back to paragraph/repeat mode → warning

## 影响范围
- 修改文件:
  1. `components/studio/StudioGenesisForm.tsx` — store GeneratedPrompt[], pass to cards, enable editing
  2. `components/studio/ImagePlanCard.tsx` — show prompt preview, quality badge
  3. `messages/en.json` — i18n keys
  4. `messages/zh.json` — i18n keys
- 新增/删除文件: 无
- 后端: 无改动

## 实现方案

### Step 1: StudioGenesisForm.tsx — Store full GeneratedPrompt[]
Currently prompts are extracted to string[] and GeneratedPrompt data is lost.
Change to store the full parsed GeneratedPrompt array:

```tsx
const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([])
```

After parsePromptArray succeeds, store the result:
```tsx
setGeneratedPrompts(parsedPrompts)
```

Map prompts to image plans by index (1:1 correspondence based on selectedPlans).

### Step 2: ImagePlanCard.tsx — Show prompt preview
Add optional `generatedPrompt` prop:
```tsx
interface ImagePlanCardProps {
  // ... existing
  generatedPrompt?: GeneratedPrompt
  onPromptChange?: (prompt: GeneratedPrompt) => void
}
```

In the expanded card view, below design_content, show:
- Prompt text in a collapsible section with "Generated Prompt" header
- Editable textarea for prompt field
- Quality badge: green (good), amber (warning)
- Warning text if prompt < 50 chars

### Step 3: Wire prompt data flow
In StudioGenesisForm preview phase, map generatedPrompts to cards:
- Each selectedPlan[i] gets generatedPrompts[i] (or cycled)
- When user edits a prompt, update generatedPrompts[i]
- When generating, use generatedPrompts[i].prompt instead of re-extracting

### Step 4: i18n
**en.json**:
```json
"generatedPrompt": "Generated Prompt",
"promptTooShort": "Prompt is short — may produce vague results",
"promptQualityGood": "Good",
"promptQualityWarn": "Review recommended"
```

**zh.json**:
```json
"generatedPrompt": "生成提示词",
"promptTooShort": "提示词较短，可能产生模糊结果",
"promptQualityGood": "质量良好",
"promptQualityWarn": "建议检查"
```

## 注意事项
- Prompts are generated during "analyzing" phase as SSE stream — need to store parsed result
- Quality warnings are advisory only, never block generation
- Prompt editing updates the stored array, which is used during generation
- If parsePromptArray falls back to paragraph/repeat mode, all cards get warning badge
- generatedPrompts reset when user goes back to input or re-analyzes

## 验证方式
- [ ] tsc 通过
- [ ] After analysis, preview cards show generated prompts
- [ ] Short prompts show amber warning
- [ ] User can edit prompt text in card
- [ ] Edited prompts are used for generation (not original)
- [ ] Re-analyze clears old prompts
