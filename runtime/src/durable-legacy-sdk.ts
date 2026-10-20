/** Root-host SDK 1.2 boundary. Bare public names resolve from the Root
 * dependency graph, not the durable engine's isolated SDK 1.3 island.
 * Re-export actual bindings only; no session or extension-context emulation. */
export {
  DefaultResourceLoader, SettingsManager,
  createBashTool, createReadToolDefinition, createWriteToolDefinition,
  createEditToolDefinition, createLsToolDefinition, createFindToolDefinition,
  buildSessionProjection, buildSessionContext, convertToLlm, sessionEntryToContextMessages,
  type BashToolOptions, type ExtensionContext, type LoadExtensionsResult,
  type ModelRuntime, type RegisteredCommand, type SessionEntry, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
export type { AssistantMessage, Api, Model } from "@earendil-works/pi-ai";
export { McpClient } from "@earendil-works/pi-mcp";
