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

  @ux-themes-003
  Scenario: Honour explicit variants and browser-local automatic mode
    Given an automatic Default, Solarized or GitHub palette is selected
    When I choose a local light, dark or system mode preference
    Then the automatic palette follows that preference
    When I select an explicit light or dark palette
    Then its declared mode wins over the system colour scheme

  @ux-themes-004
  Scenario: Keep SynthWave glow optional and decorative
    Given SynthWave 84 is selected
    Then syntax tokens and selected accents have static glow
    And ordinary prose does not glow
    When I disable glow or enable forced colours
    Then the glow disappears
    When I select a different palette
    Then no SynthWave glow remains

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
