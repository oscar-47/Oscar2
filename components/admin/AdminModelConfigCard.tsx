'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  normalizeAdminImageModelConfig,
  normalizeAdminModelKey,
  type AdminBillingTier,
  type AdminImageModelConfig,
  type AdminImageSize,
  type AdminModelTier,
  type AdminProviderHint,
} from '@/lib/admin-models'

type EditableAdminImageModelConfig = Omit<AdminImageModelConfig, 'key'> & {
  key: string
}

type AdminModelConfigCardProps = {
  locale: string
  initialConfigs: AdminImageModelConfig[]
}

const MODEL_TIERS: AdminModelTier[] = ['high', 'balanced', 'fast']
const BILLING_TIERS: AdminBillingTier[] = ['quality', 'balanced', 'fast']
const IMAGE_SIZES: AdminImageSize[] = ['1K', '2K', '4K']
const PROVIDER_HINTS: AdminProviderHint[] = ['auto', 'midjourney', 'stability', 'ideogram', 'openai-generations']

function createDraft(index: number): EditableAdminImageModelConfig {
  const suffix = `${Date.now()}-${index}`
  return {
    key: `admin-${suffix}`,
    label: '',
    labelZh: '',
    tier: 'balanced',
    billingTier: 'balanced',
    endpoint: 'https://',
    providerModel: '',
    apiKeyEnvVar: '',
    supportedSizes: ['1K'],
    defaultSize: '1K',
    providerHint: 'auto',
    enabled: true,
    notes: '',
  }
}

function toEditable(config: AdminImageModelConfig): EditableAdminImageModelConfig {
  return {
    ...config,
    key: config.key,
    labelZh: config.labelZh ?? '',
    notes: config.notes ?? '',
  }
}

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="flex h-10 w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export default function AdminModelConfigCard({
  locale,
  initialConfigs,
}: AdminModelConfigCardProps) {
  const isZh = locale === 'zh'
  const router = useRouter()
  const [drafts, setDrafts] = useState<EditableAdminImageModelConfig[]>(
    initialConfigs.length > 0 ? initialConfigs.map(toEditable) : [createDraft(0)],
  )
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const copy = useMemo(
    () =>
      isZh
        ? {
            title: '管理员模型 API',
            description: '这里配置仅管理员可见的测试模型。普通用户不会拿到这份配置，服务端也会继续拦截非管理员请求。',
            add: '新增测试模型',
            save: '保存模型目录',
            saving: '保存中...',
            remove: '删除',
            enabled: '启用',
            key: '内部别名',
            label: '英文展示名',
            labelZh: '中文展示名',
            tier: '展示档位',
            billingTier: '计费档位',
            endpoint: 'API Endpoint',
            providerModel: '上游模型名',
            apiKeyEnvVar: 'API Key 环境变量名',
            providerHint: '请求提示',
            notes: '备注',
            supportedSizes: '支持尺寸',
            defaultSize: '默认尺寸',
            saved: '管理员模型配置已更新。',
            validationError: '请先补全所有模型的必填字段后再保存。',
            keyHint: '只允许 admin- 开头；会自动规范化。',
          }
        : {
            title: 'Admin Model APIs',
            description: 'Configure test-only models that should appear only for admins. Regular users do not receive this config and the server still blocks non-admin requests.',
            add: 'Add Test Model',
            save: 'Save Model Catalog',
            saving: 'Saving...',
            remove: 'Remove',
            enabled: 'Enabled',
            key: 'Internal Alias',
            label: 'Display Label (EN)',
            labelZh: 'Display Label (ZH)',
            tier: 'Tier',
            billingTier: 'Billing Tier',
            endpoint: 'API Endpoint',
            providerModel: 'Upstream Model',
            apiKeyEnvVar: 'API Key Env Var',
            providerHint: 'Provider Hint',
            notes: 'Notes',
            supportedSizes: 'Supported Sizes',
            defaultSize: 'Default Size',
            saved: 'Admin model config updated.',
            validationError: 'Complete every required field before saving.',
            keyHint: 'Must start with admin-; it will be normalized automatically.',
          },
    [isZh],
  )

  function updateDraft(index: number, patch: Partial<EditableAdminImageModelConfig>) {
    setDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)),
    )
  }

  function addDraft() {
    setSuccessMessage(null)
    setErrorMessage(null)
    setDrafts((current) => [...current, createDraft(current.length)])
  }

  function removeDraft(index: number) {
    setSuccessMessage(null)
    setErrorMessage(null)
    setDrafts((current) => (current.length === 1 ? [createDraft(0)] : current.filter((_, i) => i !== index)))
  }

  async function save() {
    setSuccessMessage(null)
    setErrorMessage(null)

    const normalized = drafts.map((draft) => normalizeAdminImageModelConfig(draft))
    if (normalized.some((item) => item === null)) {
      setErrorMessage(copy.validationError)
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/admin/model-configs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ configs: normalized }),
      })

      if (!response.ok) {
        throw new Error(`REQUEST_FAILED_${response.status}`)
      }

      const payload = (await response.json()) as { configs?: AdminImageModelConfig[] }
      const nextConfigs = Array.isArray(payload.configs) ? payload.configs : []
      setDrafts(nextConfigs.length > 0 ? nextConfigs.map(toEditable) : [createDraft(0)])
      setSuccessMessage(copy.saved)
      router.refresh()
    } catch {
      setErrorMessage(isZh ? '保存失败，请稍后重试。' : 'Save failed. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-border bg-background p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">{copy.title}</h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={addDraft}>
            {copy.add}
          </Button>
          <Button type="button" onClick={save} disabled={isSaving}>
            {isSaving ? copy.saving : copy.save}
          </Button>
        </div>
      </div>

      {errorMessage ? (
        <p className="mt-4 text-sm font-medium text-destructive">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="mt-4 text-sm font-medium text-emerald-700">{successMessage}</p>
      ) : null}

      <div className="mt-5 space-y-4">
        {drafts.map((draft, index) => {
          const normalizedKey = normalizeAdminModelKey(draft.key)
          const availableSizes = draft.supportedSizes.length > 0 ? draft.supportedSizes : ['1K']
          const defaultSize = availableSizes.includes(draft.defaultSize) ? draft.defaultSize : availableSizes[0]

          return (
            <div key={`${draft.key}-${index}`} className="rounded-3xl border border-border/70 bg-muted/20 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {draft.label || draft.labelZh || normalizedKey || `Admin Model ${index + 1}`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.keyHint}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={draft.enabled}
                      onCheckedChange={(checked) => updateDraft(index, { enabled: checked })}
                    />
                    <span className="text-sm text-foreground">{copy.enabled}</span>
                  </div>
                  <Button type="button" variant="ghost" onClick={() => removeDraft(index)}>
                    {copy.remove}
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label>{copy.key}</Label>
                  <Input
                    value={draft.key}
                    onChange={(event) => updateDraft(index, { key: event.target.value })}
                    placeholder="admin-supplier-test"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{copy.label}</Label>
                  <Input
                    value={draft.label}
                    onChange={(event) => updateDraft(index, { label: event.target.value })}
                    placeholder="Vendor Flash"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{copy.labelZh}</Label>
                  <Input
                    value={draft.labelZh}
                    onChange={(event) => updateDraft(index, { labelZh: event.target.value })}
                    placeholder="厂商 Flash"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{copy.apiKeyEnvVar}</Label>
                  <Input
                    value={draft.apiKeyEnvVar}
                    onChange={(event) =>
                      updateDraft(index, {
                        apiKeyEnvVar: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
                      })
                    }
                    placeholder="VENDOR_IMAGE_API_KEY"
                  />
                </div>
                <div className="space-y-2 xl:col-span-2">
                  <Label>{copy.endpoint}</Label>
                  <Input
                    value={draft.endpoint}
                    onChange={(event) => updateDraft(index, { endpoint: event.target.value })}
                    placeholder="https://api.vendor.com/v1/images/edits"
                  />
                </div>
                <div className="space-y-2 xl:col-span-2">
                  <Label>{copy.providerModel}</Label>
                  <Input
                    value={draft.providerModel}
                    onChange={(event) => updateDraft(index, { providerModel: event.target.value })}
                    placeholder="vendor/image-model-preview"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{copy.tier}</Label>
                  <SelectField
                    value={draft.tier}
                    onChange={(value) => updateDraft(index, { tier: value as AdminModelTier })}
                    options={MODEL_TIERS.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{copy.billingTier}</Label>
                  <SelectField
                    value={draft.billingTier}
                    onChange={(value) => updateDraft(index, { billingTier: value as AdminBillingTier })}
                    options={BILLING_TIERS.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{copy.providerHint}</Label>
                  <SelectField
                    value={draft.providerHint}
                    onChange={(value) => updateDraft(index, { providerHint: value as AdminProviderHint })}
                    options={PROVIDER_HINTS.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{copy.defaultSize}</Label>
                  <SelectField
                    value={defaultSize}
                    onChange={(value) => updateDraft(index, { defaultSize: value as AdminImageSize })}
                    options={availableSizes.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <Label>{copy.supportedSizes}</Label>
                <div className="flex flex-wrap gap-4">
                  {IMAGE_SIZES.map((size) => (
                    <label key={size} className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={draft.supportedSizes.includes(size)}
                        onCheckedChange={(checked) => {
                          const nextSizes = checked
                            ? Array.from(new Set([...draft.supportedSizes, size]))
                            : draft.supportedSizes.filter((item) => item !== size)
                          updateDraft(index, {
                            supportedSizes: nextSizes.length > 0 ? nextSizes : ['1K'],
                            defaultSize: nextSizes.includes(draft.defaultSize)
                              ? draft.defaultSize
                              : nextSizes[0] ?? '1K',
                          })
                        }}
                      />
                      <span>{size}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <Label>{copy.notes}</Label>
                <Textarea
                  value={draft.notes}
                  onChange={(event) => updateDraft(index, { notes: event.target.value })}
                  placeholder={isZh ? '例如：用于对比 Vendor X 的图像编辑质量' : 'Example: used to compare Vendor X image-edit quality'}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
