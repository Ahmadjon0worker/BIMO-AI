# thinking-orbs engine

Source: https://github.com/Jakubantalik/thinking-orbs

Pinned upstream commit: `de85557ca220332586d070d8788c0e1d6e877a0d`

Upstream version: `0.3.1`. Copyright (c) 2026 Jakub Antalik.
The upstream MIT license is retained in `LICENSE`.

`engine/*.ts` and `presets.ts` are the original framework-free geometry,
Canvas 2D painters, and all nine state presets. No React runtime or wrapper
is included. `types.ts` retains only `OrbState`, `OrbSize`, and `OrbTheme`;
the React-specific props are omitted. The unused compatibility parameter
`rMin` in `engine/core.ts` is named `_rMin` for the host's strict compiler.
Geometry and tuning are unchanged.

`golden-samples.json` is a compact selection from the pinned upstream
`spec/orbs-golden.json`: the first, middle, and last marks of every state,
both sizes, and four reference times. Counts and resolved presets are
retained, so host tests verify numerical compatibility against upstream
reference output rather than regenerate their own expectations.

The host adapter in `../../effects/thinking-orb.ts` provides plain DOM
creation, optional accent ink, accessible state labels, and a single shared
animation/lifecycle scheduler. Auto theme also respects the host's CSS
`color-scheme`, before falling back to the OS. It renders each upstream frame in its
original far-to-near order and keeps transparent backgrounds.
