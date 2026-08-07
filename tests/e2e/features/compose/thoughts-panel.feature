Feature: Thoughts panel expand and scroll
  As a user monitoring agent reasoning
  I want the thoughts panel to become scrollable when expanded
  And revert to collapsed (non-scrollable) when I close it
  So that I can read long reasoning without losing my place

  Background:
    Given I am authenticated and on the main chat
    And the agent is producing thinking output

  Scenario: Collapsed thoughts panel is not scrollable
    Given the agent has produced more than 8 lines of thought
    Then the thoughts panel should show "N more lines" button
    And the thoughts panel body should have overflow-y hidden
    And the thoughts panel body max-height should be clamped

  Scenario: Collapsed thoughts continue receiving streamed content
    Given the thoughts panel is collapsed
    When more thinking output arrives
    Then the new thought content should be present
    And the panel data-expanded attribute should remain "false"

  Scenario: Clicking "more lines" expands and enables scrolling
    Given the thoughts panel shows "N more lines"
    When I click the "more lines" button
    Then the panel data-expanded attribute should be "true"
    And the thoughts panel body should have overflow-y auto
    And the thoughts panel body max-height should be constrained (52vh or 34rem)
    And the panel should be scrollable (scrollHeight > clientHeight when content is long)

  Scenario: Clicking "show less" collapses and disables scrolling
    Given the thoughts panel is expanded and scrollable
    When I click the "show less" button
    Then the panel data-expanded attribute should be "false"
    And the thoughts panel body should have overflow-y hidden
    And the thoughts panel body max-height should be clamped to collapsed lines

  Scenario: Expand/collapse round-trip preserves content
    Given the thoughts panel has content
    When I expand the panel
    And I scroll down in the panel
    And I collapse the panel
    And I expand the panel again
    Then the content should still be present
    And the scroll position should be at the top
