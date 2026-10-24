/**
 * web/ui-context.ts – Extension UI context implementation.
 *
 * Implements the ExtensionUIContext interface used by pi-agent extensions
 * to request user input. Backed by the UI bridge for actual delivery.
 *
 * Consumers: web tools create a chat-scoped UIContext for browser requests.
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import type { WebChannelLike } from "./core/web-channel-contracts.js";
import { UiBridge, type UiBridgeChannel } from "./theming/ui-bridge.js";

/** Channel shape required for web UI request/theme helpers. */
export type UiContextChannel = UiBridgeChannel & { uiBridge?: UiBridge };

function getBridge(channel: UiContextChannel): UiBridge {
  return channel.uiBridge ?? new UiBridge(channel);
}

/** Create an ExtensionUIContext backed by the given UiBridge. */
export function createUiContext(channel: WebChannelLike | UiContextChannel, chatJid: string): ExtensionUIContext {
  return getBridge(channel).createUiContext(chatJid);
}
