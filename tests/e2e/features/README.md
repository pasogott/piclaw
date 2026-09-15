# Import UX specifications by skin

Import one of these roots recursively. Each scenario occurs once across the two roots.

| Skin | Import glob | Feature files | Scenarios / outlines | Example rows |
|---|---|---:|---:|---:|
| Classic | `tests/e2e/features/classic/**/*.feature` | 24 | 236 | 25 |
| Visual | `tests/e2e/features/visual/**/*.feature` | 1 | 5 | 0 |

- [Classic](classic/README.md) retains the existing topic subfolders, including `canonical/`, `compose/`, `editor/`, `mobile/`, `panes/`, `sessions/`, `settings/` and `timeline/`.
- [Visual](visual/README.md) contains the separately source-reviewed search, scheduled-task and scratchpad scenarios. Classic behaviour has not been copied into Visual or asserted as skin parity.
- [Completion matrix](canonical/COMPLETION.md) and [audit evidence](canonical/README.md) stay outside the import roots.

The mixed interaction feature was split at complete Rule boundaries. All 241 scenario IDs, titles, tags, steps, examples, rule names and backgrounds are preserved. Use stable `@ux-*` IDs when carrying implementation mappings across the path change. File-level skin tags were added to the two split features.

## Import and test boundaries

These files are Gherkin specifications. Importers must supply their own step bindings and fixtures. The repository's Playwright configuration runs `tests/e2e/steps`, not these Gherkin files automatically. Feature imports do not imply browser execution or complete cross-port parity.

The immutable test `runtime/test/features/canonical-ux-contract.test.ts` still reads the old `canonical/canonical-ux.feature` location relative to this directory. It was already failing on the corrected feature's hash; after this move it fails with `ENOENT`. Executable tests were left unchanged under the audit scope. No duplicate feature or symlink is kept at the old location, so recursive imports cannot discover a second copy. Updating that test's path and contract expectations needs separate authorisation.
