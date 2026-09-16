# Planned UX contracts

Import `tests/e2e/features/planned/**/*.feature` only for desired acceptance work. Every feature is tagged `@planned @not-implemented`; neither parsing nor structural tests establish implementation.

## SVG images — #1325

[svg-images.feature](svg-images.feature) contains eight scenarios/outlines and nineteen example rows. Each case must run in both Classic and Visual; this is a target, not current parity. `@ux-original-029` retains the requested feature identity. IDs `@ux-svg-001`–`@ux-svg-007` cover scope, hazards, limits, fallback, accessibility, source copy and stream/reload reconciliation.

Before implementing, #1325 must specify exact finite byte/node/depth limits and a sanitisation policy. The examples describe boundary relationships rather than inventing product defaults in this specification PR. Browser bindings must expand those relationships into concrete fixtures and record the chosen limits. They must not skip a missing renderer and count the case as passing. Lower-level parser/sanitizer tests must verify byte-limit rejection before XML parsing and termination of structural validation at the first over-limit node; the Gherkin asserts visible rejection and fallback.

Promote this feature only after direct assertion mappings and both-skin browser validation exist. Move stable IDs rather than copying them into multiple recursive roots. Keep the [70d33bc93 baseline](../canonical/audit/svg-images.md) as historical evidence; remove or replace the temporary source-only browser expectation when the desired renderer passes.

No generic HTML rendering, widget API, attachment redesign, provider change or deployment is included.
