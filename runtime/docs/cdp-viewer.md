# Live browser pane

Use **Open browser in tab** in the timeline menu to view tabs from `cdp_browser` and registered Stealth Browser sessions. The pane streams the selected page through CDP without VNC or a second browser.

The backend requires enabled web authentication, a valid authenticated request and same-origin checks. Multi-user mode is refused because browser ownership is currently instance-wide. Browser endpoints stay on the backend; the UI chooses registered source and tab IDs only.

The default is view-only and scale-to-fit. Scaling preserves aspect ratio and browser dimensions; letterbox regions reject input. **Take control** enables mouse, wheel, keys, text and single-touch gestures. A running browser tool prevents takeover; manual control prevents new tool actions. Release control before asking the agent to resume.

**Resize browser to pane** is explicit, debounced and bounded. It changes page layout and can affect stealth fingerprints. Releasing control, detaching or closing clears the viewer's emulation override. Stealth Browser 0.1.2 declares that native metrics restoration is appropriate for Mochi 0.9.5; unsupported source restoration is refused. Scale-to-fit never changes metrics.

Refresh tabs discovers current targets; Reconnect reopens a disconnected transport. Switching targets or closing the pane stops screencasting and releases viewer-owned input/control without closing the browser. One pane may stream a target at a time. Frames and queued inputs are bounded, and a stalled frame acknowledgement closes the viewer connection.

This implementation does not record or replay sessions or display browser chrome. Existing browser tools retain launch and shutdown ownership. Add-ons use the trusted `__piclaw_registerCdpViewSource` registration and `__piclaw_beginCdpViewTool` guard; clients cannot provide arbitrary debugging URLs or CDP methods.
