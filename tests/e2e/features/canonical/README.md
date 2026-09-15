# Code-faithful UX specifications

These Gherkin files describe the inspected Piclaw implementation. Classic is authoritative when skin behaviour differs. They are specifications, not automatically bound browser tests or accepted Tau/Vibes parity contracts.

Start with [COMPLETION.md](COMPLETION.md) for all 24 feature files and 241 scenario IDs. The index includes the original PR scenarios, adjacent regression features and added auth, Settings, workspace and interaction flows.

## Evidence and limits

- [Original audit](audit/original.md) traces the original 28 scenarios and the later SVG contribution.
- [Skin differences](audit/differences.md) separates Classic, Visual, family access and optional add-on capabilities.
- [Independent review](audit/review.md) records bounded source reviews and the disposition of each finding.
- [Validation](audit/validation.md) separates passing local gates from the failing immutable contract oracle. No browser suite was run.

`runtime/test/features/canonical-ux-contract.test.ts` pins the input feature's hash and required wording. The audit leaves that executable test unchanged and reports its failure. Its aspirational idle-Steer and inline-SVG expectations are recorded as gaps; Gherkin corrections do not implement them.

## Coded boundaries

- Loaded skills appear as `/skill:<name>` entries in the Slash commands group.
- Command prefill replaces the compose text without submitting it.
- Plan requires its external add-on; save guards use timestamps and request state, not a revision API.
- Returning a queued item replaces text/references, clears media and schedules removal. Idle Steer may send immediately after a turn ends.
- Picker, queue and model operations use their specific selection and reconciliation paths; no atomic whole-shell or exactly-once guarantee is asserted.
- Message reads support explicit IDs and bounded windows subject to access scope.
- Classic fenced SVG remains code text. No generic inline-SVG conversion contract is implemented at this baseline.
- Missing per-clause executable evidence and browser runs stay explicit in the completion matrix.
