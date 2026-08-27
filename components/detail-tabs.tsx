'use client'

import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['Details', 'Advanced', 'History'] as const

export function DetailTabs({ details, advanced, history }: { details: ReactNode; advanced: ReactNode; history: ReactNode }) {
  const panels = { Details: details, Advanced: advanced, History: history }
  return (
    <Tabs defaultValue="Details" className="mt-8">
      <TabsList className="w-full justify-start gap-1 rounded-none border-b bg-transparent p-0 group-data-horizontal/tabs:h-auto">
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab}
            value={tab}
            className="rounded-t-lg rounded-b-none border border-b-0 border-transparent px-5 py-3 text-lg font-normal text-black/60 shadow-none hover:bg-black/5 data-active:border-border data-active:bg-white data-active:font-semibold data-active:text-foreground data-active:shadow-none"
          >
            {tab}
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((tab) => (
        <TabsContent key={tab} value={tab} className="py-6 text-lg">
          {panels[tab]}
        </TabsContent>
      ))}
    </Tabs>
  )
}
