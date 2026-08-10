# Tool, environment and resource migration to Earendil contracts

This inventory applies the direct-contract rule in [`earendil-native-effector-contracts.md`](earendil-native-effector-contracts.md) to Piclaw's current tool/resource surface.

## Core execution tools

| Current Piclaw surface | Earendil target | Replay | Required Piclaw work |
|---|---|---|---|
| coding-agent `read` | public `createReadTool()` | `safe` | Supply selected `ExecutionEnv`; inject image processor only if required |
| coding-agent `write` | public `createWriteTool()` | `never` | No legacy wrapper; test mutation queue and abort semantics |
| coding-agent `edit` | public `createEditTool()` | `never` | No legacy wrapper; retain exact replacement/diff contract |
| tracked/SSH-aware `bash` | public `createBashTool()` | `never` | Implement Piclaw local/SSH/keychain behaviour in `ExecutionEnv`; use `prepare` for `PI_*` env values |
| Windows `powershell` | Piclaw `AgentHarnessTool` using `ExecutionEnv.exec` or a Windows `ExecutionEnv` | `never` | Preserve PowerShell schema/description; return Earendil `AgentToolResult` |
| `local_bash` under SSH | second direct `HarnessTool` bound to local `ExecutionEnv` | `never` | Tool context holds local and selected envs; no mutable registration patch |

Earendil's built-in bash already handles streaming updates, output capture/truncation and full-output temp files. Piclaw's `createContextBashTool` should not wrap another legacy bash tool. Large-output storage can be implemented as:

- an `after_tool` Earendil hook that replaces `content`/`details` using exact `AfterToolCallResult` semantics; or
- a direct `HarnessTool` composed from public `createBashTool()` when hook payloads become typed and stable.

The selected approach must not double-execute shell work or redefine the bash result type.

## Execution environments

| Environment | Earendil contract | Notes |
|---|---|---|
| Local workspace | `NodeExecutionEnv` when sufficient | Public `@earendil-works/pi-agent-core/node` export; test under Bun |
| Piclaw local with keychain/process policy | custom class `implements ExecutionEnv` | Delegate filesystem to `NodeExecutionEnv`; implement/prepare shell env and tracking while preserving Earendil `Result` errors |
| SSH-selected workspace | custom class `implements ExecutionEnv` | Existing SSH transport backs exact `FileSystem` and `Shell` methods; no global redirection of registered tools |
| Test fixture | deterministic class `implements ExecutionEnv` | Returns Earendil `Result`; supports fault/abort controls outside contract |

`ExecutionEnv.cleanup()` owns best-effort process/resource cleanup. Piclaw's process tracker can remain an implementation detail inside the environment. Tool cancellation arrives through Earendil's signal.

## Piclaw-specific tools

These tools should be direct `HarnessTool` definitions. The table gives the default replay value; individual operations inside multipurpose tools may require a conservative `never` for the whole tool until split.

| Tool family | Examples | Replay | Context/ownership notes |
|---|---|---|---|
| Pure discovery/status | `list_tools`, `list_scripts`, `get_model_state`, `list_models`, `session_status` | `safe` | Read immutable/catalog snapshots; never expose credentials |
| Read-only data | `search_workspace`, `introspect_sql`, `search_tool_output`, `read_attachment`, `export_attachment` | `safe` for read/export-to-stable-key cases | Exports that create files need stable output identity or become `never` |
| Tool activation/configuration | `activate_tools`, `reset_active_tools`, `switch_model`, `switch_thinking` | `never` | Prefer direct harness methods for active tools/model/thinking; model-facing tools call them through captured binding |
| Workspace mutation | `env`, image processing writes, file attachment creation | `never` | Return exact `AgentToolResult`; operation correlation in tool context |
| Message/timeline mutation | `messages`, `chat`, `send_adaptive_card`, `send_dashboard_widget` | `never` | Piclaw service effect; idempotency key derived from tool call ID/operation when supported |
| Scheduler mutation | `scheduled_tasks`, `schedule_task` | `never` | Piclaw task store remains service plane |
| Lifecycle/control | `exit_process`, `session_control`, `open_workspace_file` | `never` | Exact operation/service authorization; terminal/restart effects are not harness completion by themselves |
| Secret management | `keychain` | `never` | Result redaction; secret values never enter telemetry/session details unless explicitly required for model output |
| Browser/infrastructure/add-ons | `cdp_browser`, SSH profile, Proxmox/Portainer/M365 workflows | `never` by default | Add-on SDK should require explicit replay metadata; queries can later split into safe tools |
| Batch execution | `exec_batch` | `never` | Sequentially calls one direct bash implementation; durable sub-effect ambiguity remains mutation-unsafe |

## Active tool state

Replace Piclaw's patched `setActiveToolsByName` logic with direct methods:

- `AgentHarness.getTools()` / `setTools()` for definitions;
- `AgentLane.getActiveTools()` / `setActiveTools()` for active names;
- persisted `active_tools_change` entries as the recovered state.

`activate_tools` and `reset_active_tools` remain model-visible Piclaw tools only if product UX requires them. Their execute functions call direct harness methods through a per-run binding captured in tool context. Recovery/containment uses the same direct methods under Piclaw's exact operation fence; no method replacement or saved setter restoration is allowed.

## Model and thinking tools

`get_model_state`, `list_models`, `switch_model` and `switch_thinking` use:

- Piclaw's concrete `ModelRuntime implements Models` for catalog/auth status;
- `AgentLane.getModel()` / `setModel()`;
- `AgentLane.getThinkingLevel()` / `setThinkingLevel()`.

No `ModelRegistry` compatibility facade is required by the new harness path except where Piclaw UI/catalog features still need it. The harness receives `ModelRuntime` as `Models` directly.

## Skills and prompt templates

Use Earendil's direct resources:

- `loadSourcedSkills<SourceInfo>()` to retain Piclaw provenance;
- `loadSourcedPromptTemplates<SourceInfo>()`;
- `Resources` passed to `AgentHarnessOptions.resources` or `setResources()`;
- `AgentLane.skill()` and `promptFromTemplate()` for explicit invocation.

Piclaw's current slash-command registry remains service-side. Skill/template discovery tools read the same resource inventory and return Piclaw UI metadata; they do not implement separate invocation semantics.

## Extension migration

Current Pi extensions combine tools, commands, prompts and many AgentSession hooks. Migrate each registration by category:

| Existing registration | Target |
|---|---|
| `registerTool` | direct `HarnessTool`/`AgentHarnessTool` |
| resource skill/template | Earendil `Resources` |
| slash command | Piclaw service command registry |
| `before_agent_start` resource/tool changes | harness construction/system prompt callback, resource setters or named `before_run` hook |
| provider request/header hooks | Earendil named request hooks when payload contract is confirmed; otherwise `Models`/provider configuration |
| tool pre/post hooks | named `before_tool`/`after_tool` hooks using Earendil semantics |
| session compaction hooks | `before_compaction` and Earendil compaction settings/entries |
| UI-only hooks | Piclaw projection/service event subscribers, never harness authority |
| session tree/fork hooks | `before_navigation` or Piclaw service command plus direct lane/session operation |

Since installed hook payloads are `unknown`, each migrated hook needs a selected Earendil source commit and a semantic case. Piclaw narrows that version directly and updates on churn. Unsupported hooks do not justify a parallel extension runtime inside the harness path.

## Coding-agent harness composition

The installed private `createCodingAgentHarness` implementation shows the intended composition:

- `ExecutionEnv` is captured as tool context;
- public read/bash/edit/write tools are converted to ordinary harness tools;
- bash `prepare` adds session/model/thinking environment values;
- active tool names are explicit;
- system prompt is a callback derived from current tools and active names;
- final construction calls `AgentHarness.create()`.

At `0.84.1`, Piclaw can reproduce this composition using public agent-core exports and accept the local prompt-composition churn. If a later selected release exports the coding-agent helper, adopt that direct public API and delete the local composition.

## Verification

For each migrated tool/resource:

- TypeScript `satisfies HarnessTool` or `satisfies AgentHarnessTool<...>`;
- explicit replay value;
- exact tool result/update/error semantics;
- abort and late-result test;
- safe/never recovery test;
- redaction test for details, telemetry and public projection;
- resource/hook compatibility test where applicable;
- no import from legacy AgentSession orchestration in the new path.
