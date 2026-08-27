'use client'

import { useState, type ReactNode } from 'react'

const TABS = ['Details', 'Advanced', 'History'] as const

export function DetailTabs({ details, advanced, history }: { details: ReactNode; advanced: ReactNode; history: ReactNode }) {
  const [active, setActive] = useState<(typeof TABS)[number]>('Details')
  const panels = { Details: details, Advanced: advanced, History: history }
  return (
    <div className="mt-8">
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={`rounded-t-lg px-5 py-3 text-lg ${active === tab ? 'border border-b-0 bg-white font-semibold' : 'text-black/60 hover:bg-black/5'}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="py-6">{panels[active]}</div>
    </div>
  )
}
