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
]

export function Nav() {
  const pathname = usePathname()
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-semibold">
          Miranda Family Archives
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-4 py-3 text-lg ${
                pathname === l.href ? 'bg-black/10 font-semibold' : 'hover:bg-black/5'
              }`}
            >
              <span aria-hidden>{l.icon}</span> {l.label}
            </Link>
          ))}
          <UserButton />
        </nav>
      </div>
    </header>
  )
}
