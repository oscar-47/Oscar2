'use client'

import type { CSSProperties } from 'react'

const PORTRAIT_BASE_WIDTH_PX = 220
const LANDSCAPE_BASE_HEIGHT_PX = 220
const LANDSCAPE_MAX_WIDTH_PX = 420

function parseAspectRatio(aspectRatio: string): { width: number; height: number } | null {
  const parts = aspectRatio
    .split(/[:/]/)
    .map((value) => Number(value.trim()))

  if (parts.length !== 2) return null
  const [width, height] = parts
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

export function toCssAspectRatio(aspectRatio: string): string {
  const parsed = parseAspectRatio(aspectRatio)
  if (!parsed) return '4 / 3'
  return `${parsed.width} / ${parsed.height}`
}

export function getAspectRatioCardStyle(aspectRatio: string): CSSProperties {
  const parsed = parseAspectRatio(aspectRatio)
  if (!parsed) {
    return {
      aspectRatio: '4 / 3',
      width: `min(100%, ${PORTRAIT_BASE_WIDTH_PX}px)`,
    }
  }

  const ratio = parsed.width / parsed.height
  if (ratio >= 1) {
    const widthPx = Math.min(Math.round(LANDSCAPE_BASE_HEIGHT_PX * ratio), LANDSCAPE_MAX_WIDTH_PX)
    return {
      aspectRatio: `${parsed.width} / ${parsed.height}`,
      width: `min(100%, ${widthPx}px)`,
    }
  }

  return {
    aspectRatio: `${parsed.width} / ${parsed.height}`,
    width: `min(100%, ${PORTRAIT_BASE_WIDTH_PX}px)`,
  }
}
