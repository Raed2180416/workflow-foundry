// Domain: graph routing (fictional transport network library).
import { New, Call, Fn, Ref, Case } from './dsl.mjs';

const TOWNS = ['Ashcombe', 'Brindle', 'Corvale', 'Dunmore', 'Eastwick', 'Fallowmere', 'Grisby', 'Hollin', 'Ivybridge',
  'Kelloway', 'Larkmoor', 'Mossgate'];

function chain(p, nodes, costs, opts = {}) {
  const steps = [New('g', p.G)];
  for (let k = 0; k + 1 < nodes.length; k++) steps.push(Call('g', 'add_edge', [nodes[k], nodes[k + 1], costs[k]], opts));
  return steps;
}

export default {
  id: 'routing',
  domain: 'graph routing',
  params(r) {
    return {
      mod: r.pick(['routeplan', 'netpath', 'linkgraph', 'hopfinder']),
      G: r.pick(['RoadGraph', 'Network', 'RouteMap', 'LinkGraph']),
      network: r.pick(['Fenwick County road', 'Harrow Valley rail', 'Brackwater courier', 'Islay ferry']),
      towns: r.sample(TOWNS, 7).sort(),
      cpc: r.pick([10, 12, 15]),
      free: r.pick([1, 2]),
    };
  },
  context: p => `Dispatch for the ${p.network} network computes every route with ${p.mod}.`,
  sections: [
    { id: 'core', label: 'graph building and shortest paths' },
    { id: 'paths', label: 'path costs and reachability' },
    { id: 'avoid', label: 'multi-stop routes and closures' },
    { id: 'network', label: 'network structure reports' },
    { id: 'tolls', label: 'tolls and fares' },
  ],

  sites: {
    neg_cost: {
      section: 'core', op: 'wrong-comparator', fnKey: 'add_edge', fn: p => `${p.G}.add_edge()`,
      title: () => 'add_edge() rejects zero-cost links',
      symptom: [
        p => `add_edge() raises "edge cost must be non-negative" for a cost of 0. Our transfer links inside a station have cost 0 and the docstring says that is allowed.`,
      ],
      herring: [
        () => `add_edge() accepts links with cost 0. A free link makes the router prefer odd detours; I think zero should be rejected just like negative costs.`,
      ],
      decoy: () => 'TODO: reject zero-cost links too (<=)? they confuse the dispatcher',
      killers: (p, r) => { const [a, b, c] = p.towns; return [Case('test_zero_cost_edges_allowed', [New('g', p.G), Call('g', 'add_edge', [a, b, 0]), Call('g', 'add_edge', [a, c, -1]),
        Fn('shortest_path', [Ref('g'), b, a])])]; },
    },
    dir_swap: {
      section: 'core', op: 'swapped-arguments', fnKey: 'add_edge', fn: p => `${p.G}.add_edge()`,
      title: () => 'One-way links point the wrong way',
      symptom: [
        () => `One-way links added with bidirectional=False go in the opposite direction: a link from A to B can only be travelled from B to A.`,
      ],
      killers: (p, r) => { const [a, b, c] = p.towns; return [Case('test_one_way_edge_direction', [New('g', p.G), Call('g', 'add_edge', [a, b, r.int(1, 9)], { bidirectional: false }),
        Call('g', 'add_edge', [b, c, 2]), Fn('shortest_path', [Ref('g'), a, c]), Fn('shortest_path', [Ref('g'), c, a]), Call('g', 'neighbours', [a])])]; },
    },
    bidi_default: {
      section: 'core', op: 'wrong-default', fnKey: 'add_edge', fn: p => `${p.G}.add_edge()`,
      title: () => 'Links are one-way by default',
      symptom: [
        () => `Since the upgrade every link we add is one-way unless we pass bidirectional=True explicitly; the docstring says two-way is the default.`,
      ],
      herring: [
        () => `add_edge() makes links two-way unless told otherwise. Most of our links are one-way, so one-way should be the default.`,
      ],
      killers: (p, r) => { const [a, b] = p.towns; return [Case('test_edges_two_way_by_default', [New('g', p.G), Call('g', 'add_edge', [a, b, r.int(1, 9)]),
        Fn('shortest_path', [Ref('g'), b, a]), Call('g', 'neighbours', [b])])]; },
    },
    unknown_node: {
      section: 'core', op: 'missing-edge-case', fnKey: 'shortest_path', fn: () => 'shortest_path()',
      title: () => 'shortest_path() crashes for unknown start nodes',
      symptom: [
        () => `shortest_path() raises KeyError when the start node is not in the graph (typo in a depot name). It should just say there is no route.`,
      ],
      killers: (p, r) => { const [a, b] = p.towns; return [Case('test_unknown_nodes_have_no_route', [New('g', p.G), Call('g', 'add_edge', [a, b, 3]),
        Fn('shortest_path', [Ref('g'), 'Nowhere', a]), Fn('shortest_path', [Ref('g'), a, 'Nowhere']), Fn('shortest_path', [Ref('g'), 'Nowhere', 'Nowhere'])])]; },
    },
    empty_path: {
      section: 'paths', op: 'missing-edge-case', fnKey: 'path_cost', fn: () => 'path_cost()',
      title: () => 'path_cost() of an empty path is 0',
      symptom: [
        () => `path_cost(graph, []) returns 0, so empty routes from a failed lookup look like free trips. The docstring says None.`,
      ],
      killers: (p, r) => { const [a, b] = p.towns; return [Case('test_path_cost_empty_and_single', [New('g', p.G), Call('g', 'add_edge', [a, b, 4]),
        Fn('path_cost', [Ref('g'), []]), Fn('path_cost', [Ref('g'), [a]]), Fn('path_cost', [Ref('g'), [a, b, a]])])]; },
    },
    budget_cmp: {
      section: 'paths', op: 'wrong-comparator', fnKey: 'within_budget', fn: () => 'within_budget()',
      title: () => 'within_budget() misses nodes exactly at the budget',
      symptom: [
        () => `within_budget() leaves out stops whose cheapest cost equals the budget exactly. "At most" should include them.`,
      ],
      herring: [
        () => `within_budget() includes stops whose cost is exactly the budget. Our drivers read "budget" as a hard limit that must not be reached, so those should be excluded.`,
      ],
      killers: (p, r) => { const [a, b, c, d] = p.towns; const x = r.int(1, 4); const y = r.int(1, 4);
        return [Case('test_within_budget_inclusive', [...chain(p, [a, b, c, d], [x, y, 9]), Fn('within_budget', [Ref('g'), a, x + y]), Fn('within_budget', [Ref('g'), 'Nowhere', 5])])]; },
    },
    hops_off: {
      section: 'paths', op: 'off-by-one', fnKey: 'within_hops', fn: () => 'within_hops()',
      title: () => 'within_hops() stops one hop early',
      symptom: [
        () => `within_hops(graph, src, 2) only returns direct neighbours; nodes two hops away are missing.`,
      ],
      decoy: () => 'FIXME: range(max_hops - 1)? the source itself already counts as a hop',
      killers: (p, r) => { const [a, b, c, d] = p.towns; return [Case('test_within_hops_counts_edges', [...chain(p, [a, b, c, d], [1, 1, 1]), Fn('within_hops', [Ref('g'), a, 2]),
        Fn('within_hops', [Ref('g'), a, 0])])]; },
    },
    frontier_stale: {
      section: 'paths', op: 'stale-variable', fnKey: 'within_hops', fn: () => 'within_hops()',
      title: () => 'within_hops() never goes past the first ring',
      symptom: [
        () => `within_hops() with max_hops of 2 or 3 returns the same nodes as with 1: it never gets beyond the direct neighbours.`,
      ],
      killers: (p, r) => { const [a, b, c, d, e] = p.towns; return [Case('test_within_hops_multi_ring', [...chain(p, [a, b, c, d, e], [2, 2, 2, 2]), Fn('within_hops', [Ref('g'), b, 3])])]; },
    },
    nearest_tie: {
      section: 'paths', op: 'wrong-comparator', fnKey: 'nearest', fn: () => 'nearest()',
      title: () => 'nearest() breaks ties towards the wrong depot',
      symptom: [
        () => `When two depots are equally close, nearest() picks the alphabetically last one; the docstring says ties go to the first name.`,
      ],
      killers: (p, r) => { const [a, b, c] = p.towns; const k = r.int(1, 6);
        return [Case('test_nearest_tie_break', [New('g', p.G), Call('g', 'add_edge', [a, b, k]), Call('g', 'add_edge', [a, c, k]), Fn('nearest', [Ref('g'), a, [c, b, 'Nowhere']])])]; },
    },
    via_swap: {
      section: 'avoid', op: 'swapped-arguments', fnKey: 'route_via', fn: () => 'route_via()',
      title: () => 'route_via() returns routes that jump back and forth',
      symptom: [
        () => `route_via() returns paths like A, B, A for stops [A, C]: the legs seem to be computed backwards, and one-way links break it completely.`,
      ],
      killers: (p, r) => { const [a, b, c] = p.towns; return [Case('test_route_via_leg_order', [New('g', p.G), Call('g', 'add_edge', [a, b, 1]), Call('g', 'add_edge', [b, c, 1]),
        Call('g', 'add_edge', [a, c, 5]), Fn('route_via', [Ref('g'), [a, c]]), Fn('route_via', [Ref('g'), [c]])])]; },
    },
    ban_edges: {
      section: 'avoid', op: 'missing-edge-case', fnKey: 'without_nodes', fn: () => 'without_nodes()',
      title: () => 'Closed nodes reappear in the reduced graph',
      symptom: [
        () => `without_nodes() still lists closed stops as nodes, and their neighbours still have links to them.`,
      ],
      killers: (p, r) => { const [a, b, c] = p.towns; return [Case('test_without_nodes_removes_edges', [New('g', p.G), Call('g', 'add_edge', [a, b, 1]), Call('g', 'add_edge', [b, c, 1]),
        Fn('without_nodes', [Ref('g'), [b]], {}, 'h'), Call('h', 'nodes'), Call('h', 'neighbours', [a])])]; },
    },
    detour_sign: {
      section: 'avoid', op: 'swapped-arguments', fnKey: 'detour_cost', fn: () => 'detour_cost()',
      title: () => 'detour_cost() is negative',
      symptom: [
        () => `detour_cost() returns negative numbers: closing a stop apparently makes the trip cheaper.`,
      ],
      killers: (p, r) => { const [a, b, c, d] = p.towns; return [Case('test_detour_cost_positive', [New('g', p.G), Call('g', 'add_edge', [a, b, 1]), Call('g', 'add_edge', [b, c, 1]),
        Call('g', 'add_edge', [a, d, 2]), Call('g', 'add_edge', [d, c, r.int(2, 6)]), Fn('detour_cost', [Ref('g'), a, c, [b]]), Fn('detour_cost', [Ref('g'), a, c, [b, d]])])]; },
    },
    comp_dir: {
      section: 'network', op: 'missing-edge-case', fnKey: 'components', fn: () => 'components()',
      title: () => 'components() splits nodes joined by one-way links',
      symptom: [
        () => `components() puts two depots in different groups although a one-way link joins them; it should treat links as two-way.`,
      ],
      killers: (p, r) => { const t = p.towns; return [Case('test_components_ignore_direction', [New('g', p.G), Call('g', 'add_edge', [t[5], t[0], 3], { bidirectional: false }),
        Call('g', 'add_edge', [t[2], t[3], 1]), Call('g', 'add_node', [t[4]]), Fn('components', [Ref('g')])])]; },
    },
    deg_cmp: {
      section: 'network', op: 'wrong-comparator', fnKey: 'degree_table', fn: () => 'degree_table()',
      title: () => 'degree_table() leaves out nodes at the minimum degree',
      symptom: [
        () => `degree_table(graph, 2) does not list nodes that have exactly 2 outgoing links.`,
      ],
      herring: [
        () => `degree_table(graph, 2) lists nodes that have exactly 2 links. I asked for nodes above the minimum, so those should not be there.`,
      ],
      killers: (p, r) => { const t = p.towns; return [Case('test_degree_table_minimum_inclusive', [New('g', p.G), Call('g', 'add_edge', [t[0], t[1], 1]), Call('g', 'add_edge', [t[0], t[2], 1]),
        Call('g', 'add_edge', [t[3], t[1], 1], { bidirectional: false }), Fn('degree_table', [Ref('g'), 2])])]; },
    },
    deg_default: {
      section: 'network', op: 'wrong-default', fnKey: 'degree_table', fn: () => 'degree_table()',
      title: () => 'degree_table() default hides dead ends',
      symptom: [
        () => `degree_table(graph) without a minimum no longer lists dead-end nodes with a single link; the documented default minimum is 1.`,
      ],
      killers: (p, r) => { const t = p.towns; return [Case('test_degree_table_default_minimum', [New('g', p.G), Call('g', 'add_edge', [t[0], t[1], 1]), Call('g', 'add_edge', [t[0], t[2], 1]),
        Call('g', 'add_node', [t[3]]), Fn('degree_table', [Ref('g')])])]; },
    },
    iso_in: {
      section: 'network', op: 'missing-edge-case', fnKey: 'isolated_nodes', fn: () => 'isolated_nodes()',
      title: () => 'isolated_nodes() reports reachable sinks',
      symptom: [
        () => `isolated_nodes() lists stops that can be reached by a one-way link but have no outgoing links. They are not isolated.`,
      ],
      killers: (p, r) => { const t = p.towns; return [Case('test_isolated_nodes_ignore_sinks', [New('g', p.G), Call('g', 'add_edge', [t[0], t[1], 1], { bidirectional: false }),
        Call('g', 'add_node', [t[2]]), Fn('isolated_nodes', [Ref('g')])])]; },
    },
    free_off: {
      section: 'tolls', op: 'off-by-one', fnKey: 'toll_cost', fn: () => 'toll_cost()',
      title: () => 'One hop too many is toll-free',
      symptom: [
        () => `toll_cost() lets one more hop through for free than free_hops says: with free_hops=1 the first two hops are free.`,
      ],
      herring: [
        () => `With free_hops=1 only the very first hop is free. I would read free_hops=1 as "free up to and including hop number 1", i.e. the first two hops (0 and 1) free.`,
      ],
      killers: (p, r) => { const [a, b, c, d] = p.towns; const tolls = { [`${a}>${b}`]: 100, [`${b}>${c}`]: 200, [`${c}>${d}`]: 300 };
        return [Case('test_free_hops_count', [Fn('toll_cost', [[a, b, c, d], tolls], { free_hops: 1 }), Fn('toll_cost', [[a, b, c, d], tolls], { free_hops: 0 }), Fn('toll_cost', [[a, b, c, d], tolls])])]; },
    },
    toll_dir: {
      section: 'tolls', op: 'swapped-arguments', fnKey: 'toll_cost', fn: () => 'toll_cost()',
      title: () => 'Tolls charged for the opposite direction',
      symptom: [
        () => `toll_cost() charges the toll of the reverse direction. Our bridge is only tolled inbound, but outbound trips are being charged.`,
      ],
      killers: (p, r) => { const [a, b, c] = p.towns; return [Case('test_tolls_are_directional', [Fn('toll_cost', [[a, b, c], { [`${a}>${b}`]: 0, [`${b}>${c}`]: 250, [`${c}>${b}`]: 7 }], { free_hops: 0 })])]; },
    },
    fare_default: {
      section: 'tolls', op: 'wrong-default', fnKey: 'fare', fn: () => 'fare()',
      title: () => 'Fares too high with the default rate',
      symptom: [
        p => `fare() overcharges when cents_per_cost is not passed. The documented default is ${p.cpc} cents per unit of cost.`,
      ],
      killers: (p, r) => { const [a, b, c] = p.towns; return [Case('test_fare_default_rate', [New('g', p.G), Call('g', 'add_edge', [a, b, r.int(2, 9)]), Call('g', 'add_edge', [b, c, 1]),
        Fn('fare', [Ref('g'), [a, b], {}]), Fn('fare', [Ref('g'), [a, c], {}]), Fn('cheapest_fare', [Ref('g'), a, c, {}])])]; },
    },
  },

  randoms: {
    core(p, r, i) { const [a, b] = r.sample(p.towns, 2); return Case(`test_route_network_${i}`, randomGraph(p, r, [Fn('shortest_path', [Ref('g'), r.pick(p.towns), r.pick(p.towns)]),
      Call('g', 'remove_edge', [a, b], r.chance(0.5) ? { bidirectional: false } : {}), Fn('shortest_path', [Ref('g'), a, b]),
      Fn('shortest_path', [Ref('g'), r.pick(p.towns), r.pick(p.towns)]), Call('g', 'neighbours', [r.pick(p.towns)]), Call('g', 'nodes')])); },
    paths(p, r, i) { return Case(`test_reachability_${i}`, randomGraph(p, r, [Fn('path_cost', [Ref('g'), r.sample(p.towns, 3)]), Fn('within_budget', [Ref('g'), r.pick(p.towns), r.int(0, 12)]),
      Fn('within_hops', [Ref('g'), r.pick(p.towns), r.int(0, 3)]), Fn('nearest', [Ref('g'), r.pick(p.towns), r.sample(p.towns, 3)])])); },
    avoid(p, r, i) { return Case(`test_route_via_${i}`, randomGraph(p, r, [Fn('route_via', [Ref('g'), r.sample(p.towns, 3)]),
      Fn('detour_cost', [Ref('g'), p.towns[0], p.towns[6], [r.pick(p.towns.slice(1, 6))]])])); },
    network(p, r, i) { return Case(`test_network_report_${i}`, randomGraph(p, r, [Fn('components', [Ref('g')]), Fn('degree_table', [Ref('g')], { min_degree: r.int(1, 3) }),
      Fn('isolated_nodes', [Ref('g')]), Fn('in_degree', [Ref('g'), r.pick(p.towns)])])); },
    tolls(p, r, i) {
      const path = r.sample(p.towns, 4); const tolls = {};
      for (let k = 0; k < 3; k++) tolls[`${path[k]}>${path[k + 1]}`] = r.int(0, 5) * 50;
      return Case(`test_toll_values_${i}`, randomGraph(p, r, [Fn('toll_cost', [path, tolls], { free_hops: r.int(0, 2) }), Fn('fare', [Ref('g'), path.slice(0, 2), tolls]),
        Fn('cheapest_fare', [Ref('g'), path[0], path[3], tolls], { cents_per_cost: r.int(5, 20) })]));
    },
  },

  render(p, { m, d, inc }) {
    const out = [];
    out.push(`"""${p.mod}: weighted route finding for the ${p.network} network.

Edge costs are non-negative integers.  Paths are lists of node names.  When
several cheapest paths exist, the one whose list of node names is
lexicographically smallest wins, so results are deterministic.
"""
import heapq


class ${p.G}:
    """Directed adjacency map: node -> {neighbour: cost}."""

    def __init__(self):
        self._adj = {}

    def add_node(self, node):
        """Register node (does nothing if it already exists)."""
        self._adj.setdefault(node, {})

    def add_edge(self, a, b, cost, bidirectional=${m('bidi_default', 'True', 'False')}):
        """Add a link from a to b, plus the link back from b to a unless
        bidirectional is False (links are two-way by default).

        cost must be a non-negative integer; zero-cost links are allowed.
        Adding an existing link again replaces its cost.
        """
${d('neg_cost', 8)}        if cost ${m('neg_cost', '<', '<=')} 0:
            raise ValueError("edge cost must be non-negative")
        self.add_node(a)
        self.add_node(b)
        self._adj[${m('dir_swap', 'a', 'b')}][${m('dir_swap', 'b', 'a')}] = cost
        if bidirectional:
            self._adj[${m('dir_swap', 'b', 'a')}][${m('dir_swap', 'a', 'b')}] = cost

    def remove_edge(self, a, b, bidirectional=True):
        """Remove the link from a to b (and from b to a unless bidirectional is
        False).  Missing links are ignored; nodes are kept."""
        self._adj.get(a, {}).pop(b, None)
        if bidirectional:
            self._adj.get(b, {}).pop(a, None)

    def neighbours(self, node):
        """Sorted [neighbour, cost] pairs for node; unknown nodes have none."""
        return sorted([nb, cost] for nb, cost in self._adj.get(node, {}).items())

    def nodes(self):
        """All node names, sorted."""
        return sorted(self._adj)


def shortest_path(graph, src, dst):
    """Cheapest route from src to dst as [cost, [src, ..., dst]].

    src == dst gives [0, [src]], even for a node the graph does not know.
    Otherwise, if either node is unknown or dst cannot be reached, the result
    is [None, []].
    """
    if src == dst:
        return [0, [src]]
${m('unknown_node', `    if src not in graph._adj or dst not in graph._adj:
        return [None, []]
`, '')}    heap = [(0, [src])]
    settled = set()
    while heap:
        cost, path = heapq.heappop(heap)
        node = path[-1]
        if node == dst:
            return [cost, path]
        if node in settled:
            continue
        settled.add(node)
        for nb, step in graph._adj[node].items():
            if nb not in settled:
                heapq.heappush(heap, (cost + step, path + [nb]))
    return [None, []]
`);
    if (inc('paths')) out.push(`

def path_cost(graph, path):
    """Total cost of following path link by link.

    A single-node path costs 0.  An empty path, or a path that uses a link
    that does not exist, gives None.
    """
${m('empty_path', `    if not path:
        return None
`, '')}    total = 0
    for a, b in zip(path, path[1:]):
        step = graph._adj.get(a, {}).get(b)
        if step is None:
            return None
        total += step
    return total


def within_budget(graph, src, budget):
    """Sorted nodes whose cheapest cost from src is at most budget (src itself
    is included at cost 0).  An unknown src gives []."""
    if src not in graph._adj:
        return []
    best = {src: 0}
    heap = [(0, src)]
    while heap:
        cost, node = heapq.heappop(heap)
        if cost > best[node]:
            continue
        for nb, step in graph._adj[node].items():
            new_cost = cost + step
            if new_cost ${m('budget_cmp', '<=', '<')} budget and new_cost < best.get(nb, budget + 1):
                best[nb] = new_cost
                heapq.heappush(heap, (new_cost, nb))
    return sorted(best)


def nearest(graph, src, candidates):
    """[candidate, cost] for the candidate with the cheapest route from src
    (ties go to the alphabetically first name), or None when no candidate is
    reachable.  src itself counts as a candidate at cost 0 if listed."""
    best = None
    for name in sorted(candidates):
        cost = shortest_path(graph, src, name)[0]
        if cost is not None and (best is None or cost ${m('nearest_tie', '<', '<=')} best[1]):
            best = [name, cost]
    return best


def within_hops(graph, src, max_hops):
    """Sorted nodes reachable from src over at most max_hops links (src is
    included, it needs 0 hops).  An unknown src gives []."""
    if src not in graph._adj:
        return []
    seen = {src}
    frontier = [src]
${d('hops_off', 4)}    for _ in range(${m('hops_off', 'max_hops', 'max_hops - 1')}):
        nxt = []
        for node in frontier:
            for nb in graph._adj[node]:
                if nb not in seen:
                    seen.add(nb)
                    nxt.append(nb)
${m('frontier_stale', `        frontier = nxt
`, '')}    return sorted(seen)
`);
    if (inc('avoid')) out.push(`

def route_via(graph, stops):
    """Cheapest route that visits stops in the given order, as [cost, path].

    Legs are joined without repeating the shared stop.  If any leg is
    impossible the result is [None, []]; a single stop gives [0, [stop]].
    """
    total = 0
    path = [stops[0]]
    for a, b in zip(stops, stops[1:]):
        cost, leg = shortest_path(graph, ${m('via_swap', 'a, b', 'b, a')})
        if cost is None:
            return [None, []]
        total += cost
        path.extend(leg[1:])
    return [total, path]


def without_nodes(graph, banned):
    """A new graph of the same class without the banned nodes and without any
    link that starts or ends at one of them."""
    clone = type(graph)()
    for node, links in graph._adj.items():
        if node in banned:
            continue
        clone.add_node(node)
        for nb, cost in links.items():
${m('ban_edges', `            if nb not in banned:
                clone.add_edge(node, nb, cost, bidirectional=False)
`, `            clone.add_edge(node, nb, cost, bidirectional=False)
`)}    return clone


def detour_cost(graph, src, dst, closed):
    """Extra cost of the cheapest src -> dst route when the nodes in closed
    cannot be used, compared with the normal cheapest route.  None when either
    route does not exist."""
    base = shortest_path(graph, src, dst)[0]
    alt = shortest_path(without_nodes(graph, closed), src, dst)[0]
    if base is None or alt is None:
        return None
    return ${m('detour_sign', 'alt - base', 'base - alt')}
`);
    if (inc('network')) out.push(`

def components(graph):
    """Groups of nodes that are connected when every link is treated as
    two-way.  Each group is a sorted list; groups are ordered by first node."""
    links = {node: set() for node in graph._adj}
    for a, edges in graph._adj.items():
        for b in edges:
            links[a].add(b)
${m('comp_dir', `            links[b].add(a)
`, '')}    seen = set()
    groups = []
    for start in sorted(links):
        if start in seen:
            continue
        seen.add(start)
        stack = [start]
        group = []
        while stack:
            node = stack.pop()
            group.append(node)
            for nb in links[node]:
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        groups.append(sorted(group))
    return groups


def degree_table(graph, min_degree=${m('deg_default', '1', '2')}):
    """[[node, out_degree], ...] for nodes with at least min_degree outgoing
    links (default 1), highest degree first, ties by node name."""
    rows = [[node, len(edges)] for node, edges in graph._adj.items() if len(edges) ${m('deg_cmp', '>=', '>')} min_degree]
    rows.sort(key=lambda row: (-row[1], row[0]))
    return rows


def in_degree(graph, node):
    """Number of links that end at node."""
    return sum(1 for edges in graph._adj.values() if node in edges)


def isolated_nodes(graph):
    """Sorted nodes with no outgoing and no incoming links."""
    targets = set()
    for edges in graph._adj.values():
        targets.update(edges)
    return sorted(node for node, edges in graph._adj.items() if not edges${m('iso_in', ' and node not in targets', '')})
`);
    if (inc('tolls')) out.push(`

def toll_cost(path, tolls, free_hops=${p.free}):
    """Toll in cents for driving along path.

    tolls maps "A>B" (one direction of a link) to cents.  The first free_hops
    hops of a trip are toll-free (default ${p.free}); hops without an entry are free.
    """
    total = 0
    for i, (a, b) in enumerate(zip(path, path[1:])):
        if i ${m('free_off', '<', '<=')} free_hops:
            continue
        total += tolls.get(${m('toll_dir', 'a + ">" + b', 'b + ">" + a')}, 0)
    return total


def fare(graph, path, tolls, cents_per_cost=${m('fare_default', String(p.cpc), String(p.cpc + 5))}):
    """Price of a trip in cents: cents_per_cost (default ${p.cpc}) for every unit of
    link cost along path, plus toll_cost(path, tolls).  None when path uses a
    missing link."""
    total = 0
    for a, b in zip(path, path[1:]):
        step = graph._adj.get(a, {}).get(b)
        if step is None:
            return None
        total += step
    return total * cents_per_cost + toll_cost(path, tolls)


def cheapest_fare(graph, src, dst, tolls, cents_per_cost=${p.cpc}):
    """Cheapest trip by fare among simple paths from src to dst with at most 5
    hops, as [fare, path]; ties go to the path with fewer nodes, then to the
    lexicographically smaller one.  [None, []] when there is no such path."""
    best = None
    stack = [[src]]
    while stack:
        path = stack.pop()
        node = path[-1]
        if node == dst:
            key = (fare(graph, path, tolls, cents_per_cost), len(path), path)
            if best is None or key < best:
                best = key
            continue
        if len(path) > 5:
            continue
        for nb in graph._adj.get(node, {}):
            if nb not in path:
                stack.append(path + [nb])
    if best is None:
        return [None, []]
    return [best[0], best[2]]
`);
    return out.join('');
  },

  notes(p, inc) {
    const out = [`# ${p.mod} design notes

${p.mod} is the routing core for the ${p.network} network. Node names are depot or stop names; costs are
integer minutes.

## Graph and shortest paths
- Links are two-way unless bidirectional=False is passed; a one-way link from A to B can only be used
  from A.
- Cost 0 is valid (in-station transfers). Only negative costs are rejected.
- shortest_path() never raises for unknown nodes; it reports [None, []]. Equal-cost ties go to the
  lexicographically smaller path.`];
    if (inc('paths')) out.push(`
## Reachability
- path_cost([]) is None; path_cost([x]) is 0.
- within_budget() is inclusive of the budget; within_hops() counts links (max_hops=2 reaches nodes two
  links away).
- nearest() breaks cost ties alphabetically (first name wins).`);
    if (inc('avoid')) out.push(`
## Closures
- route_via() computes each leg from the earlier stop to the later one.
- A closed node disappears entirely, including links into it. detour_cost() is the extra cost
  (never a saving).`);
    if (inc('network')) out.push(`
## Structure reports
- components() ignores link direction.
- degree_table() counts outgoing links; min_degree is inclusive and defaults to 1.
- A node that something links to is not isolated, even if it has no outgoing links.`);
    if (inc('tolls')) out.push(`
## Tolls and fares
- Tolls are per direction ("A>B"). The first free_hops hops (default ${p.free}) are free: hop indexes
  0 .. free_hops - 1.
- Fares charge ${p.cpc} cents per cost unit by default, plus tolls.`);
    return out.join('\n') + '\n';
  },
};

function randomGraph(p, r, queries) {
  const steps = [New('g', p.G)];
  const n = r.int(6, 10);
  for (let k = 0; k < n; k++) {
    const [a, b] = r.sample(p.towns, 2);
    steps.push(Call('g', 'add_edge', [a, b, r.int(0, 9)], r.chance(0.3) ? { bidirectional: false } : {}));
  }
  return [...steps, ...queries];
}
