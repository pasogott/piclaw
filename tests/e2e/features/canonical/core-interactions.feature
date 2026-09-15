@canonical @source-reviewed
Feature: Additional core interaction surfaces
  These flows supplement the original contract and the existing feature folders.
  Each Rule names its skin or capability boundary; no cross-port parity is implied.

  Rule: Classic side-question panel
    @ux-extra-001 @classic @btw
    Scenario: Display and act on a side-question result
      Given the Classic BTW panel has a question and a supplied result state
      When it renders
      Then it shows available question, error and thinking content
      And its answer and action footer are hidden while running
      And a completed non-empty answer is shown
      And visible Retry requires a question
      And visible Inject into chat is disabled without an answer
      When I activate enabled Retry or Inject into chat
      Then the supplied retry or inject callback runs

  Rule: Classic Adaptive Cards
    @ux-extra-002 @classic @adaptive-cards
    Scenario: Validate the identity of a card submission
      Given the client is building an Adaptive Card submission
      Then it requires a non-empty bounded card identifier
      And a positive safe-integer source-post identifier
      And a parseable submitted-at timestamp
      And the supported submission action is Action.Submit

    @ux-extra-003 @classic @adaptive-cards
    Scenario: Display a rejected card action
      Given a rendered card action starts an asynchronous submission
      When the submission rejects
      Then the card action path reports the error in its UI notice
      And it does not present the rejected action as a successful response

  Rule: Classic generated widgets
    @ux-extra-004 @classic @widgets
    Scenario: Interpret persisted and live widget artifacts separately
      Given widget metadata identifies an HTML or SVG artifact
      When the client resolves a persisted timeline artifact
      Then non-empty artifact content is required for a usable persisted widget
      When the client resolves an unfinished live artifact
      Then it can represent a streaming widget before the final content exists
      And loading, streaming, final and error are distinct artifact states

    @ux-extra-005 @classic @widgets
    Scenario: Keep widget dismissal separate from queue mutation
      Given a live floating widget is visible
      When I close the floating pane
      Then the client records dismissal of that widget session
      And closing the pane does not itself steer or remove a queued follow-up

  Rule: Visual sidebar search
    @ux-extra-006 @visual @search
    Scenario: Search messages with the Visual search panel
      Given the Visual Search panel is open
      When I change the query or current, root or all scope
      Then search is scheduled with the panel's debounce
      And an earlier in-flight search is aborted
      And requests include the scope and supported image or attachment filters
      And the panel displays loading, error or empty-result feedback as applicable

    @ux-extra-007 @visual @search
    Scenario: Activate a Visual search result
      Given a Visual search result has a message identifier
      When I click it or activate it with Enter or Space
      Then the panel dispatches a scroll-to-message event for that identifier
      And it asks the sidebar to close

  Rule: Visual scheduled-task panel
    @ux-extra-008 @visual @scheduled-tasks
    Scenario: Control an existing scheduled task
      Given the Visual Tasks panel has loaded tasks
      When I activate a supported pause, resume or delete action
      Then the action targets that task identifier
      And that task's action controls are disabled while it is busy
      And a completed action request refreshes task state even when the server rejects the mutation
      And a rejected mutation or network exception is logged as a warning
      And a network exception during the mutation does not reach the subsequent refresh call
      And a failure to fetch the task list shows the panel error with Retry

  Rule: Visual scratchpad
    @ux-extra-009 @visual @scratchpad
    Scenario: Submit a scratchpad note without prematurely marking it sent
      Given a scratchpad note contains sendable text
      When I send it to the chat
      Then the panel uses the configured message endpoint
      And it marks the note sent only after a successful response
      And failure leaves it unsent and emits an error status flash

    @ux-extra-010 @visual @scratchpad
    Scenario: Persist scratchpad split sizing
      Given the Visual scratchpad split panes are visible
      When I drag the split divider
      Then the split is constrained to the panel's supported twenty-to-eighty percent range
      And its position is stored in the scratchpad split preference

  Rule: Classic notification coordination
    @ux-extra-011 @classic @notifications
    Scenario: Coordinate local notification ownership across clients
      Given client presence snapshots identify device, selected chat and visibility
      When the notification coordinator chooses a local recipient
      Then it considers the current snapshot and live same-device presence entries for that chat
      And any visible candidate suppresses local notification delivery
      And otherwise only the lexicographically first client identifier may deliver locally
      And withdrawing a client's presence removes its published storage entry
      # Browser permission, delivery and sound support are separate capability gates.

  Rule: Classic recovery presentation
    @ux-extra-012 @classic @recovery
    Scenario: Hide validated recovery control posts
      Given a post has a valid protected_recovery_continuation control-intent block
      When the Classic post component renders it
      Then the control post is omitted from the visible timeline
      And invalid typed recovery fields do not qualify it for this control-intent hiding path

    @ux-extra-013 @classic @recovery
    Scenario: Suppress an empty informational recovery placeholder
      Given an agent post has the agent-recovery type and info status
      And it has no renderable text, attachments, card or card submission
      When the Classic post component renders it
      Then the placeholder is omitted from the visible timeline
      # Recovery, timeout and turn-outcome metadata are separate from user controls.
