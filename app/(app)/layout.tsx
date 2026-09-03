import { Nav } from '@/components/nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Nav />
      <main className="px-6 py-8">{children}</main>
    </div>
  )
}
