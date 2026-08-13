import { Result, type ExecutionEnv } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import type { ExecutionContextError } from "../contracts/execution-context-resolver.js";
import { PiclawExecutionEnv, type ShellEnvironmentPreparer } from "./execution-env-adapter.js";
import type { LocalExecutionEnvFactory } from "./execution-context-types.js";

export interface CurrentPiclawLocalExecutionEnvFactoryOptions {
  readonly cwd: string;
  readonly shellPath?: string;
  readonly prepareShellEnvironment: ShellEnvironmentPreparer;
  readonly createNodeEnv?: (options: { cwd: string; shellPath?: string }) => ExecutionEnv;
}

export class CurrentPiclawLocalExecutionEnvFactory implements LocalExecutionEnvFactory {
  readonly #cwd: string;
  readonly #shellPath?: string;
  readonly #prepareShellEnvironment: ShellEnvironmentPreparer;
  readonly #createNodeEnv: (options: { cwd: string; shellPath?: string }) => ExecutionEnv;

  constructor(options: CurrentPiclawLocalExecutionEnvFactoryOptions) {
    this.#cwd = options.cwd;
    this.#shellPath = options.shellPath;
    this.#prepareShellEnvironment = options.prepareShellEnvironment;
    this.#createNodeEnv = options.createNodeEnv ?? ((nodeOptions) => new NodeExecutionEnv(nodeOptions));
  }

  createLocalEnv() {
    try {
      const delegate = this.#createNodeEnv({
        cwd: this.#cwd,
        ...(this.#shellPath ? { shellPath: this.#shellPath } : {}),
      });
      return Result.ok(new PiclawExecutionEnv(delegate, this.#prepareShellEnvironment));
    } catch {
      return Result.err(error("environment_unavailable", true));
    }
  }
}

function error(_tag: ExecutionContextError["_tag"], retryable: boolean): ExecutionContextError {
  return Object.freeze({ _tag, certainty: "not_applied", retryable });
}
