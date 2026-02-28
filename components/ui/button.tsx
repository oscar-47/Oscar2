import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-2xl font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
          variant === 'default' && 'bg-primary text-primary-foreground hover:opacity-90',
          variant === 'secondary' && 'bg-secondary text-secondary-foreground hover:opacity-90',
          variant === 'outline' && 'border border-border bg-background hover:bg-muted',
          variant === 'ghost' && 'hover:bg-muted',
          variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:opacity-90',
          size === 'sm' && 'h-8 rounded-xl px-3 text-sm',
          size === 'md' && 'h-10 rounded-2xl px-4 text-sm',
          size === 'lg' && 'h-11 rounded-3xl px-6 text-base',
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'
