'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { AlbumDTO } from '@/lib/albums'
import type { MediaItemDTO } from '@/lib/media'
import { AlbumForm } from '@/components/album-form'

function AlbumItemTile({
  item,
  isCover,
  menuOpen,
  onToggleMenu,
  onRemove,
  onMakeCover,
}: {
  item: MediaItemDTO
  isCover: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onRemove: () => void
  onMakeCover: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="relative aspect-square touch-none select-none overflow-hidden rounded-xl bg-wash"
    >
      {item.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbUrl}
          alt={item.title ?? item.originalFilename}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="flex h-full items-center justify-center p-2 text-center text-base text-ink-soft">
          {item.status === 'FAILED' ? 'Failed' : 'Processing…'}
        </span>
      )}

      {isCover && (
        <span className="absolute left-2 top-2 rounded-md bg-amber-deep px-2 py-0.5 text-sm font-semibold text-white shadow">
          Cover
        </span>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleMenu()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Item actions"
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-surface/95 text-xl leading-none shadow"
      >
        ⋮
      </button>

      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-2 top-14 z-10 grid min-w-[12rem] gap-1 rounded-xl border bg-surface p-2 shadow-lg"
        >
          <button
            type="button"
            onClick={onMakeCover}
            className="rounded-lg px-4 py-2.5 text-left text-lg hover:bg-wash"
          >
            Make cover
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg px-4 py-2.5 text-left text-lg text-red-700 hover:bg-wash"
          >
            Remove from album
          </button>
        </div>
      )}
    </div>
  )
}

function AddPhotosModal({
  albumId,
  existingIds,
  onClose,
  onAdded,
}: {
  albumId: string
  existingIds: Set<string>
  onClose: () => void
  onAdded: (item: MediaItemDTO) => void
}) {
  const [items, setItems] = useState<MediaItemDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/media?limit=100')
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setItems(data.items)
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

  async function addItem(item: MediaItemDTO) {
    setAddingId(item.id)
    try {
      const res = await fetch(`/api/albums/${albumId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: item.id }),
      })
      if (res.ok || res.status === 409) {
        setAdded((prev) => new Set(prev).add(item.id))
        if (res.ok) onAdded(item)
      }
    } catch {
      // ignore — user can retry
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Add photos</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-ink/25 bg-surface px-5 py-2.5 text-lg hover:bg-wash"
          >
            Close
          </button>
        </div>
        {loading && <p className="text-xl">Loading…</p>}
        {errored && <p className="text-lg text-red-700">Couldn&apos;t load photos — try again.</p>}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => {
            const isMember = existingIds.has(item.id) || added.has(item.id)
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => !isMember && addItem(item)}
                disabled={isMember || addingId === item.id}
                className="relative aspect-square overflow-hidden rounded-xl bg-wash disabled:opacity-70"
              >
                {item.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbUrl}
                    alt={item.title ?? item.originalFilename}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center p-1 text-center text-xs">
                    {item.status === 'FAILED' ? 'Failed' : 'Processing…'}
                  </span>
                )}
                {isMember && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-3xl text-white">
                    ✓
                  </span>
                )}
                {addingId === item.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
                    Adding…
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function AlbumDetail({ album, items }: { album: AlbumDTO; items: MediaItemDTO[] }) {
  const router = useRouter()
  const [orderedItems, setOrderedItems] = useState(items)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [editingHeader, setEditingHeader] = useState(false)
  const [showAddPhotos, setShowAddPhotos] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrderedItems(items)
  }, [items])

  useEffect(() => {
    if (!openMenuId) return
    function onDocClick() {
      setOpenMenuId(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [openMenuId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedItems.findIndex((i) => i.id === active.id)
    const newIndex = orderedItems.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const previous = orderedItems
    const next = arrayMove(orderedItems, oldIndex, newIndex)
    setOrderedItems(next)
    setOrderError('')
    try {
      const res = await fetch(`/api/albums/${album.id}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedMediaIds: next.map((i) => i.id) }),
      })
      if (!res.ok) {
        setOrderedItems(previous)
        setOrderError("Couldn't save the new order — try again.")
      }
    } catch {
      setOrderedItems(previous)
      setOrderError("Couldn't save — check your connection and try again.")
    }
  }

  async function removeItem(mediaId: string) {
    setOpenMenuId(null)
    const previous = orderedItems
    setOrderedItems((prev) => prev.filter((i) => i.id !== mediaId))
    setActionError('')
    try {
      const res = await fetch(`/api/albums/${album.id}/items?mediaId=${mediaId}`, { method: 'DELETE' })
      if (!res.ok) {
        setOrderedItems(previous)
        setActionError("Couldn't remove that item — try again.")
      }
    } catch {
      setOrderedItems(previous)
      setActionError("Couldn't save — check your connection and try again.")
    }
  }

  async function makeCover(mediaId: string) {
    setOpenMenuId(null)
    setActionError('')
    try {
      const res = await fetch(`/api/albums/${album.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverMediaId: mediaId }),
      })
      if (res.ok) router.refresh()
      else setActionError("Couldn't set cover — try again.")
    } catch {
      setActionError("Couldn't save — check your connection and try again.")
    }
  }

  async function deleteAlbum() {
    if (!confirm(`Delete "${album.name}"? This can't be undone.`)) return
    try {
      const res = await fetch(`/api/albums/${album.id}`, { method: 'DELETE' })
      if (res.ok) router.push('/albums')
      else setActionError("Couldn't delete this album — try again.")
    } catch {
      setActionError("Couldn't save — check your connection and try again.")
    }
  }

  const existingIds = new Set(orderedItems.map((i) => i.id))

  return (
    <div>
      <div className="mb-6">
        {editingHeader ? (
          <AlbumForm album={album} onSaved={() => setEditingHeader(false)} onCancel={() => setEditingHeader(false)} />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">{album.name}</h1>
              {album.description && <p className="mt-2 text-lg text-ink-soft">{album.description}</p>}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditingHeader(true)}
                className="rounded-xl border border-ink/25 bg-surface px-5 py-3 text-lg hover:bg-wash"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={deleteAlbum}
                className="rounded-xl border border-red-700 bg-surface px-5 py-3 text-lg text-red-700 hover:bg-red-100"
              >
                Delete album
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-lg text-ink-soft">
          {orderedItems.length} {orderedItems.length === 1 ? 'item' : 'items'}
        </p>
        <button
          type="button"
          onClick={() => setShowAddPhotos(true)}
          className="rounded-xl bg-ink px-6 py-3 text-lg font-medium text-paper hover:bg-sepia"
        >
          Add photos
        </button>
      </div>

      {orderError && <p className="mb-4 text-lg text-red-700">{orderError}</p>}
      {actionError && <p className="mb-4 text-lg text-red-700">{actionError}</p>}

      {orderedItems.length === 0 ? (
        <p className="text-xl">
          This album is empty so far — tap &ldquo;Add photos&rdquo; to start filling it.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedItems.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {orderedItems.map((item) => (
                <AlbumItemTile
                  key={item.id}
                  item={item}
                  isCover={item.id === album.coverMediaId}
                  menuOpen={openMenuId === item.id}
                  onToggleMenu={() => setOpenMenuId((prev) => (prev === item.id ? null : item.id))}
                  onRemove={() => removeItem(item.id)}
                  onMakeCover={() => makeCover(item.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {showAddPhotos && (
        <AddPhotosModal
          albumId={album.id}
          existingIds={existingIds}
          onClose={() => setShowAddPhotos(false)}
          onAdded={(item) => setOrderedItems((prev) => [...prev, item])}
        />
      )}
    </div>
  )
}
