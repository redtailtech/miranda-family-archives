import type { PersonLite } from '@/lib/people'

const SIZE_CLASSES = {
  sm: 'h-10 w-10 text-xl',
  md: 'h-16 w-16 text-3xl',
  lg: 'h-32 w-32 text-6xl',
} as const

const SILHOUETTE: Record<PersonLite['gender'], string> = {
  MALE: '👨',
  FEMALE: '👩',
  UNSPECIFIED: '👤',
}

export function PersonAvatar({
  person,
  size = 'md',
}: {
  person: PersonLite
  size?: 'sm' | 'md' | 'lg'
}) {
  const cls = SIZE_CLASSES[size]

  if (person.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatarUrl}
        alt={person.displayName}
        className={`${cls} shrink-0 rounded-full object-cover`}
      />
    )
  }

  return (
    <span
      className={`flex ${cls} shrink-0 items-center justify-center rounded-full bg-black/10`}
      aria-hidden
    >
      {SILHOUETTE[person.gender]}
    </span>
  )
}
