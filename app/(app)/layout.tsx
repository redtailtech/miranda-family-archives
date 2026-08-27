import { Nav } from '@/components/nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  )
}
