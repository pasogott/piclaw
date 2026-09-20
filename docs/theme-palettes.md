# Web theme palettes

Classic and Visual use the same named palette catalogue. Each skin keeps its own layout, typography and control sizes. Default retains each skin's familiar starting colours; **PiClaw Classic** is the explicit black Classic palette in either skin.

## Choose a theme

Use **Settings → Appearance** in either skin, or `/theme <id>`. Named palette and Default tint settings are instance-wide. Existing theme IDs remain valid; `monokai` is labelled **Monokai Original** and `monokai-pro` is **Monokai Pro** everywhere. They are separate palettes, not light/dark variants.

**Automatic theme mode (this browser)** selects system/light/dark for the Default, Solarized and GitHub automatic pairs. Explicit Light/Dark presets keep their own mode. This local preference does not change another user's browser. Default tint applies only to Default; selecting a named palette uses its authored accent.

**SynthWave ’84 includes its glow.** Selecting the theme always enables static syntax and selected-action glow; there is no separate setting and old browser opt-out values are ignored. Choosing another palette removes the glow. Ordinary prose stays sharp, there is no pulsing/animation, and forced-colours mode suppresses decorative shadows for accessibility. Canvas-based terminals follow the palette but do not receive fake CSS text glow.

## Catalogue

| Family | IDs / variants |
|---|---|
| Default / Classic | `default` (automatic), `piclaw-classic` (dark), `tango` (light), `xterm` (dark) |
| Monokai | `monokai` (**Original**), `monokai-pro` (**Pro**), `ristretto` |
| Familiar dark palettes | `dracula`, `nord`, `tokyo`, `miasma`, `gotham`, `one-dark-pro` |
| GitHub | `github` (automatic), `github-light`, `github-dark` |
| Solarized | `solarized` (automatic), `solarized-light`, `solarized-dark` |
| VS Code / Ayu | `vscode-light`, `vscode-dark`, `ayu-light`, `ayu-dark` |
| Gruvbox | `gruvbox` (dark), `gruvbox-light` |
| Catppuccin | `catppuccin` (Mocha), `catppuccin-latte` |
| Everforest | `everforest-dark`, `everforest-light` (medium-background palettes) |
| Rosé Pine | `rose-pine`, `rose-pine-dawn` |
| Neutral concepts | `graphite`, `paper`, `oled` |
| Accessibility-focused concepts | `accessible-dark`, `accessible-light`, `colour-friendly-dark`, `colour-friendly-light` |
| Warm/cool concepts | `petrol`, `petrol-light` (Ivory & Petrol), `aubergine`, `burgundy`, `porcelain` |
| Vivid adaptations | `cobalt2`, `synthwave-84` |

The catalogue has 45 IDs, including explicit variants and automatic pairs. Aliases include `monokai-original`, `catppuccin-mocha`, `tokyo-night`, `synthwave` and `petrol-copper`. Unlike the historical aliases, explicit `solarized-light/dark` and `github-light/dark` now choose their labelled mode rather than silently following the system.

The approved custom concepts are Piclaw palettes, not upstream theme products. Cobalt2 uses its blue/yellow vocabulary with a yellow primary action; SynthWave uses its midnight/magenta/cyan vocabulary with static glow. Both are adapted mappings, not claims of pixel-identical upstream UI styling.

## Colour roles and contrast

`runtime/src/core/ui-theme-catalogue.ts` contains data only. Server theme discovery, Classic, and Visual use those IDs and colours. `runtime/web/src/ui/theme-palette.ts` derives both skins' CSS namespaces from one palette:

- surfaces, foregrounds, muted text, borders and accents;
- maximum-contrast black/white text on accent buttons;
- warning/error/success, selection, focus, overlay and tint roles;
- syntax/code colours and terminal ANSI colours;
- reusable chart series colours.

Primary/secondary text is adjusted towards the palette foreground where needed to reach 4.5:1 on the declared solid UI surfaces. Syntax/ANSI text is adjusted against its code/terminal surface. Palette identity and characteristic accents are retained. These calculations are guardrails, not certification of every rendered component: alpha composition, images, custom add-ons and font sizes need their own checks. Colour-friendly presets change semantic hues; status text and existing icons remain necessary. The accessible pair targets stronger contrast without globally resizing controls.

Visual xterm now reads the selected palette and refreshes on theme changes without reconnecting or injecting terminal input. Classic retains its terminal contrast safeguards and uses the same ANSI roles. No renderer, terminal protocol or VNC input mapping changes are made.

## Imported Visual themes

VS Code JSON imports remain local to the browser. Import preview uses the declared dark/light/high-contrast type (or background inference for legacy saved maps), fills shared semantic aliases and keeps supported terminal overrides. Apply persists the map; Cancel restores the saved custom map or the selected named palette. Reset clears the custom override and returns to the instance Default selection.

An active custom import intentionally overrides server theme events in that browser, but the latest instance palette is still remembered for returning from the override. Imported theme values must be valid CSS colours; injected stylesheet fragments are rejected. The importer still supports a subset of VS Code fields/scopes, not arbitrary extensions or scripts.

## Palette provenance

Colour data, adapted to Piclaw roles:

- Existing Piclaw Classic and Visual presets form the compatibility baseline (`eef87deaf`).
- [Catppuccin palette v1.8.0](https://github.com/catppuccin/palette): Latte and Mocha; MIT.
- [Everforest](https://github.com/sainnhe/everforest): medium dark/light palette; MIT.
- [Rosé Pine palette](https://github.com/rose-pine/palette): main and Dawn; MIT.
- [Cobalt2](https://github.com/wesbos/cobalt2-vscode): editor surfaces and syntax colour vocabulary; MIT.
- [SynthWave ’84](https://github.com/robb0wen/synthwave-vscode): colour vocabulary; MIT. Glow here is a small native CSS treatment, not its editor-patching code.

No external theme assets are fetched at runtime or during builds. Palette sources and upstream licence notices are recorded in `runtime/vendor-manifests/theme-palettes.json` and `docs/licenses/theme-palettes.txt`.

## Validation

`shared-themes.test.ts` checks catalogue parity, aliases, Original/Pro identity, complete semantic/ANSI roles and contrast. `shared-themes.playwright.optional.test.ts` uses real Appearance components with disposable stub APIs in Chromium and WebKit, checks every preset, actual selection, mode switching, intrinsic glow/forced colours, real syntax classes, import preview/cancel/reset/reload, and a mounted xterm with a stub socket. It never changes the active instance's theme or opens its terminal.
