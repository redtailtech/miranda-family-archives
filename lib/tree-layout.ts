/**
 * Pure family-tree layout algorithm. No prisma/next imports — unit-verifiable
 * in isolation (see the module-level assertions run during Task 4 verification).
 *
 * Algorithm (per Phase 5 Task 4 brief):
 *  1. generation = longest ancestor-chain depth (memoized DFS; cycle-safe via a
 *     visiting set — a back-edge contributes depth 0 rather than recursing).
 *  2. Spouses are pulled into the same generation (max of the pair/group).
 *  3. Within a generation, nodes are ordered by family cluster: children sort
 *     toward the mean x of their (already-placed) parents, processing
 *     generations top-down; spouses stay adjacent (b immediately after a).
 *  4. x is assigned by walking the ordered generation left-to-right, resolving
 *     overlaps by never placing a node left of (previous node's x + spacing).
 *     y = generation * (cardH + gapY).
 *  5. Edges: one 'spouse' edge per couple, one 'parent' edge per ParentChild link.
 */

export type TreeNode = { id: string; x: number; y: number }
export type TreeEdge =
  | { kind: 'parent'; from: string; to: string } // parent -> child
  | { kind: 'spouse'; a: string; b: string }
export type TreeLayout = { nodes: TreeNode[]; edges: TreeEdge[]; width: number; height: number }

export type LayoutOpts = { cardW: number; cardH: number; gapX: number; gapY: number }

const DEFAULT_OPTS: LayoutOpts = { cardW: 176, cardH: 88, gapX: 32, gapY: 96 }

type Item = { members: string[] }

/** Step 1: generation = longest ancestor-chain depth, memoized DFS with cycle guard. */
function computeRawGenerations(
  peopleIds: string[],
  parentLinks: { childId: string; parentId: string }[]
): Map<string, number> {
  const knownIds = new Set(peopleIds)
  const parentsOf = new Map<string, string[]>()
  for (const { childId, parentId } of parentLinks) {
    if (!knownIds.has(childId) || !knownIds.has(parentId)) continue
    if (!parentsOf.has(childId)) parentsOf.set(childId, [])
    parentsOf.get(childId)!.push(parentId)
  }

  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  function gen(id: string): number {
    const memoized = memo.get(id)
    if (memoized !== undefined) return memoized
    const parents = parentsOf.get(id) ?? []
    if (parents.length === 0) {
      memo.set(id, 0)
      return 0
    }
    visiting.add(id)
    let max = 0
    for (const pid of parents) {
      if (visiting.has(pid)) {
        // back-edge: treat as depth 0 contribution rather than recursing into a cycle.
        continue
      }
      max = Math.max(max, 1 + gen(pid))
    }
    visiting.delete(id)
    memo.set(id, max)
    return max
  }

  const result = new Map<string, number>()
  for (const id of peopleIds) result.set(id, gen(id))
  return result
}

/** Step 2: union-find over spouseLinks; generation of a group = max raw generation in it. */
function pullSpousesToSameGeneration(
  peopleIds: string[],
  spouseLinks: { personAId: string; personBId: string }[],
  rawGen: Map<string, number>
): Map<string, number> {
  const knownIds = new Set(peopleIds)
  const parent = new Map<string, string>()
  for (const id of peopleIds) parent.set(id, id)

  function find(x: string): string {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const { personAId, personBId } of spouseLinks) {
    if (!knownIds.has(personAId) || !knownIds.has(personBId)) continue
    union(personAId, personBId)
  }

  const groupMax = new Map<string, number>()
  for (const id of peopleIds) {
    const root = find(id)
    const g = rawGen.get(id) ?? 0
    groupMax.set(root, Math.max(groupMax.get(root) ?? -Infinity, g))
  }

  const finalGen = new Map<string, number>()
  for (const id of peopleIds) finalGen.set(id, groupMax.get(find(id))!)
  return finalGen
}

/** Step 3a: group a generation's people into clusters (spouses stay adjacent). */
function buildGenerationItems(
  genPeopleIdsInOrder: string[],
  spouseLinks: { personAId: string; personBId: string }[]
): Item[] {
  const genSet = new Set(genPeopleIdsInOrder)
  const adj = new Map<string, string[]>()
  for (const { personAId, personBId } of spouseLinks) {
    if (!genSet.has(personAId) || !genSet.has(personBId)) continue
    if (!adj.has(personAId)) adj.set(personAId, [])
    adj.get(personAId)!.push(personBId)
    if (!adj.has(personBId)) adj.set(personBId, [])
    adj.get(personBId)!.push(personAId)
  }

  const assigned = new Set<string>()
  const items: Item[] = []
  for (const id of genPeopleIdsInOrder) {
    if (assigned.has(id)) continue
    const members = [id]
    assigned.add(id)
    let i = 0
    while (i < members.length) {
      const cur = members[i]
      for (const nb of adj.get(cur) ?? []) {
        if (!assigned.has(nb)) {
          assigned.add(nb)
          members.push(nb)
        }
      }
      i++
    }
    items.push({ members })
  }
  return items
}

export function layoutTree(
  people: { id: string }[],
  parentLinks: { childId: string; parentId: string }[],
  spouseLinks: { personAId: string; personBId: string }[],
  opts: LayoutOpts = DEFAULT_OPTS
): TreeLayout {
  if (people.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const { cardW, cardH, gapX, gapY } = opts
  const spacingX = cardW + gapX
  const peopleIds = people.map((p) => p.id)

  const rawGen = computeRawGenerations(peopleIds, parentLinks)
  const finalGen = pullSpousesToSameGeneration(peopleIds, spouseLinks, rawGen)

  const parentsOfChild = new Map<string, string[]>()
  const knownIds = new Set(peopleIds)
  for (const { childId, parentId } of parentLinks) {
    if (!knownIds.has(childId) || !knownIds.has(parentId)) continue
    if (!parentsOfChild.has(childId)) parentsOfChild.set(childId, [])
    parentsOfChild.get(childId)!.push(parentId)
  }

  const maxGen = Math.max(...peopleIds.map((id) => finalGen.get(id)!))
  const positions = new Map<string, TreeNode>()

  for (let g = 0; g <= maxGen; g++) {
    const genPeopleIdsInOrder = peopleIds.filter((id) => finalGen.get(id) === g)
    if (genPeopleIdsInOrder.length === 0) continue

    const items = buildGenerationItems(genPeopleIdsInOrder, spouseLinks)

    const withTargets = items.map((item) => {
      const parentXs = new Set<number>()
      for (const m of item.members) {
        for (const pid of parentsOfChild.get(m) ?? []) {
          const placed = positions.get(pid)
          if (placed) parentXs.add(placed.x)
        }
      }
      const target =
        parentXs.size === 0 ? null : [...parentXs].reduce((a, b) => a + b, 0) / parentXs.size
      return { item, target }
    })

    // Stable sort: known targets ascend by x; unknown targets keep their
    // original discovery order (comparator returns 0 among null/null pairs,
    // and is stable across engines per the ES2019 spec).
    withTargets.sort((A, B) => {
      if (A.target === null && B.target === null) return 0
      if (A.target === null) return 1
      if (B.target === null) return -1
      return A.target - B.target
    })

    const y = g * (cardH + gapY)
    let cursor: number | null = null
    for (const { item, target } of withTargets) {
      let startX: number
      if (cursor === null) {
        startX = target ?? 0
      } else {
        const minX = cursor + spacingX
        startX = target !== null ? Math.max(target, minX) : minX
      }
      item.members.forEach((id, k) => {
        positions.set(id, { id, x: startX + k * spacingX, y })
      })
      cursor = startX + (item.members.length - 1) * spacingX
    }
  }

  const nodes: TreeNode[] = peopleIds.map((id) => positions.get(id)!)

  const edges: TreeEdge[] = []
  for (const { personAId, personBId } of spouseLinks) {
    if (!knownIds.has(personAId) || !knownIds.has(personBId)) continue
    edges.push({ kind: 'spouse', a: personAId, b: personBId })
  }
  for (const { childId, parentId } of parentLinks) {
    if (!knownIds.has(childId) || !knownIds.has(parentId)) continue
    edges.push({ kind: 'parent', from: parentId, to: childId })
  }

  const maxX = Math.max(...nodes.map((n) => n.x))
  const maxY = Math.max(...nodes.map((n) => n.y))

  return {
    nodes,
    edges,
    width: maxX + cardW,
    height: maxY + cardH,
  }
}
