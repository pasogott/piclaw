import { LiveDoc, type Conversation, type EntryRecord, type TaskId } from "@earendil-works/pi-durable";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord/context";

export const hostPlanContextKind = "host.plan-context";
export const hostGoalContextKind = "host.goal-context";
export const hostGoalSystemAuthorityKind = "host.goal-system-authority";
type ContextEntry = Pick<EntryRecord, "kind" | "data" | "model">;
export type GoalContextIdentity = { goalId: string; generation: number; status: "active" | "budget_limited"; systemPrompt?: string; inputKey?: string };

/** Hidden model context, never accepted user input or a visible timeline entry. */
export function assertHostPlanContext(entry: ContextEntry): void { assertHiddenContext(entry, hostPlanContextKind, "host:plan-prompt", "Plan"); }
export function assertHostGoalContext(entry: ContextEntry): void {
  assertHiddenContext(entry, hostGoalContextKind, "host:goal-prompt", "Goal");
  const data = entry.data as Record<string, unknown>;
  if (data.inputKey !== undefined && (typeof data.inputKey !== "string" || !data.inputKey.trim())) throw Error("Invalid hidden Goal input key");
  if (data.systemPrompt !== undefined && (typeof data.systemPrompt !== "string" || !data.systemPrompt.trim())) throw Error("Invalid hidden Goal system authority");
  if (typeof data.goalId !== "string" || !data.goalId || !Number.isSafeInteger(data.generation) || Number(data.generation) < 1 || (data.status !== "active" && data.status !== "budget_limited")) throw Error("Invalid hidden Goal identity");
}
export function assertHostGoalSystemAuthority(entry: ContextEntry): void {
  const data = entry.data as Record<string, unknown> | undefined;
  if (entry.kind !== hostGoalSystemAuthorityKind || data?.owner !== "host:goal-prompt" ||
    typeof data.chatJid !== "string" || !data.chatJid || !Number.isSafeInteger(data.taskId) || Number(data.taskId) <= 0 ||
    !Number.isSafeInteger(data.goalContextEntryId) || Number(data.goalContextEntryId) <= 0 ||
    typeof data.systemPrompt !== "string" || !data.systemPrompt.trim() || entry.model?.length !== 0)
    throw Error("Invalid Goal system authority");
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

/** Re-entry may include a Goal system overlay returned by an earlier hook.
 * Remove only exact overlays proved by this task's owned hidden snapshot.
 * Arbitrary system messages, edited contributions and foreign tasks still fail
 * the original exact-prefix check. The authority text is metadata, not user model context. */
export function canonicalHostPromptRequest(request: readonly Message[], view: {
  messages: readonly Message[]; entries: readonly (ContextEntry & { id?: number })[]; contributions: readonly (readonly Message[])[];
}, chatJid: string, taskId: number, label: string): readonly Message[] {
  const encoded = (value: unknown) => JSON.stringify(value);
  // Keep the ordinary no-overlay path identical to the original prefix check.
  if (request.length <= view.messages.length && encoded(view.messages.slice(0, request.length)) === encoded(request)) return request;
  const overlays = new Set<string>();
  for (let index = 0; index < view.entries.length; index++) {
    const entry = view.entries[index]!;
    const data = entry.data as Record<string, unknown> | undefined;
    if ((entry.kind !== hostGoalContextKind && entry.kind !== hostGoalSystemAuthorityKind) ||
      data?.chatJid !== chatJid || data.taskId !== taskId || data.systemPrompt === undefined) continue;
    if (entry.kind === hostGoalContextKind) assertHostGoalContext(entry);
    else {
      assertHostGoalSystemAuthority(entry);
      const anchorIndex = view.entries.findIndex(candidate => candidate.id === data.goalContextEntryId);
      const anchor = view.entries[anchorIndex];
      if (!anchor || !Number.isSafeInteger(entry.id) || !Number.isSafeInteger(anchor.id) || Number(anchor.id) >= Number(entry.id))
        throw Error("Missing earlier Goal context authority");
      assertHostGoalContext(anchor);
      const identity = anchor.data as Record<string, unknown>;
      for (const key of ["owner", "chatJid", "goalId", "generation", "status", "systemPrompt", "inputKey"])
        if (data[key] !== identity[key]) throw Error("Foreign Goal system authority");
      if (encoded(view.contributions[anchorIndex]) !== encoded(anchor.model)) throw Error("Edited Goal context authority");
    }
    if (encoded(view.contributions[index]) !== encoded(entry.model)) throw Error("Edited Goal system authority");
    overlays.add(encoded({ role: "system", content: data.systemPrompt, timestamp: 0 }));
  }
  const canonical: Message[] = [];
  const consumed = new Set<string>();
  for (const message of request) {
    // Preserve a real prefix message even if its bytes equal an overlay.
    const key = encoded(message);
    if (key === encoded(view.messages[canonical.length]) || !overlays.has(key) || consumed.has(key)) canonical.push(message);
    else consumed.add(key);
  }
  if (canonical.length > view.messages.length || encoded(view.messages.slice(0, canonical.length)) !== encoded(canonical))
    throw Error(`Unknown ${label} request cutoff`);
  return canonical;
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
  request = canonicalHostPromptRequest(request, view, chatJid, taskId, snapshot.label);
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
  const priorIdentity = previous?.data as Partial<GoalContextIdentity> | undefined;
  const sameGoal = snapshot.identity !== undefined && priorIdentity?.goalId === snapshot.identity.goalId &&
    priorIdentity?.generation === snapshot.identity.generation && priorIdentity?.status === snapshot.identity.status &&
    priorIdentity?.systemPrompt === snapshot.identity.systemPrompt && priorIdentity?.inputKey === snapshot.identity.inputKey;
  // Like the add-on input hook, expand once per accepted operation. Usage
  // accounting between provider calls must not regenerate the same input.
  const message: UserMessage = snapshot.identity?.inputKey && sameGoal && previous
    ? previous.model![0] as UserMessage : { role: "user", content: structuredClone(content), timestamp: 0 };
  const changed = !previous || encoded(previous.model!) !== encoded([message]) ||
    encoded(view.contributions[previousIndex]!) !== encoded([message]) ||
    (snapshot.identity !== undefined && (priorIdentity?.goalId !== snapshot.identity.goalId || priorIdentity?.generation !== snapshot.identity.generation || priorIdentity?.status !== snapshot.identity.status || priorIdentity?.systemPrompt !== snapshot.identity.systemPrompt || priorIdentity?.inputKey !== snapshot.identity.inputKey));
  // A frozen Goal contribution may belong to an earlier generation. Bind its
  // unchanged system rules to this exact live generation without appending the
  // continuation again or accepting another task's unproven overlay.
  const needsGoalAuthority = !changed && snapshot.kind === hostGoalContextKind && !!snapshot.identity?.systemPrompt &&
    previous !== undefined && (previous.data as { taskId: number }).taskId !== taskId &&
    !view.entries.some(entry => {
      const data = entry.data as Record<string, unknown> | undefined;
      return entry.kind === hostGoalSystemAuthorityKind && data?.chatJid === chatJid && data.taskId === taskId &&
        data.goalContextEntryId === previous.id && data.systemPrompt === snapshot.identity!.systemPrompt;
    });
  // History views are ordered by logical contributing range. Their last
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
    } else if (needsGoalAuthority) {
      const entry = { kind: hostGoalSystemAuthorityKind, data: { owner: snapshot.owner, chatJid, taskId,
        ...snapshot.identity, goalContextEntryId: previous!.id }, model: [] };
      assertHostGoalSystemAuthority(entry);
      await tx.appendEntry(conversation.id, entry);
    }
    assertCurrent();
  }, context);
  assertCurrent();
  return [...request, ...missing, ...(changed ? [message] : [])];
}
