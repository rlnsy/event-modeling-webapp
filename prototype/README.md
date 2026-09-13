# Connector routing (TASK-5)

The editor integrates the separated-connectors prototype from `df88372` and
`ff78477`. Load `prototype/crowded.json` in the JSON editor to exercise its eleven
connections. The example remains a fixture rather than a separate editor mode.

## Routing and layout

Each connection receives spatially ordered source/destination ports. Reversed
destination ordering allows nested U-shaped fan-in. Terminal corridors are
reserved before routing; A* searches an orthogonal visibility grid, reserving
16px around cards and 7px around existing line centers. Paths use attached SVG
end markers with a 16px minimum straight approach for the 10px arrowhead.

The global layout policy preserves slice order and adjacent-slice dependency
selection. It starts with 48px slice gaps and 96px lane gaps. If routes are missing,
it expands both gaps by 64px, measures all cards again, and reroutes the entire
graph, with at most two expansions. A new model render resets spacing. Within a
render, expanded spacing stays stable through viewport changes. This deliberately
does not rearrange the domain's slices or alter dependency semantics.

## Responsiveness and cache

All searches run in a Web Worker. A changed layout terminates the old worker;
generation checks also prevent late results from drawing over a newer render.
Identical pending requests share a job. Completed results use an eight-entry LRU
cache keyed by the ordered connections (including kind) and every card's geometry.
Card growth, obstacle changes, connection edits, and changed positions miss the
cache; scrolling alone does not. Empty models cancel work and clear the overlay.
Both cards and their row are observed for resize.

Workers have a ten-second deadline per layout attempt. Worker startup errors and
deadlines report omitted connections without doing pointless spacing retries.
Serve over HTTP with same-origin workers allowed. There is no synchronous fallback.

## Engine evaluation

Decision: harden the custom router for this editor. [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
offers orthogonal routing, port constraints, spacing, and crossing minimization.
Those features make it a candidate for broader graph layout, but do not by
themselves establish this editor's strict no-crossing/no-touching acceptance
criteria. Adopting it would still require a geometry validity gate and integration
with the fixed slice/lane semantics. This is a documentation-based evaluation,
not a comparative ELK performance benchmark.

The custom router already encodes the required clearances and terminal ordering;
its worker integration and bounded spacing expansion preserve the existing editor
structure without introducing another dependency. Any future engine should pass
the same geometry and lifecycle suite before replacing it.

## Remaining limits

Search uses bounded deterministic edge orders and a 24,000-vertex grid cap; neither
the router nor spacing expansion guarantees finding every feasible arrangement.
Very dense ports, nonplanar connections, or resource limits can leave routes
missing. The readout identifies every omitted source/destination and reports
drawn/total counts. Rendered paths never use an intersecting fallback. At most three
layout attempts run before the final partial result; editing can cancel any attempt.

## Verification

- `npm test`: geometry, navigation, layout, cancellation, late replies, cache
  invalidation/eviction, failures, and timeouts. The captured crowded geometry
  verifies all eleven routes, 16px card clearance, and 7px line spacing.
- `npm run check` and `bun run build`: syntax and deployment assets, including workers.
- Browser: start `python3 -m http.server 8082 --bind 127.0.0.1`, then run
  `node tests/routing.browser.cjs` with Playwright available on the Node module path.
  `ROUTING_TEST_URL` overrides the server URL. This uses an isolated Chromium session.
  Checks cover the crowded fixture, resize, card growth, global spacing recovery,
  explicit omissions in a forced infeasible layout, geometry of remaining routes,
  attached markers, empty-model cleanup, and browser errors.

Verified in Chromium: crowded, resized, grown, and spacing-recovered layouts draw
11/11 with no intersections or conflicting paths. Forced zero lane spacing draws
2/11 and names all nine omissions. No browser errors occurred.
