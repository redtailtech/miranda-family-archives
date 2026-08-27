'use client'

import { useEffect, useState } from 'react'

type Comment = {
  id: string
  body: string
  user: { id: string; name: string }
  createdAt: string
  canDelete: boolean
}

export function CommentThread({ mediaId }: { mediaId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(false)
      try {
        const res = await fetch(`/api/media/${mediaId}/comments`)
        if (!res.ok) {
          if (!cancelled) setLoadError(true)
          return
        }
        const data = await res.json()
        if (!cancelled) setComments(Array.isArray(data.comments) ? data.comments : [])
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [mediaId])

  async function addComment() {
    const trimmed = body.trim()
    if (!trimmed || posting) return
    setPosting(true)
    setPostError('')
    try {
      const res = await fetch(`/api/media/${mediaId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      if (res.ok) {
        const data = await res.json()
        setComments((prev) => [...prev, data.comment])
        setBody('')
      } else {
        let msg = `HTTP ${res.status}`
        try {
          msg = (await res.json()).error ?? msg
        } catch {}
        setPostError(msg)
      }
    } catch {
      setPostError("Couldn't post — check your connection and try again.")
    } finally {
      setPosting(false)
    }
  }

  async function deleteComment(id: string) {
    if (deletingId) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== id))
      }
    } catch {
      // leave the comment in place on failure
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="grid gap-4">
      {loading && <p className="text-lg">Loading comments…</p>}
      {loadError && (
        <p className="text-lg text-red-700">Couldn&apos;t load comments — refresh to try again.</p>
      )}
      {!loading && !loadError && comments.length === 0 && (
        <p className="text-lg">No comments yet — share a memory.</p>
      )}
      {!loading && !loadError && comments.length > 0 && (
        <ul className="grid gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.user.name}</span>
                <span className="text-sm text-black/60">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-lg">{c.body}</p>
              {c.canDelete && (
                <button
                  type="button"
                  onClick={() => deleteComment(c.id)}
                  disabled={deletingId === c.id}
                  className="mt-2 text-red-700 underline disabled:opacity-50"
                >
                  {deletingId === c.id ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          addComment()
        }}
      >
        <label className="grid gap-1 text-lg">
          Add a comment
          <textarea
            className="w-full rounded-lg border px-4 py-3 text-lg"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share a memory or story about this photo"
          />
        </label>
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={posting || !body.trim()}
            className="rounded-xl bg-black px-6 py-3 text-lg text-white disabled:opacity-50"
          >
            {posting ? 'Posting…' : 'Add a comment'}
          </button>
          {postError && <span className="text-lg text-red-700">{postError}</span>}
        </div>
      </form>
    </div>
  )
}
