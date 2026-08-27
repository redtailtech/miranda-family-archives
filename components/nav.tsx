'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'

const links = [
  { href: '/', label: 'Library', icon: '🖼️' },
  { href: '/albums', label: 'Albums', icon: '📚' },
  { href: '/tree', label: 'Family Tree', icon: '🌳' },
  { href: '/favorites', label: 'Favorites', icon: '❤️' },
  { href: '/upload', label: 'Upload', icon: '⬆️' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
]

/* The mounted-print mark — same motif as app/icon.svg. */
function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className="h-7 w-7 shrink-0">
      <rect width="64" height="64" rx="14" fill="#4e3a2a" />
      <rect x="14" y="14" width="36" height="36" rx="2" fill="#faf7ef" />
      <circle cx="27" cy="27" r="4.5" fill="#c9800f" />
      <path d="M18 45 l8 -9 6 6 5 -5 9 8 v2 h-28 z" fill="#6a594b" />
      <path d="M14 14 h12 l-12 12 z" fill="#c9800f" />
      <path d="M50 50 h-12 l12 -12 z" fill="#c9800f" />
    </svg>
  )
}

export function Nav() {
  const pathname = usePathname()
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2.5 rounded-lg font-display text-2xl font-semibold tracking-tight text-ink"
        >
          <Mark />
          Miranda Family Archives
        </Link>
        <nav className="flex flex-1 flex-wrap items-center justify-end gap-1">
          {links.map((l) => {
            const active = pathname === l.href
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-lg transition-colors sm:px-4 ${
                  active
                    ? 'bg-wash font-semibold text-ink shadow-[inset_0_-3px_0_0_var(--color-amber)]'
                    : 'text-ink-soft hover:bg-wash hover:text-ink'
                }`}
              >
                <span aria-hidden>{l.icon}</span> {l.label}
              </Link>
            )
          })}
          <div className="ml-2 flex min-h-11 items-center">
            <UserButton />
          </div>
        </nav>
      </div>
    </header>
  )
}
