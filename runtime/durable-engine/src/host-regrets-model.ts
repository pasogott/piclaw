import { getDb } from "../../src/db/connection.js";
import { reserveHostRequest } from "./host-request-accounting.js";
import type { HostRegretsBindingOptions } from "./host-regrets-bindings.js";

type Decision = NonNullable<HostRegretsBindingOptions<never>["accountedDecision"]>;
/** Optional transport adapter for parents using host-request-accounting directly.
 * Parents with controller-owned reservations instead pass their accountedDecision
 * callback to createHostRegretsBindings; do not wrap that callback a second time.
 */
export function createHostRegretsAccountedDecision(options: Omit<Parameters<typeof reserveHostRequest>[0], "model" | "maxTokens"> & {
  getAvailable: Decision["getAvailable"];
  request: Decision["complete"];
}): Decision {
  return {
    getAvailable() { options.assertCurrent(); return options.getAvailable(); },
    async complete(model, context, requestOptions) {
      const signal = requestOptions.signal ? AbortSignal.any([options.signal, requestOptions.signal]) : options.signal;
      options.assertCurrent(); signal.throwIfAborted();
      // Reservation admission uses the application connection; never split ledgers.
      if (getDb() !== options.database) throw Error("Regrets accounting requires the active host Root database");
      const reservation = await reserveHostRequest({ ...options, model, maxTokens: requestOptions.maxTokens, signal });
      // No stored account/cost evidence is not permission for a free nested call.
      if (!reservation) throw Error("Regrets model request cannot be accounted");
      try {
        options.assertCurrent(); signal.throwIfAborted();
        await reservation.dispatch();
        options.assertCurrent(); signal.throwIfAborted();
        const message = await options.request(model, context, { ...requestOptions, signal });
        // Settle original evidence even if authority was revoked while awaiting.
        await reservation.settle(message);
        options.assertCurrent(); signal.throwIfAborted();
        return message;
      } finally { await reservation.abandon(); }
    },
  };
}
