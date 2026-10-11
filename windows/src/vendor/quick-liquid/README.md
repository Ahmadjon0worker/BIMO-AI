# QuickLiquid (vendored vanilla DOM subset)

Source: https://github.com/amarnath3003/quickLiquid

Pinned revision: `fbb19b5f1cd4097e62831da44df0bee0097433ca`.

MIT © 2026 Amarnath. The full upstream license is retained in `LICENSE`.

Included from `packages/quick-liquid/src`: `core/engine.ts`, `core/config.ts`,
`core/optics.ts`, and `animations/spring.ts`. React, demos, group morphing,
gesture drag helpers, and package dependencies are deliberately omitted.

The application adapter in `../../effects/liquid.ts` mounts each engine on a
decorative, empty child instead of the interactive host. Upstream can wrap that
child, add its layers, and manage transforms without reparenting the app's flex
or grid content, clipping companion hands, or overwriting panel docking motion.
SVG displacement and per-channel dispersion use the upstream optical model;
equal geometry shares its reference-counted displacement maps. Press feedback
uses the upstream analytical spring on CSS `scale`, independent of `transform`.

Local adaptations: the engine's `setLightPosition` forwards host pointer lighting
without synthesizing input events; resize rasterization waits 90 ms for panel
docking/expansion to settle instead of allocating maps on every transition frame.
Rendering remains inert to pointer hit tests.
No network access, wallpaper capture, or user data enters this library.
