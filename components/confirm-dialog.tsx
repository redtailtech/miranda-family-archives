'use client'

import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export type ConfirmOptions = {
  title: string
  body?: string
  actionLabel: string
  cancelLabel?: string
  destructive?: boolean
}

type PendingConfirm = ConfirmOptions & {
  resolve: (value: boolean) => void
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

/**
 * Replaces native `confirm()` (silently suppressed by some browsers, which
 * was the root cause of "delete does nothing") with an in-page AlertDialog.
 * Requests queue — each `confirm()` call resolves only once its dialog is
 * dismissed, so sequential awaited calls (e.g. the uploader's per-file loop)
 * are shown one at a time in order.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = React.useState<PendingConfirm[]>([])
  const pendingResultRef = React.useRef(false)

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setQueue((prev) => [...prev, { ...opts, resolve }])
    })
  }, [])

  const current = queue[0]

  function handleOpenChange(open: boolean) {
    if (open || !current) return
    // Fires after any onClick below has recorded the outcome (Action/Cancel
    // resolve via Radix's own Close, which composes onClick before
    // onOpenChange); Escape leaves pendingResultRef at its false default.
    current.resolve(pendingResultRef.current)
    pendingResultRef.current = false
    setQueue((prev) => prev.slice(1))
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <AlertDialog open onOpenChange={handleOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{current.title}</AlertDialogTitle>
              {current.body && <AlertDialogDescription>{current.body}</AlertDialogDescription>}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => (pendingResultRef.current = false)}>
                {current.cancelLabel ?? 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                variant={current.destructive ? 'destructive' : 'default'}
                onClick={() => (pendingResultRef.current = true)}
              >
                {current.actionLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}
