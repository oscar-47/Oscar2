'use client'

import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { generateModelImage } from '@/lib/api/edge-functions'
import { uploadFile } from '@/lib/api/upload'
import { createClient } from '@/lib/supabase/client'
import type { GenerationJob } from '@/types'
import type { UploadedImage } from '@/components/upload/MultiImageUploader'
import type { AIModelHistoryItem } from './types'
import { Loader2, Clock3, UserCircle2, Sparkles } from 'lucide-react'

type Gender = 'female' | 'male'
type AgeRange = '18-25' | '26-35' | '36-45' | '46-60' | '60+'
type Ethnicity = 'asian' | 'white' | 'black' | 'latino'
type DialogState = 'idle' | 'generating' | 'ready' | 'error'

type PreviewItem = {
  id: string
  jobId: string
  resultUrl: string | null
  status: 'success' | 'failed'
  errorMessage: string | null
}

type ModelHistoryRow = {
  id: string
  job_id: string
  gender: string
  age_range: string
  skin_color: string
  status: 'processing' | 'success' | 'failed' | null
  result_url: string | null
  error_message: string | null
  created_at: string
}

function uid() {
  return crypto.randomUUID()
}

function genderLabel(value: Gender): string {
  return value === 'male' ? '男性' : '女性'
}

function ageLabel(value: AgeRange): string {
  if (value === '60+') return '60岁以上'
  return `${value}岁`
}

function ethnicityLabel(value: Ethnicity): string {
  if (value === 'asian') return '亚洲人'
  if (value === 'white') return '白人'
  if (value === 'black') return '黑人'
  return '拉丁裔'
}

function normalizeGender(value: string): Gender {
  const v = value.trim().toLowerCase()
  if (v === 'male' || value.includes('男性')) return 'male'
  return 'female'
}

function normalizeAgeRange(value: string): AgeRange {
  const v = value.trim()
  if (v === '18-25') return '18-25'
  if (v === '26-35') return '26-35'
  if (v === '36-45') return '36-45'
  if (v === '46-60') return '46-60'
  if (v === '60+') return '60+'
  return '26-35'
}

function normalizeEthnicity(value: string): Ethnicity {
  const v = value.trim().toLowerCase()
  if (v === 'asian' || value.includes('亚洲')) return 'asian'
  if (v === 'white' || value.includes('白')) return 'white'
  if (v === 'black' || value.includes('黑')) return 'black'
  if (v === 'latino' || value.includes('拉丁')) return 'latino'
  return 'asian'
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '刚刚'
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`
  return `${Math.floor(sec / 86400)}天前`
}

function mapHistoryRow(row: ModelHistoryRow): AIModelHistoryItem {
  return {
    id: row.id,
    jobId: row.job_id,
    gender: normalizeGender(row.gender),
    ageRange: normalizeAgeRange(row.age_range),
    ethnicity: normalizeEthnicity(row.skin_color),
    resultUrl: row.result_url,
    status: row.status ?? 'processing',
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }
}

function waitForJob(jobId: string, signal: AbortSignal): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer)
      supabase.removeChannel(channel)
    }

    function done(job: GenerationJob) {
      if (settled) return
      settled = true
      cleanup()
      resolve(job)
    }

    function fail(err: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    async function checkOnce() {
      const { data } = await supabase.from('generation_jobs').select('*').eq('id', jobId).single()
      if (!data) return
      const job = data as GenerationJob
      if (job.status === 'success') done(job)
      else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
    }

    signal.addEventListener(
      'abort',
      () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
      { once: true }
    )

    const channel = supabase
      .channel(`wait:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const job = payload.new as GenerationJob
          if (job.status === 'success') done(job)
          else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
        }
      )
      .subscribe()

    void checkOnce()
    pollTimer = setInterval(() => {
      void checkOnce()
    }, 1500)
  })
}

interface AIModelGeneratorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (modelImages: UploadedImage[]) => void
  productImages: UploadedImage[]
}

export function AIModelGeneratorDialog({
  open,
  onOpenChange,
  onGenerate,
  productImages,
}: AIModelGeneratorDialogProps) {
  const [gender, setGender] = useState<Gender>('female')
  const [ageRange, setAgeRange] = useState<AgeRange>('26-35')
  const [ethnicity, setEthnicity] = useState<Ethnicity>('asian')
  const [count, setCount] = useState<1 | 2 | 3 | 4>(2)
  const [otherRequirements, setOtherRequirements] = useState('')
  const [dialogState, setDialogState] = useState<DialogState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [historyItems, setHistoryItems] = useState<AIModelHistoryItem[]>([])
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const isGenerating = dialogState === 'generating'

  async function loadHistory(silent = true) {
    setIsHistoryLoading(true)
    const supabase = createClient()
    const { data, error: queryError } = await supabase
      .from('model_generation_history')
      .select('id,job_id,gender,age_range,skin_color,status,result_url,error_message,created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    setIsHistoryLoading(false)

    if (queryError) {
      if (!silent) setError(queryError.message ?? '加载生成历史失败')
      return
    }

    const rows = (data ?? []) as ModelHistoryRow[]
    setHistoryItems(rows.map(mapHistoryRow))
  }

  useEffect(() => {
    if (!open) return
    setGender('female')
    setAgeRange('26-35')
    setEthnicity('asian')
    setCount(2)
    setOtherRequirements('')
    setDialogState('idle')
    setError(null)
    setPreviewItems([])
    setSelectedImageUrl(null)
    void loadHistory(true)
  }, [open])

  const handleGenerate = async () => {
    if (productImages.length < 1) {
      setError('请先上传至少1张产品图片')
      return
    }

    setDialogState('generating')
    setError(null)
    setPreviewItems([])
    setSelectedImageUrl(null)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const { publicUrl: uploadedProductUrl } = await uploadFile(productImages[0].file)
      const tasks = Array.from({ length: count }, async (_, index) => {
        const { job_id } = await generateModelImage({
          gender,
          ageRange,
          ethnicity,
          otherRequirements: otherRequirements.trim() || undefined,
          count: 1,
          imageCount: 1,
          turboEnabled: false,
          productImage: uploadedProductUrl,
          trace_id: uid(),
          client_job_id: uid(),
          fe_attempt: index + 1,
        })
        const job = await waitForJob(job_id, abort.signal)
        return {
          id: uid(),
          jobId: job_id,
          resultUrl: job.result_url,
          status: job.status === 'success' ? 'success' : 'failed',
          errorMessage: job.error_message ?? null,
        } as PreviewItem
      })

      const settled = await Promise.allSettled(tasks)
      const results: PreviewItem[] = settled.map((item) => {
        if (item.status === 'fulfilled') return item.value
        return {
          id: uid(),
          jobId: uid(),
          resultUrl: null,
          status: 'failed',
          errorMessage: item.reason instanceof Error ? item.reason.message : '生成失败',
        }
      })

      setPreviewItems(results)
      const firstSuccess = results.find((item) => item.status === 'success' && item.resultUrl)
      if (firstSuccess?.resultUrl) {
        setSelectedImageUrl(firstSuccess.resultUrl)
        setDialogState('ready')
      } else {
        setDialogState('error')
        setError('本次生成失败，请重试')
      }

      void loadHistory(true)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setDialogState('error')
      setError((err as Error).message ?? '生成失败')
    }
  }

  const handleUseSelected = async () => {
    if (!selectedImageUrl) return
    setIsApplying(true)
    setError(null)

    try {
      const response = await fetch(selectedImageUrl)
      if (!response.ok) throw new Error('无法读取选中的模特图')
      const blob = await response.blob()
      const file = new File([blob], `ai-model-${Date.now()}.png`, { type: blob.type || 'image/png' })
      onGenerate([{ file, previewUrl: selectedImageUrl }])
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message ?? '使用模特失败')
    } finally {
      setIsApplying(false)
    }
  }

  const handleDialogOpenChange = (next: boolean) => {
    if (!next) abortRef.current?.abort()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="w-[96vw] max-w-6xl gap-0 overflow-hidden p-0">
        <div className="border-b px-6 py-4">
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5" />
            AI 生成模特图
          </h2>
        </div>

        <div className="flex max-h-[76vh] min-h-[620px] flex-col lg:flex-row">
          <div className="flex w-full flex-col border-b p-6 lg:w-3/5 lg:border-b-0 lg:border-r">
            <div className="flex-1 space-y-5 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>性别</Label>
                  <Select value={gender} onValueChange={(v) => setGender(v as Gender)} disabled={isGenerating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">女性</SelectItem>
                      <SelectItem value="male">男性</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>年龄</Label>
                  <Select value={ageRange} onValueChange={(v) => setAgeRange(v as AgeRange)} disabled={isGenerating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="18-25">18-25岁</SelectItem>
                      <SelectItem value="26-35">26-35岁</SelectItem>
                      <SelectItem value="36-45">36-45岁</SelectItem>
                      <SelectItem value="46-60">46-60岁</SelectItem>
                      <SelectItem value="60+">60岁以上</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>人群</Label>
                  <Select value={ethnicity} onValueChange={(v) => setEthnicity(v as Ethnicity)} disabled={isGenerating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asian">亚洲人</SelectItem>
                      <SelectItem value="white">白人</SelectItem>
                      <SelectItem value="black">黑人</SelectItem>
                      <SelectItem value="latino">拉丁裔</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>模特的其他需求</Label>
                <Textarea
                  value={otherRequirements}
                  onChange={(e) => setOtherRequirements(e.target.value)}
                  placeholder="可选：添加具体要求如姿势、表情、发型等..."
                  rows={3}
                  disabled={isGenerating}
                />
              </div>

              <div className="flex items-center gap-3">
                <Label className="min-w-16">生成张数</Label>
                <Select value={String(count)} onValueChange={(v) => setCount(Number(v) as 1 | 2 | 3 | 4)} disabled={isGenerating}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1张</SelectItem>
                    <SelectItem value="2">2张</SelectItem>
                    <SelectItem value="3">3张</SelectItem>
                    <SelectItem value="4">4张</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Turbo 加速模式</p>
                    <p className="text-xs text-muted-foreground">共振、稳定</p>
                  </div>
                  <Switch checked={false} disabled />
                </div>
              </div>

              <div>
                <Button
                  className="h-11 w-full bg-zinc-900 text-base text-white hover:bg-zinc-800"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {isGenerating ? '生成中...' : '立即生成'}
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">消耗 {count * 6} 积分</p>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2 pt-2">
                <Label>预览</Label>
                {dialogState === 'idle' && (
                  <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed bg-muted/10">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <UserCircle2 className="h-12 w-12" />
                      <p className="text-sm">暂无预览</p>
                    </div>
                  </div>
                )}

                {dialogState === 'generating' && (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: count }).map((_, i) => (
                      <div key={`sk-${i}`} className="aspect-[4/5] animate-pulse rounded-xl bg-muted" />
                    ))}
                  </div>
                )}

                {(dialogState === 'ready' || dialogState === 'error') && (
                  <div className="grid grid-cols-2 gap-3">
                    {previewItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          if (item.resultUrl && item.status === 'success') setSelectedImageUrl(item.resultUrl)
                        }}
                        className={`relative overflow-hidden rounded-xl border text-left ${
                          item.resultUrl && selectedImageUrl === item.resultUrl
                            ? 'border-zinc-900 ring-2 ring-zinc-900/20'
                            : 'border-border'
                        }`}
                        disabled={!item.resultUrl || item.status !== 'success'}
                      >
                        {item.resultUrl && item.status === 'success' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.resultUrl} alt="model-preview" className="aspect-[4/5] w-full object-cover" />
                        ) : (
                          <div className="flex aspect-[4/5] items-center justify-center bg-destructive/5 px-3 text-xs text-destructive">
                            {item.errorMessage ?? '生成失败'}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col p-6 lg:w-2/5">
            <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Clock3 className="h-4 w-4" />
              生成历史
            </div>
            <div className="flex-1 overflow-y-auto pr-1">
              {isHistoryLoading && (
                <p className="text-sm text-muted-foreground">加载中...</p>
              )}

              {!isHistoryLoading && historyItems.length === 0 && (
                <div className="flex h-full min-h-[220px] items-center justify-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Clock3 className="h-8 w-8 opacity-40" />
                    <p className="text-sm">暂无生成记录</p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {historyItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!item.resultUrl}
                    onClick={() => item.resultUrl && setSelectedImageUrl(item.resultUrl)}
                    className={`flex w-full gap-3 rounded-xl border p-2 text-left transition-colors ${
                      item.resultUrl && selectedImageUrl === item.resultUrl
                        ? 'border-zinc-900 bg-zinc-100'
                        : 'border-transparent hover:bg-muted/40'
                    }`}
                  >
                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                      {item.resultUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.resultUrl} alt="history-model" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          {item.status === 'failed' ? '失败' : '处理中'}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {genderLabel(item.gender)}, {ageLabel(item.ageRange)}, {ethnicityLabel(item.ethnicity)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(item.createdAt)}</p>
                      {item.status === 'failed' && (
                        <p className="mt-1 truncate text-xs text-destructive">{item.errorMessage ?? '生成失败'}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => handleDialogOpenChange(false)}
            disabled={isGenerating || isApplying}
          >
            取消
          </Button>
          <Button
            className="h-10 min-w-44 bg-zinc-900 text-white hover:bg-zinc-800"
            onClick={handleUseSelected}
            disabled={!selectedImageUrl || isGenerating || isApplying}
          >
            {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            使用选中的模特
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
