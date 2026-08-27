/**
 * Pure family-tree layout algorithm. No prisma/next imports — unit-verifiable
 * in isolation (see the module-level assertions run during Task 4 verification).
 *
 * Algorithm (per Phase 5 Task 4 brief; pushdown pass added in the 2026-08-27
 * tree-layout fix, then folded into a joint fixed point with spouse pulling
 * in that same fix's round-1 review correction):
 *  1. generation = longest ancestor-chain depth (memoized DFS; cycle-safe via a
 *     visiting set — a back-edge contributes depth 0 rather than recursing).
 *     This seeds the joint fixed point below.
 *  1.5/2. Joint fixed point of three monotone non-decreasing passes, repeated
 *     until a full round makes no change (cap: peopleIds.length rounds, as a
 *     cycle backstop consistent with step 1's cycle guard):
 *       a. child-propagation: gen(child) = max(gen(child), max over parents
 *          (gen(parent) + 1)) — keeps a child strictly below every parent,
 *          including a parent whose gen a later pass just raised.
 *       b. pushdown: gen(parent) = max(gen(parent), min over children
 *          (gen(child)) − 1) — anchors anyone with no recorded parents (or
 *          otherwise under-placed relative to their children) directly above
 *          ALL of their children. `min` (not max) because a parent with
 *          children on different rows must stay strictly above all of them.
 *       c. spouse equalization: every spouse-group member takes the group's
 *          max generation (reuses pullSpousesToSameGeneration's union-find
 *          group-max semantics, applied to the current generations).
 *     Running these three passes in isolation and in sequence (as the
 *     original pushdown-then-pull-spouses fix did) can leave a spouse below
 *     her own child: pushdown raises a parentless co-parent P to sit above a
 *     deep-generation child, then a single spouse-pull raises P's spouse Q to
 *     match — without re-running child-propagation, Q's OWN children (at a
 *     shallower generation) are never re-checked against Q's new, deeper
 *     generation. Iterating all three together to a fixed point closes that
 *     gap: raising Q re-triggers child-propagation for Q's children, which
 *     may in turn re-trigger pushdown and further spouse equalization, until
 *     both invariants — every parent strictly above every child, and every
 *     spouse-group member sharing a row — hold simultaneously.
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

/** Step 2 (used both standalone and as pass (c) inside the joint fixed point below):
 * union-find over spouseLinks; generation of a group = max generation in it. */
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

/**
 * Steps 1.5/2: joint fixed point of child-propagation, pushdown, and spouse
 * equalization, iterated together until a full round makes no change.
 *
 * Running pushdown once and then pulling spouses once (the original 2026-08-27
 * fix) can place a spouse BELOW her own child: pushdown raises a parentless
 * co-parent P to sit above a deep-generation child, spouse-pull raises P's
 * spouse Q to match — but Q's own (shallower) children are never re-checked
 * against Q's new generation, since child-propagation doesn't re-run. Folding
 * all three passes into one loop closes that gap.
 *
 * All three passes are monotone non-decreasing, so the loop terminates on
 * acyclic data; rounds are additionally capped at peopleIds.length as a cycle
 * backstop (child-propagation over cyclic parentLinks would otherwise ratchet
 * forever) — on cap-hit we break and render whatever generations we have,
 * consistent with this module's existing cycle-guard philosophy.
 */
function computeGenerationsJointFixedPoint(
  peopleIds: string[],
  parentLinks: { childId: string; parentId: string }[],
  spouseLinks: { personAId: string; personBId: string }[],
  rawGen: Map<string, number>
): Map<string, number> {
  const knownIds = new Set(peopleIds)
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  for (const { childId, parentId } of parentLinks) {
    if (!knownIds.has(childId) || !knownIds.has(parentId)) continue
    if (!parentsOf.has(childId)) parentsOf.set(childId, [])
    parentsOf.get(childId)!.push(parentId)
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, [])
    childrenOf.get(parentId)!.push(childId)
  }

  let gen = new Map(rawGen)
  let round = 0
  let changed = true
  while (changed && round < peopleIds.length) {
    changed = false
    round++

    // (a) child-propagation: a child must be strictly below every parent,
    // including a parent whose generation a previous round's pushdown or
    // spouse-equalization pass just raised.
    for (const id of peopleIds) {
      const parents = parentsOf.get(id)
      if (!parents || parents.length === 0) continue
      let maxParentGen = -Infinity
      for (const pid of parents) {
        const pg = gen.get(pid)
        if (pg !== undefined) maxParentGen = Math.max(maxParentGen, pg)
      }
      if (maxParentGen === -Infinity) continue
      const target = maxParentGen + 1
      if (target > (gen.get(id) ?? 0)) {
        gen.set(id, target)
        changed = true
      }
    }

    // (b) pushdown: a parent must sit strictly above ALL of its children
    // (min over children, not max — see step 1.5 doc above).
    for (const id of peopleIds) {
      const children = childrenOf.get(id)
      if (!children || children.length === 0) continue
      let minChildGen = Infinity
      for (const cid of children) {
        const cg = gen.get(cid)
        if (cg !== undefined) minChildGen = Math.min(minChildGen, cg)
      }
      if (minChildGen === Infinity) continue
      const target = minChildGen - 1
      if (target > (gen.get(id) ?? 0)) {
        gen.set(id, target)
        changed = true
      }
    }

    // (c) spouse equalization: reuse pullSpousesToSameGeneration's group-max
    // union-find semantics, applied to the current (post a/b) generations.
    const equalized = pullSpousesToSameGeneration(peopleIds, spouseLinks, gen)
    for (const id of peopleIds) {
      if (equalized.get(id)! > gen.get(id)!) changed = true
    }
    gen = equalized
  }

  return gen
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
  const finalGen = computeGenerationsJointFixedPoint(peopleIds, parentLinks, spouseLinks, rawGen)

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
