const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function formatRelativeDayLabel(
  value: string | Date,
  locale: string,
) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return locale.startsWith('zh') ? '今天' : 'today'
  }

  const now = startOfDay(new Date())
  const target = startOfDay(date)
  const diffDays = Math.round((target.getTime() - now.getTime()) / DAY_MS)
  const safeDiff = Math.min(0, diffDays)
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  })

  return formatter.format(safeDiff, 'day')
}
