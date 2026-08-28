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
 *  4.5. Bottom-up centering pass (added in the 2026-08-27 tree-centering fix,
 *     round 3): step 4 alone only pulls children toward already-placed
 *     parents, so a cluster with no parents of its own (e.g. the eldest
 *     generation) anchors at the left-to-right walk's starting x instead of
 *     sitting over its descendants. After step 4 has produced a full set of
 *     positions, walk generations from (maxGen - 1) down to 0 and re-run the
 *     non-overlap cursor walk with each item's target now pulled toward the
 *     mean CENTER x of its own children (already final, since shallower
 *     generations are processed after deeper ones here) instead of toward
 *     parents. See `centerParentsOverChildren`'s doc comment for the
 *     averaged-bidirectional-walk approach and why it can't change
 *     generation, row membership, or in-row order — only x moves. Run once
 *     bottom-up (not iterated), since each generation depends only on the
 *     generation below, which is already final by the time it's processed.
 *     A final re-normalization then re-zeros min x, since centering can
 *     shift the whole tree. Must run BEFORE step 6 so connectors read final
 *     positions.
 *  5. Edges: one 'spouse' edge per couple, one 'parent' edge per ParentChild link.
 *  6. Family connectors (added in the 2026-08-27 tree-fix round 2, connector
 *     routing): children are grouped into "family units" by their exact
 *     parent set (key = sorted parentIds). Each unit gets one drops/rail/
 *     risers connector instead of one independent path per (parent, child)
 *     pair, so multiple families sharing a row-gap don't visually merge into
 *     one ambiguous horizontal line. Per unit: parentDrops run from each
 *     parent's bottom-center down to a shared railY; the rail runs
 *     horizontally at railY spanning every parentDrop/childRiser x;
 *     childRisers run from railY down to each child's top-center. railY sits
 *     in the row-gap directly above the unit's shallowest (topmost) child
 *     row. Units whose rails fall in the same gap and whose x-ranges overlap
 *     (padded by gapX) are greedily interval-colored into distinct lane
 *     indices (sorted by rail xmin, lowest free lane wins), each lane a
 *     fixed 16px offset further into the gap band, capped at 4 lanes with
 *     wraparound beyond that (5+ overlapping families in one gap is out of
 *     scope). `edges` is unchanged — `layoutTree` still returns one 'parent'
 *     edge per ParentChild link for callers that don't consume connectors.
 *     Computed from `positions` AFTER step 4.5, so rails/drops/risers use
 *     final, centered coordinates.
 */

export type TreeNode = { id: string; x: number; y: number }
export type TreeEdge =
  | { kind: 'parent'; from: string; to: string } // parent -> child
  | { kind: 'spouse'; a: string; b: string; former: boolean }
/** Shared spouse-link input shape: `former` is optional (defaults false) so existing callers/tests stay valid. */
type SpouseLinkInput = { personAId: string; personBId: string; former?: boolean }
/** A single vertical connector segment (drop or riser): x is fixed, y1 is the top, y2 the bottom. */
export type FamilySegment = { x: number; y1: number; y2: number }
/** One family-unit connector: shared parents' drops + a lane-separated rail + children's risers. */
export type FamilyConnector = {
  parentIds: string[]
  childIds: string[]
  railY: number
  parentDrops: FamilySegment[]
  rail: { x1: number; x2: number; y: number }
  childRisers: FamilySegment[]
}
export type TreeLayout = {
  nodes: TreeNode[]
  edges: TreeEdge[]
  connectors: FamilyConnector[]
  width: number
  height: number
}

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
  spouseLinks: SpouseLinkInput[],
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
  spouseLinks: SpouseLinkInput[],
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

/**
 * Orders a cluster's members as a path through its spouse-link subgraph when
 * that subgraph IS a simple path: every member has degree <= 2 (counting only
 * distinct in-cluster neighbors) and there are exactly two degree-1 members
 * (endpoints). A connected graph with max degree 2 and exactly two degree-1
 * vertices can only be a simple path (a cycle would have zero degree-1
 * vertices), so no separate connectivity check is needed on top of these two
 * conditions. Walk starts at the degree-1 endpoint whose id sorts lower, for
 * determinism (e.g. former-spouse T and current-spouse C on either side of
 * Susan sort so the walk is deterministic regardless of discovery order).
 *
 * Clusters of 2 or fewer members are returned unchanged (existing discovery
 * order), BEFORE the graph-shape checks below — this is a SIZE gate, not a
 * `former`-flag gate, so it applies uniformly whether or not either spouse
 * link is former (keeping "former is pure passthrough" true). A 2-member
 * cluster (a plain couple, current or former) is trivially already a path of
 * one edge, so the shape checks below would happily reorder it too — but
 * path-disambiguation only has a visual point once there are 3+ members to
 * place (deciding which end of the row an outlier spouse sits on); for an
 * ordinary couple there is no ambiguity to resolve, and reordering by id would
 * needlessly flip every existing couple's left/right placement for zero
 * benefit. So plain couples keep whatever order `buildGenerationItems`'s BFS
 * discovered them in, same as before this feature existed.
 *
 * Falls back to returning `members` unchanged (the existing BFS discovery
 * order) for anything that isn't a simple path — triangles, stars of degree
 * >= 3, or (defensively) a walk that doesn't reach every member.
 */
function orderClusterAsPath(members: string[], adj: Map<string, string[]>): string[] {
  if (members.length <= 2) return members

  const memberSet = new Set(members)
  const neighborsOf = new Map<string, string[]>()
  for (const m of members) {
    const raw = adj.get(m) ?? []
    neighborsOf.set(m, [...new Set(raw.filter((n) => memberSet.has(n) && n !== m))])
  }

  if ([...neighborsOf.values()].some((ns) => ns.length > 2)) return members
  const endpoints = members.filter((m) => neighborsOf.get(m)!.length === 1)
  if (endpoints.length !== 2) return members

  const start = [...endpoints].sort()[0]
  const ordered: string[] = [start]
  const visited = new Set<string>([start])
  let prev = start
  let cur: string | undefined = neighborsOf.get(start)![0]
  while (cur !== undefined && !visited.has(cur)) {
    ordered.push(cur)
    visited.add(cur)
    const next: string | undefined = neighborsOf.get(cur)!.find((n) => n !== prev)
    prev = cur
    cur = next
  }

  return ordered.length === members.length ? ordered : members
}

/** Step 3a: group a generation's people into clusters (spouses stay adjacent). */
function buildGenerationItems(
  genPeopleIdsInOrder: string[],
  spouseLinks: SpouseLinkInput[]
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
    items.push({ members: orderClusterAsPath(members, adj) })
  }
  return items
}

/**
 * Step 4.5: bottom-up centering pass. Pulls each item toward the mean CENTER
 * x of its own children, mutating `positions` in place, so parents end up
 * over their descendants instead of anchored at step 4's walk-start x.
 *
 * For each generation g from (maxGen - 1) down to 0: items are rebuilt with
 * `buildGenerationItems` (the SAME clustering step 4 used), fed ids sorted
 * by their CURRENT x. Because step 4 never overlaps clusters and always
 * places a cluster's members at contiguous, strictly-increasing x's, sorting
 * by current x reconstructs the identical left-to-right item order and
 * identical member-within-item order that step 4 produced — no independent
 * re-sort, per the brief. Each item's `desired` x is the mean of its
 * children's center x's (center = x + cardW/2), converted back to a
 * leftmost-member x by subtracting the item's own center offset, so the
 * ITEM's center — not its leftmost member — lands on the children's mean
 * center. Children come from `childrenOfParent`, built once over all
 * parentLinks (not just gen g+1), which is safe here because every
 * generation deeper than g has already been finalized by this same
 * bottom-up loop (or, for maxGen itself, was never touched — it has no
 * generation below it to center on, so its step-4 positions stand as this
 * sweep's base case). Items with no children keep their current x.
 *
 * The non-overlap cursor walk then runs TWICE and the two results are
 * averaged, rather than once left-to-right as step 4 does:
 *   - left-to-right, `startX = max(desired, cursor + spacingX)` — identical
 *     semantics to step 4.
 *   - right-to-left, the symmetric mirror: `startX = min(desired, cursor -
 *     spacingX - itemSpan)`, walking from the last item back to the first.
 * A single left-to-right walk always resolves a desired-position conflict by
 * pushing the LATER item rightward, so a run of mutually-crowded items
 * drifts right of where any of them individually wanted to sit; the mirrored
 * right-to-left walk drifts the same run left under the same conditions.
 * Averaging the two cancels that directional bias — chosen over alternatives
 * (e.g. a single centered relaxation) because it stays a closed-form pass
 * over the existing cursor-walk primitive rather than an iterative solver.
 *
 * Averaging preserves non-overlap PROVABLY, not just empirically: both walks
 * satisfy the same affine inequality per adjacent pair of items,
 * `startX_{i+1} >= startX_i + itemSpan_i + spacingX`, and a convex
 * combination (the 50/50 average) of two sequences that each satisfy a
 * linear inequality termwise still satisfies it — so the averaged layout is
 * non-overlapping whenever both source walks are, which they always are
 * (each is literally step 4's algorithm with a different desired-x input).
 *
 * y is copied from the existing position, never recomputed, and
 * `finalGen`/generation membership is never read for anything but grouping
 * — so this pass cannot move a node to a different row, and item order is
 * threaded through unchanged from the current x-order — so it cannot
 * reorder items within a row either. Only x moves.
 */
function centerParentsOverChildren(
  peopleIds: string[],
  spouseLinks: SpouseLinkInput[],
  childrenOfParent: Map<string, string[]>,
  finalGen: Map<string, number>,
  maxGen: number,
  positions: Map<string, TreeNode>,
  opts: LayoutOpts
): void {
  const { cardW, gapX } = opts
  const spacingX = cardW + gapX

  for (let g = maxGen - 1; g >= 0; g--) {
    const genIdsByX = peopleIds
      .filter((id) => finalGen.get(id) === g)
      .sort((a, b) => positions.get(a)!.x - positions.get(b)!.x)
    if (genIdsByX.length === 0) continue

    const items = buildGenerationItems(genIdsByX, spouseLinks)

    const withDesired = items.map((item) => {
      const childCenterXs: number[] = []
      const seen = new Set<string>()
      for (const m of item.members) {
        for (const cid of childrenOfParent.get(m) ?? []) {
          if (seen.has(cid)) continue
          seen.add(cid)
          const cpos = positions.get(cid)
          if (cpos) childCenterXs.push(cpos.x + cardW / 2)
        }
      }
      const itemSpan = (item.members.length - 1) * spacingX
      const itemCenterOffset = cardW / 2 + itemSpan / 2
      const desired =
        childCenterXs.length === 0
          ? positions.get(item.members[0])!.x
          : childCenterXs.reduce((a, b) => a + b, 0) / childCenterXs.length - itemCenterOffset
      return { item, desired, itemSpan }
    })

    // Left-to-right walk: identical semantics to step 4's cursor walk.
    const ltr: number[] = []
    let cursor: number | null = null
    for (const { desired, itemSpan } of withDesired) {
      const startX: number = cursor === null ? desired : Math.max(desired, cursor + spacingX)
      ltr.push(startX)
      cursor = startX + itemSpan
    }

    // Right-to-left walk: symmetric mirror, from the last item back to the first.
    const rtl: number[] = new Array(withDesired.length)
    let rcursor: number | null = null
    for (let i = withDesired.length - 1; i >= 0; i--) {
      const { desired, itemSpan } = withDesired[i]
      const startX: number = rcursor === null ? desired : Math.min(desired, rcursor - spacingX - itemSpan)
      rtl[i] = startX
      rcursor = startX
    }

    withDesired.forEach(({ item }, i) => {
      const avgStartX = (ltr[i] + rtl[i]) / 2
      item.members.forEach((id, k) => {
        const prevY = positions.get(id)!.y
        positions.set(id, { id, x: avgStartX + k * spacingX, y: prevY })
      })
    })
  }
}

/**
 * Step 6: group children into family units by exact parent set, then compute
 * drops/rail/risers geometry per unit with greedy interval-coloring lane
 * assignment so overlapping rails in the same row-gap land on distinct y's.
 * Pure: takes already-computed node positions, does no generation math.
 */
function computeFamilyConnectors(
  peopleIds: string[],
  parentLinks: { childId: string; parentId: string }[],
  positions: Map<string, TreeNode>,
  opts: LayoutOpts
): FamilyConnector[] {
  const knownIds = new Set(peopleIds)
  const { cardW, cardH, gapX, gapY } = opts

  // Group children by their exact sorted parent-id set.
  const parentsOfChild = new Map<string, Set<string>>()
  for (const { childId, parentId } of parentLinks) {
    if (!knownIds.has(childId) || !knownIds.has(parentId)) continue
    if (!parentsOfChild.has(childId)) parentsOfChild.set(childId, new Set())
    parentsOfChild.get(childId)!.add(parentId)
  }
  const unitsByKey = new Map<string, { parentIds: string[]; childIds: string[] }>()
  for (const [childId, parentSet] of parentsOfChild) {
    const parentIds = [...parentSet].sort()
    const key = parentIds.join(',')
    if (!unitsByKey.has(key)) unitsByKey.set(key, { parentIds, childIds: [] })
    unitsByKey.get(key)!.childIds.push(childId)
  }

  type Prepared = {
    parentIds: string[]
    childIds: string[]
    childRowTopY: number
    xmin: number
    xmax: number
    parentXs: { x: number; bottomY: number }[]
    childXs: { x: number; topY: number }[]
  }

  const prepared: Prepared[] = []
  for (const unit of unitsByKey.values()) {
    const parentXs = unit.parentIds.map((id) => {
      const p = positions.get(id)!
      return { x: p.x + cardW / 2, bottomY: p.y + cardH }
    })
    const childXs = unit.childIds.map((id) => {
      const c = positions.get(id)!
      return { x: c.x + cardW / 2, topY: c.y }
    })
    const childRowTopY = Math.min(...childXs.map((c) => c.topY))
    const allXs = [...parentXs.map((p) => p.x), ...childXs.map((c) => c.x)]
    prepared.push({
      parentIds: unit.parentIds,
      childIds: unit.childIds,
      childRowTopY,
      xmin: Math.min(...allXs),
      xmax: Math.max(...allXs),
      parentXs,
      childXs,
    })
  }

  // Deterministic processing order regardless of Map/object iteration order,
  // so identical input always produces identical connector output: by gap
  // (childRowTopY), then rail xmin (also the order greedy interval-coloring
  // needs), then parentIds as a final tiebreaker.
  prepared.sort((a, b) => {
    if (a.childRowTopY !== b.childRowTopY) return a.childRowTopY - b.childRowTopY
    if (a.xmin !== b.xmin) return a.xmin - b.xmin
    return a.parentIds.join(',').localeCompare(b.parentIds.join(','))
  })

  // Greedy interval coloring per gap: lowest lane index whose last-assigned
  // xmax (padded by gapX) doesn't overlap this unit's xmin. Capped at 4
  // lanes; beyond that, wrap (5+ overlapping families in one gap is out of
  // scope, per the brief).
  const MAX_LANES = 4
  const laneEndXByGap = new Map<number, number[]>()

  const connectors: FamilyConnector[] = []
  for (const unit of prepared) {
    let laneEndX = laneEndXByGap.get(unit.childRowTopY)
    if (!laneEndX) {
      laneEndX = []
      laneEndXByGap.set(unit.childRowTopY, laneEndX)
    }

    let lane = -1
    for (let i = 0; i < laneEndX.length; i++) {
      if (laneEndX[i] + gapX <= unit.xmin) {
        lane = i
        break
      }
    }
    if (lane === -1) {
      if (laneEndX.length < MAX_LANES) {
        lane = laneEndX.length
        laneEndX.push(-Infinity)
      } else {
        lane = laneEndX.length % MAX_LANES
      }
    }
    laneEndX[lane] = Math.max(laneEndX[lane], unit.xmax)

    const railY = unit.childRowTopY - gapY + 24 + lane * 16

    connectors.push({
      parentIds: unit.parentIds,
      childIds: unit.childIds,
      railY,
      parentDrops: unit.parentXs.map((p) => ({ x: p.x, y1: p.bottomY, y2: railY })),
      rail: { x1: unit.xmin, x2: unit.xmax, y: railY },
      childRisers: unit.childXs.map((c) => ({ x: c.x, y1: railY, y2: c.topY })),
    })
  }

  return connectors
}

export function layoutTree(
  people: { id: string }[],
  parentLinks: { childId: string; parentId: string }[],
  spouseLinks: SpouseLinkInput[],
  opts: LayoutOpts = DEFAULT_OPTS
): TreeLayout {
  if (people.length === 0) return { nodes: [], edges: [], connectors: [], width: 0, height: 0 }

  const { cardW, cardH, gapX, gapY } = opts
  const spacingX = cardW + gapX
  const peopleIds = people.map((p) => p.id)

  const rawGen = computeRawGenerations(peopleIds, parentLinks)
  const finalGen = computeGenerationsJointFixedPoint(peopleIds, parentLinks, spouseLinks, rawGen)

  const parentsOfChild = new Map<string, string[]>()
  const childrenOfParent = new Map<string, string[]>()
  const knownIds = new Set(peopleIds)
  for (const { childId, parentId } of parentLinks) {
    if (!knownIds.has(childId) || !knownIds.has(parentId)) continue
    if (!parentsOfChild.has(childId)) parentsOfChild.set(childId, [])
    parentsOfChild.get(childId)!.push(parentId)
    if (!childrenOfParent.has(parentId)) childrenOfParent.set(parentId, [])
    childrenOfParent.get(parentId)!.push(childId)
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

  centerParentsOverChildren(peopleIds, spouseLinks, childrenOfParent, finalGen, maxGen, positions, opts)

  // Re-normalize so min x = 0 — centering can shift the whole tree.
  const minX = Math.min(...peopleIds.map((id) => positions.get(id)!.x))
  if (minX !== 0) {
    for (const id of peopleIds) {
      const p = positions.get(id)!
      positions.set(id, { ...p, x: p.x - minX })
    }
  }

  const nodes: TreeNode[] = peopleIds.map((id) => positions.get(id)!)

  const edges: TreeEdge[] = []
  for (const { personAId, personBId, former } of spouseLinks) {
    if (!knownIds.has(personAId) || !knownIds.has(personBId)) continue
    edges.push({ kind: 'spouse', a: personAId, b: personBId, former: former ?? false })
  }
  for (const { childId, parentId } of parentLinks) {
    if (!knownIds.has(childId) || !knownIds.has(parentId)) continue
    edges.push({ kind: 'parent', from: parentId, to: childId })
  }

  const connectors = computeFamilyConnectors(peopleIds, parentLinks, positions, opts)

  const maxX = Math.max(...nodes.map((n) => n.x))
  const maxY = Math.max(...nodes.map((n) => n.y))

  return {
    nodes,
    edges,
    connectors,
    width: maxX + cardW,
    height: maxY + cardH,
  }
}
