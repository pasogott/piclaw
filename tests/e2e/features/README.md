# Import UX specifications by skin

Import the current-behaviour roots separately from the planned contract root. Each stable scenario ID occurs once across all roots.

| Skin | Import glob | Feature files | Scenarios / outlines | Example rows |
|---|---|---:|---:|---:|
| Classic — current | `tests/e2e/features/classic/**/*.feature` | 24 | 235 | 25 |
| Visual — current | `tests/e2e/features/visual/**/*.feature` | 1 | 5 | 0 |
| Planned — desired, not implemented | `tests/e2e/features/planned/**/*.feature` | 1 | 8 | 19 |

- [Classic](classic/README.md) retains the existing topic subfolders, including `canonical/`, `compose/`, `editor/`, `mobile/`, `panes/`, `sessions/`, `settings/` and `timeline/`.
- [Visual](visual/README.md) contains the separately source-reviewed search, scheduled-task and scratchpad scenarios. Classic behaviour has not been copied into Visual or asserted as skin parity.
- [Completion matrix](canonical/COMPLETION.md) and [audit evidence](canonical/README.md) stay outside the import roots.

The #1323 skin reorganisation preserved 241 scenario definitions. Follow-up #1324 moves `@ux-original-029` from a negative Classic baseline assertion to the desired SVG-image contract, adding seven focused acceptance cases. The current inventory has 248 scenarios/outlines in 26 files and 44 example rows. Other scenario definitions are unchanged.

[Planned SVG images](planned/README.md) target both skins but do not assert existing parity. Import `planned/` only to plan or bind future acceptance tests; never treat it as a passing current-behaviour suite.

## Import and test boundaries

These files are Gherkin specifications. Importers must supply their own step bindings and fixtures. The repository's Playwright configuration runs `tests/e2e/steps`, not these Gherkin files automatically. Feature imports do not imply browser execution or complete cross-port parity.

The repaired `runtime/test/features/canonical-ux-contract.test.ts` checks root separation, scenario identity and planned metadata without a whole-file hash or aspirational wording oracle. `run-feature-tests.ts` includes it in the feature gate. These structural checks do not execute Gherkin steps or prove SVG rendering. Parse the files with the existing E2E Cucumber toolchain when changing Gherkin.

`runtime/test/web/svg-fence-baseline.optional.test.ts` independently exercises the actual Classic renderer and code-copy enhancement in isolated browser documents. See [SVG evidence and commands](canonical/audit/svg-images.md). The source-only assertion is temporary baseline evidence; #1325 must replace it with desired renderer assertions when the feature is implemented.
