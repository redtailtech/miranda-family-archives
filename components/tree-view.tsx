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
  spouseLinks: { personAId: string; personBId: string }[]
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
    return <p className="text-xl">No people yet — add the first family member.</p>

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setZoom((z) => clampZoom(z * 1.2))}
          className="rounded-lg border px-3 py-2 text-lg"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => clampZoom(z / 1.2))}
          className="rounded-lg border px-3 py-2 text-lg"
          aria-label="Zoom out"
        >
          −
        </button>
        <button type="button" onClick={resetView} className="rounded-lg border px-3 py-2 text-lg">
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
        className={`relative h-[70vh] w-full overflow-hidden rounded-xl border bg-black/[0.02] ${
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
            {layout.edges.map((edge, i) => {
              if (edge.kind === 'spouse') {
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
                    stroke="#00000055"
                    strokeWidth={2}
                  />
                )
              }
              const from = layout.nodes.find((n) => n.id === edge.from)
              const to = layout.nodes.find((n) => n.id === edge.to)
              if (!from || !to) return null
              const startX = from.x + CARD_W / 2
              const startY = from.y + CARD_H
              const endX = to.x + CARD_W / 2
              const endY = to.y
              const midY = (startY + endY) / 2
              return (
                <path
                  key={`p-${i}`}
                  d={`M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`}
                  fill="none"
                  stroke="#00000055"
                  strokeWidth={2}
                />
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
                className="absolute flex items-center gap-2 overflow-hidden rounded-xl border bg-white p-2 shadow-sm hover:bg-black/5"
                style={{ left: node.x, top: node.y, width: CARD_W, height: CARD_H }}
              >
                <PersonAvatar person={person} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{person.displayName}</p>
                  <p className="truncate text-sm text-black/60">
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
