'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import Link from 'next/link'
import type { PersonLite } from '@/lib/people'
import { layoutTree, type TreeLayout } from '@/lib/tree-layout'
import { PersonAvatar } from '@/components/person-avatar'

const CARD_W = 176
const CARD_H = 88
const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.5

type FullPeopleResponse = {
  people: PersonLite[]
  parentLinks: { childId: string; parentId: string }[]
  spouseLinks: { personAId: string; personBId: string; former?: boolean }[]
}

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

export function TreeView() {
  const [data, setData] = useState<FullPeopleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null
  )
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/people?full=1')
        if (!res.ok) throw new Error()
        const json = (await res.json()) as FullPeopleResponse
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setErrored(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const peopleById = useMemo(() => {
    const m = new Map<string, PersonLite>()
    for (const p of data?.people ?? []) m.set(p.id, p)
    return m
  }, [data])

  const layout: TreeLayout | null = useMemo(() => {
    if (!data) return null
    return layoutTree(data.people, data.parentLinks, data.spouseLinks)
  }, [data])

  function resetView() {
    setPan({ x: 40, y: 40 })
    const el = viewportRef.current
    if (el && layout && layout.width > 0 && layout.height > 0) {
      const scale = Math.min(
        (el.clientWidth - 80) / layout.width,
        (el.clientHeight - 80) / layout.height,
        1
      )
      setZoom(clampZoom(scale > 0 ? scale : 1))
    } else {
      setZoom(1)
    }
  }

  function handleWheel(e: ReactWheelEvent) {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((z) => clampZoom(z * factor))
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest('a')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!dragRef.current) return
    const { startX, startY, panX, panY } = dragRef.current
    setPan({ x: panX + (e.clientX - startX), y: panY + (e.clientY - startY) })
  }

  function endDrag() {
    dragRef.current = null
    setDragging(false)
  }

  if (loading) return <p className="text-xl">Loading…</p>
  if (errored)
    return <p className="text-lg text-red-700">Couldn&apos;t load the tree — refresh to try again.</p>
  if (!data || data.people.length === 0 || !layout)
    return (
      <p className="text-xl">No one here yet — add the first family member to start the tree.</p>
    )

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setZoom((z) => clampZoom(z * 1.2))}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-ink/25 bg-surface text-xl hover:bg-wash"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => clampZoom(z / 1.2))}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-ink/25 bg-surface text-xl hover:bg-wash"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          className="flex h-11 items-center rounded-lg border border-ink/25 bg-surface px-4 text-lg hover:bg-wash"
        >
          Fit
        </button>
      </div>
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className={`relative h-[70vh] w-full overflow-hidden rounded-xl border bg-wash/50 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ touchAction: 'none' }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={layout.width}
            height={layout.height}
          >
            {layout.edges
              .filter((edge): edge is Extract<typeof edge, { kind: 'spouse' }> => edge.kind === 'spouse')
              .map((edge, i) => {
                const a = layout.nodes.find((n) => n.id === edge.a)
                const b = layout.nodes.find((n) => n.id === edge.b)
                if (!a || !b) return null
                return (
                  <line
                    key={`s-${i}`}
                    x1={a.x + CARD_W}
                    y1={a.y + CARD_H / 2}
                    x2={b.x}
                    y2={b.y + CARD_H / 2}
                    stroke="#6a594b88"
                    strokeWidth={2}
                    strokeDasharray={edge.former ? '6 6' : undefined}
                  />
                )
              })}

            {layout.connectors.map((connector) => {
              const key = `${connector.parentIds.join('+')}>${connector.childIds.join('+')}`
              return (
                <g key={key}>
                  {connector.parentDrops.map((seg, i) => (
                    <line
                      key={`drop-${i}`}
                      x1={seg.x}
                      y1={seg.y1}
                      x2={seg.x}
                      y2={seg.y2}
                      stroke="#6a594b88"
                      strokeWidth={2}
                    />
                  ))}
                  <line
                    x1={connector.rail.x1}
                    y1={connector.rail.y}
                    x2={connector.rail.x2}
                    y2={connector.rail.y}
                    stroke="#6a594b88"
                    strokeWidth={2}
                  />
                  {connector.childRisers.map((seg, i) => (
                    <line
                      key={`riser-${i}`}
                      x1={seg.x}
                      y1={seg.y1}
                      x2={seg.x}
                      y2={seg.y2}
                      stroke="#6a594b88"
                      strokeWidth={2}
                    />
                  ))}
                </g>
              )
            })}
          </svg>

          {layout.nodes.map((node) => {
            const person = peopleById.get(node.id)
            if (!person) return null
            return (
              <Link
                key={node.id}
                href={`/people/${node.id}`}
                className="absolute flex items-center gap-2 overflow-hidden rounded-xl border bg-surface p-2 shadow-sm hover:bg-wash"
                style={{ left: node.x, top: node.y, width: CARD_W, height: CARD_H }}
              >
                <PersonAvatar person={person} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{person.displayName}</p>
                  <p className="truncate text-sm text-ink-soft">
                    {person.birthYear ?? '?'}
                    {person.deathYear ? `–${person.deathYear}` : ''}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
