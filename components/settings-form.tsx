'use client'

import { useState } from 'react'
import Link from 'next/link'

type Profile = {
  name: string
  email: string
  role: 'ADMIN' | 'MEMBER'
  digestEnabled: boolean
}

export function SettingsForm({ profile, isAdmin }: { profile: Profile; isAdmin: boolean }) {
  return (
    <div className="grid max-w-xl gap-8">
      <DigestToggle initialEnabled={profile.digestEnabled} />

      <section className="grid gap-2 rounded-xl border bg-surface p-6">
        <h2 className="text-2xl font-semibold">Your profile</h2>
        <dl className="grid gap-1 text-lg">
          <div className="flex gap-2">
            <dt className="text-ink-soft">Name:</dt>
            <dd>{profile.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-soft">Email:</dt>
            <dd>{profile.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-soft">Role:</dt>
            <dd>{profile.role === 'ADMIN' ? 'Admin' : 'Member'}</dd>
          </div>
        </dl>
        <p className="text-lg text-ink-soft">
          Manage your account (password, photo) from the 👤 menu in the top corner.
        </p>
      </section>

      {isAdmin && <AdminInvite />}
    </div>
  )
}

function DigestToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [digestEnabled, setDigestEnabled] = useState(initialEnabled)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  async function toggle() {
    const next = !digestEnabled
    const prev = digestEnabled
    setDigestEnabled(next)
    setState('saving')
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestEnabled: next }),
      })
      if (res.ok) {
        setState('saved')
        setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2000)
      } else {
        setDigestEnabled(prev)
        setState('error')
        let msg = `HTTP ${res.status}`
        try {
          msg = (await res.json()).error ?? msg
        } catch {}
        setError(msg)
      }
    } catch {
      setDigestEnabled(prev)
      setState('error')
      setError("Couldn't save — check your connection and try again.")
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border bg-surface p-6">
      <h2 className="text-2xl font-semibold">Daily email digest</h2>
      <p className="text-lg text-ink-soft">
        One email a day when family adds photos or people — nothing on quiet days.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={digestEnabled}
          aria-label="Daily email digest"
          onClick={toggle}
          disabled={state === 'saving'}
          className={`relative inline-flex h-11 w-20 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            digestEnabled ? 'bg-green-600' : 'bg-ink/25'
          }`}
        >
          <span
            className={`inline-block h-9 w-9 transform rounded-full bg-white shadow transition-transform ${
              digestEnabled ? 'translate-x-10' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="text-lg">{digestEnabled ? 'On' : 'Off'}</span>
        {state === 'saved' && <span className="text-lg text-green-700">Saved ✓</span>}
        {state === 'error' && <span className="text-lg text-red-700">{error}</span>}
      </div>
    </section>
  )
}

function AdminInvite() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')
  const [invitedEmail, setInvitedEmail] = useState('')

  async function sendInvite() {
    setState('sending')
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (res.ok) {
        setInvitedEmail(email.trim())
        setEmail('')
        setState('sent')
      } else {
        setState('error')
        let msg = `HTTP ${res.status}`
        try {
          msg = (await res.json()).error ?? msg
        } catch {}
        setError(msg)
      }
    } catch {
      setState('error')
      setError("Couldn't save — check your connection and try again.")
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border bg-surface p-6">
      <h2 className="text-2xl font-semibold">Invite a family member</h2>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          sendInvite()
        }}
      >
        <input
          type="email"
          required
          className="min-h-12 min-w-[16rem] flex-1 rounded-xl border border-ink/25 px-4 py-3 text-lg"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (state === 'sent' || state === 'error') setState('idle')
          }}
        />
        <button
          type="submit"
          disabled={state === 'sending' || !email.trim()}
          className="min-h-12 rounded-xl bg-ink px-6 py-3 text-lg font-medium text-paper hover:bg-sepia disabled:opacity-50"
        >
          {state === 'sending' ? 'Sending…' : 'Send invite'}
        </button>
      </form>
      {state === 'sent' && <p className="text-lg text-green-700">Invitation sent to {invitedEmail}</p>}
      {state === 'error' && <p className="text-lg text-red-700">{error}</p>}
      <Link href="/admin/deleted" className="inline-flex min-h-11 items-center justify-self-start text-lg underline">
        Deleted items
      </Link>
    </section>
  )
}
