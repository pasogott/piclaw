@shared @implemented @browser-verified @themes
Feature: Shared palette identities with skin-specific interfaces
  # Acceptance prose; executable mappings:
  # runtime/test/web/shared-themes.test.ts
  # runtime/test/web/shared-themes.playwright.optional.test.ts
  # Run through test:local with PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1; no live theme changes.

  @ux-themes-001
  Scenario: Select every named palette in either skin
    Given Classic and Visual consume the same palette catalogue
    When a named palette is selected
    Then both token namespaces have matching surfaces, foregrounds and accents
    And the document and native control colour scheme match the selected mode
    And code and terminal roles are populated from that palette
    And each skin retains its own control layout and typography

  @ux-themes-002
  Scenario: Keep Monokai Original and Monokai Pro distinct
    When I choose Monokai Original through Appearance
    Then the theme identity is monokai with its vivid pink accent
    When I choose Monokai Pro through Appearance
    Then the theme identity is monokai-pro with its softer pink accent
    And the labels and palette identities are consistent across both skins
    And the Classic dialog has aligned Theme, Mode and Palette columns at desktop and phone widths

  @ux-themes-003
  Scenario: Honour explicit variants and browser-local automatic mode
    Given an automatic Default, Solarized or GitHub palette is selected
    When I choose a local light, dark or system mode preference
    Then the automatic palette follows that preference
    When I select an explicit light or dark palette
    Then its declared mode wins over the system colour scheme

  @ux-themes-004
  Scenario: Keep SynthWave glow intrinsic and decorative
    Given normal SynthWave 84 is selected
    Then syntax tokens and selected accents have static glow
    And ordinary prose does not glow
    And there is no separate glow control
    And an old browser opt-out cannot disable the theme's glow
    When I enable forced colours
    Then decorative shadows disappear
    When I select SynthWave 84 Full
    Then bright syntax cores have layered halos and slow pulsing
    And selected actions have animated neon lighting
    When I request reduced motion
    Then Full retains strong static glow without animation
    When the document becomes hidden
    Then the visibility handler pauses Full animations
    When I select a different palette
    Then no SynthWave glow or animation remains

  @ux-themes-005
  Scenario: Restore complete palettes after imported-theme preview
    Given a named palette is selected in Visual
    When I preview a light VS Code theme while the system is dark
    Then the imported background, foreground and colour scheme are light
    When I cancel the preview
    Then the previous named palette is restored without custom overrides
    When I apply an imported theme and reload
    Then the local override is restored
    When I reset
    Then the custom override is removed and Default is selected

  @ux-themes-006
  Scenario: Repaint a mounted terminal without remote side effects
    Given the real Visual xterm is mounted against a disposable stub socket
    When I switch between a light and dark palette
    Then the terminal background and text update without reconnecting
    And theme changes send no terminal input

  @ux-themes-007
  Scenario: Select the requested source-verified catalogue families
    Given the shared catalogue includes Turbo Pascal, Tokyo Night, Noctis, Bearded Arc, Catppuccin, Nord, AS400 and Lumon
    When I select each requested variant in Classic or Visual Appearance
    Then its stable ID and source-derived background are applied
    And Turbo Pascal is dark while Tokyo Night Light is light despite inconsistent source metadata
    And only SynthWave Full starts the Full-theme animations
    And explicit terminal ANSI colours retain the theme's identity
    And AS400 uses only green and black in syntax, status, overlays and every ANSI role
