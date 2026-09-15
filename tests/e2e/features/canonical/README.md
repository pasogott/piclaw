# Canonical cross-port UX contract

`canonical-ux.feature` is the vetted observable compatibility contract shared by Piclaw, Tau, and Vibes.

Piclaw behavior is the baseline except where a scenario is explicitly tagged `@safety-deviation`. Those scenarios document a safer result that every port, including Piclaw, should converge on rather than preserving a known defect.

The feature file is a specification, not a claim that `playwright-bdd` automatically binds every sentence to a step definition. Repository-owned Bun and Playwright tests provide executable evidence for individual behaviors. `runtime/test/features/canonical-ux-contract.test.ts` prevents the canonical specification from drifting or silently losing required topics.

## Piclaw owns default behavior

When an observable default is unspecified or differs across ports, this contract asks Piclaw maintainers to complete the decision in Piclaw first: choose the intended safe default, state it explicitly in Gherkin, and add executable Piclaw evidence. Tau and Vibes should then converge on that formalized behavior. Accidental implementation differences, missing assertions, renderer quirks, and unsupported capabilities must not silently become defaults.

Key conventions include:

- loaded skills are exposed as authoritative `/skill:<name>` slash commands and appear in Quick Actions under **Slash commands**;
- no synthetic Skills group is invented;
- Plan uses canonical Markdown checklist markers and a session-scoped model tool;
- session and model pickers provide search and keyboard typeahead;
- timeline copy/delete operations use durable message identity;
- the model-facing messages tool supports explicit IDs and bounded row windows;
- tool execution panes preserve lifecycle identity, glyph meaning, elapsed-time behavior, reconnect state, focus, and accessibility.
