import { LiveDoc, type Conversation, type EntryRecord, type TaskId } from "@earendil-works/pi-durable";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord/context";

export const hostPlanContextKind = "host.plan-context";
export const hostGoalContextKind = "host.goal-context";
type ContextEntry = Pick<EntryRecord, "kind" | "data" | "model">;
export type GoalContextIdentity = { goalId: string; generation: number; status: "active" | "budget_limited" };

/** Hidden model context, never accepted user input or a visible timeline entry. */
export function assertHostPlanContext(entry: ContextEntry): void { assertHiddenContext(entry, hostPlanContextKind, "host:plan-prompt", "Plan"); }
export function assertHostGoalContext(entry: ContextEntry): void {
  assertHiddenContext(entry, hostGoalContextKind, "host:goal-prompt", "Goal");
  const data = entry.data as Record<string, unknown>;
  if (typeof data.goalId !== "string" || !data.goalId || !Number.isSafeInteger(data.generation) || Number(data.generation) < 1 || (data.status !== "active" && data.status !== "budget_limited")) throw Error("Invalid hidden Goal identity");
}
function assertSnapshot(entry: ContextEntry): void {
  if (entry.kind === hostPlanContextKind) assertHostPlanContext(entry);
  else if (entry.kind === hostGoalContextKind) assertHostGoalContext(entry);
  else throw Error("Unowned host prompt context");
}
function assertHiddenContext(entry: ContextEntry, kind: string, owner: string, label: string): void {
  const data = entry.data as Record<string, unknown> | undefined;
  const message = entry.model?.[0];
  if (entry.kind !== kind || data?.owner !== owner ||
    typeof data.chatJid !== "string" || !data.chatJid || !Number.isSafeInteger(data.taskId) || Number(data.taskId) <= 0 ||
    entry.model?.length !== 1 || message?.role !== "user" || message.timestamp !== 0 ||
    !Array.isArray(message.content) || !message.content.length ||
    !message.content.every(part => part.type === "text" && typeof part.text === "string"))
    throw Error(`Invalid hidden ${label} context`);
}

/** The caller supplies the host's source-fenced storage scope. No private SDK
 * checkpoint edits: public context and entry IDs prove the pinned request's
 * missing suffix. A recovered pre-dispatch commit may leave several snapshots
 * beyond that cutoff, all of which must stay before the next assistant reply. */
export async function materializePlanContext(conversation: Conversation, taskId: TaskId, chatJid: string,
  request: readonly Message[], content: UserMessage["content"], assertCurrent: () => void, context: Context): Promise<readonly Message[]> {
  return materializePromptContext(conversation, taskId, chatJid, request, content, assertCurrent, context, {kind:hostPlanContextKind, owner:"host:plan-prompt", label:"Plan"});
}
export async function materializeGoalContext(conversation: Conversation, taskId: TaskId, chatJid: string,
  request: readonly Message[], content: UserMessage["content"], identity: GoalContextIdentity, assertCurrent: () => void, context: Context): Promise<readonly Message[]> {
  return materializePromptContext(conversation, taskId, chatJid, request, content, assertCurrent, context, {kind:hostGoalContextKind, owner:"host:goal-prompt", label:"Goal", identity});
}
async function materializePromptContext(conversation: Conversation, taskId: TaskId, chatJid: string,
  request: readonly Message[], content: UserMessage["content"], assertCurrent: () => void, context: Context,
  snapshot: {kind:string;owner:string;label:string;identity?:GoalContextIdentity}): Promise<readonly Message[]> {
  assertCurrent();
  const view = await conversation.context(context);
  assertCurrent();
  const encoded = (messages: readonly Message[]) => JSON.stringify(messages);
  if (request.length > view.messages.length || encoded(view.messages.slice(0, request.length)) !== encoded(request))
    throw Error(`Unknown ${snapshot.label} request cutoff`);
  let trailing = 0;
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const contribution = view.contributions[index]!;
    if (!contribution.length) continue;
    const entry = view.entries[index]!;
    if (entry.kind !== hostPlanContextKind && entry.kind !== hostGoalContextKind) break;
    assertSnapshot(entry);
    const data = entry.data as { chatJid: string; taskId: number };
    if (data.chatJid !== chatJid || data.taskId !== taskId) break;
    if (contribution.length !== 1 || encoded(contribution) !== encoded(entry.model!))
      throw Error(`Edited ${snapshot.label} request suffix`);
    trailing++;
  }
  const missing = view.messages.slice(request.length);
  if (missing.length > trailing) throw Error(`Unowned ${snapshot.label} request suffix`);
  const previousIndex = view.entries.findLastIndex(entry => entry.kind === snapshot.kind &&
    (entry.data as { chatJid?: string } | undefined)?.chatJid === chatJid);
  const previous = view.entries[previousIndex];
  if (previous) assertSnapshot(previous);
  if (!Array.isArray(content) || !content.length || !content.every(part => part.type === "text" && typeof part.text === "string"))
    throw Error(`Invalid ${snapshot.label} snapshot content`);
  const message: UserMessage = { role: "user", content: structuredClone(content), timestamp: 0 };
  const priorIdentity = previous?.data as Partial<GoalContextIdentity> | undefined;
  const changed = !previous || encoded(previous.model!) !== encoded([message]) ||
    encoded(view.contributions[previousIndex]!) !== encoded([message]) ||
    (snapshot.identity !== undefined && (priorIdentity?.goalId !== snapshot.identity.goalId || priorIdentity?.generation !== snapshot.identity.generation || priorIdentity?.status !== snapshot.identity.status));
  // Context heads precede their retained suffix in view.entries, so the last
  // array member need not have the highest raw entry ID after compaction.
  const tail = view.entries.reduce((id, entry) => Math.max(id, entry.id), 0);
  await conversation.commit(async tx => {
    assertCurrent();
    const task = await tx.task(taskId);
    const live = await tx.doc(LiveDoc, conversation.id);
    if (!task || task.kind !== "pi.generation" || task.conversationId !== conversation.id ||
      task.abortRequested || task.state.status === "terminal" || live.run?.taskId !== taskId)
      throw Error(`Exact live ${snapshot.label} generation required`);
    if ((await tx.scanEntries({ conversationId: conversation.id }, 1)).items[0]?.id !== tail)
      throw Error(`${snapshot.label} context changed during preparation`);
    if (changed) {
      const entry = { kind: snapshot.kind, data: { owner: snapshot.owner, chatJid, taskId, ...snapshot.identity }, model: [message] };
      assertSnapshot(entry);
      await tx.appendEntry(conversation.id, entry);
    }
    assertCurrent();
  }, context);
  assertCurrent();
  return [...request, ...missing, ...(changed ? [message] : [])];
}
