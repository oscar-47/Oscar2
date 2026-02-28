import { cn } from '@/lib/utils'

interface SectionIconProps {
  icon: React.ComponentType<{ className?: string }>
  className?: string
}

export function SectionIcon({ icon: Icon, className }: SectionIconProps) {
  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]',
        className
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
  )
}
