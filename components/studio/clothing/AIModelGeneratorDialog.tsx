'use client'

import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { generateModelImage } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { GenerationJob } from '@/types'
import type { UploadedImage } from '@/components/upload/MultiImageUploader'
import { Loader2 } from 'lucide-react'

function uid() {
  return crypto.randomUUID()
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
    signal.addEventListener('abort', () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true })
    const channel = supabase.channel(`wait:${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` }, (p) => {
        const job = p.new as GenerationJob
        if (job.status === 'success') done(job)
        else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      }).subscribe()
    void checkOnce()
    pollTimer = setInterval(() => { void checkOnce() }, 2000)
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
  const [gender, setGender] = useState('female')
  const [ageRange, setAgeRange] = useState('18-25')
  const [skinColor, setSkinColor] = useState('medium')
  const [count, setCount] = useState([1])
  const [turboEnabled, setTurboEnabled] = useState(false)
  const [otherRequirements, setOtherRequirements] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const productImageUrls = productImages.map((img) => img.previewUrl)
      const { job_id } = await generateModelImage({
        gender,
        ageRange,
        skinColor,
        otherRequirements,
        productImages: productImageUrls,
        count: count[0],
        turboEnabled,
        trace_id: uid(),
        client_job_id: uid(),
        fe_attempt: 1,
      })

      const job = await waitForJob(job_id, abort.signal)

      if (job.result_url) {
        // Convert result URL to UploadedImage format
        const response = await fetch(job.result_url)
        const blob = await response.blob()
        const file = new File([blob], 'ai-model.png', { type: 'image/png' })
        onGenerate([{ file, previewUrl: job.result_url }])
        onOpenChange(false)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message ?? '生成失败')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>AI生成模特</DialogTitle>
          <DialogDescription>根据您的需求生成专业模特形象</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>性别</Label>
            <RadioGroup value={gender} onValueChange={setGender}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="male" id="gender-male" />
                <Label htmlFor="gender-male" className="font-normal cursor-pointer">男性</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="female" id="gender-female" />
                <Label htmlFor="gender-female" className="font-normal cursor-pointer">女性</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>年龄段</Label>
            <Select value={ageRange} onValueChange={setAgeRange}>
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
            <Label>肤色</Label>
            <Select value={skinColor} onValueChange={setSkinColor}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">浅色</SelectItem>
                <SelectItem value="medium">中等</SelectItem>
                <SelectItem value="dark">深色</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>生成数量: {count[0]}</Label>
            <Slider
              value={count}
              onValueChange={setCount}
              min={1}
              max={4}
              step={1}
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="model-turbo" checked={turboEnabled} onCheckedChange={setTurboEnabled} />
            <Label htmlFor="model-turbo" className="cursor-pointer">Turbo加速</Label>
          </div>

          <div className="space-y-2">
            <Label>其他需求</Label>
            <Textarea
              value={otherRequirements}
              onChange={(e) => setOtherRequirements(e.target.value)}
              placeholder="例如：穿着正装、微笑表情等..."
              rows={3}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            取消
          </Button>
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isGenerating ? '生成中...' : '开始生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
