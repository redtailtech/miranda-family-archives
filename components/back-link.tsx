'use client'

import { useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'

/**
 * A back link that returns to the page the viewer actually came from
 * (preserving library filters, scroll, etc. via history) and falls back to a
 * plain navigation when there's no in-app history — e.g. a photo opened
 * directly from a digest email link.
 */
export function BackLink({ fallback, label }: { fallback: string; label: string }) {
  const router = useRouter()

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Only intercept plain left-clicks; modified clicks (new tab, etc.) keep
    // normal link behavior on the fallback href.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return
    if (document.referrer.startsWith(window.location.origin)) {
      e.preventDefault()
      router.back()
    }
  }

  return (
    <a href={fallback} onClick={handleClick} className="text-lg underline">
      {label}
    </a>
  )
}
