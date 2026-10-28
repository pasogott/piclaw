import type { AgentOutput } from "../agent-pool/contracts.js";
import { readAccessConfig } from "../core/config-access.js";
import { readOperationsConfig } from "../core/config-operations.js";
import { getBudgetWork, listBudgetCaps } from "../db/budget-limits.js";
import { evaluateBudget } from "../budget/evaluator.js";
import type { OperationHost,OperationPrincipal,OperationAdmission,OperationExecution,OperationResult } from "./operation-contracts.js";

/** Injectable AgentPool surface keeps operation tests provider-free. */
export interface OperationAgentPool {
  isDurableRuntime?():boolean;
  dispatchAddonOperation?(operationId:string,signal:AbortSignal,expectedInputSequence?:number):Promise<AgentOutput>;
  reconcileAddonOperation?(operationId:string,expectedInputSequence?:number):Promise<AgentOutput|null>;

}
export function authorizeAddonOperation(principal:Readonly<OperationPrincipal>,target:string,action:"admit"|"read"|"cancel"|"request",readConfig=readOperationsConfig):OperationAdmission {
  if (readAccessConfig().mode !== "single-user")
    return { decision: "rejected" };
  const config = readConfig();
  const configured = config.grants.find(
    (g) =>
      g.enabled &&
      g.addonId === principal.addonId &&
      g.principalId === principal.principalId &&
      g.target === target,
  );
  if (!config.enabled || !configured) return { decision: "rejected" };
  if ((action === "admit" || action === 'request') && configured.approvalRequired)
    return { decision: "approval_required" };
  const { revision, allowedTools, timeoutMs, maxToolCalls, parentWorkId } =
    configured;
  const grant = {
    revision,
    target,
    allowedTools,
    timeoutMs,
    maxToolCalls,
    parentWorkId,
  };
  // Request revalidation retains the spending grant, while the reservation
  // owner separately evaluates prospective cost and excludes only its own hold.
  if (action !== "admit" && action !== 'request') return { decision: "allow", grant };
  const parent = configured.parentWorkId;
  if (parent) {
    const work = getBudgetWork(parent);
    if (!work || !["active", "paused"].includes(work.status))
      return { decision: "rejected" };
    if (action === 'request' && work.status !== 'active') return {decision:'budget_blocked'};
    if (action === "admit") {
      const decision = evaluateBudget({ workId: parent });
      if (decision.action === "pause" || decision.action === "stop")
        return { decision: "budget_blocked" };
    }
  } else if (
    (action === "admit" || action === 'request') &&
    listBudgetCaps({ enabledOnly: true }).some((c) => c.scope === "task")
  ) {
    // Task caps cannot be inherited without an operator-selected parent work.
    return { decision: "budget_blocked" };
  }
  return { decision: "allow", grant };
}

function operationResult(output:AgentOutput):OperationResult{
  if(output.failureCategory==='provider_budget')return{status:'budget_blocked',reason:'budget_boundary'};
  if(output.status==='error'){
    if(output.failureCategory==='aborted')return{status:'cancelled',reason:'executor_cancelled'};
    return{status:'failed',reason:output.failureCategory==='timeout'?'execution_timeout':'execution_failed'};
  }
  if(output.requiresToolEnabledContinuation)return{status:'input_required',reason:'continuation_required'};
  return{status:'completed',output:output.result||''};
}

export function createOperationHost(
  pool: OperationAgentPool,
  readConfig = readOperationsConfig,
): OperationHost {
  const host: OperationHost = {
    authorize: (principal,target,action) => authorizeAddonOperation(principal,target,action,readConfig),
    async execute(input) {
      if(pool.isDurableRuntime?.()!==true || !pool.dispatchAddonOperation)throw Error('Native add-on execution unavailable');
      const output=await pool.dispatchAddonOperation(input.operationId,input.signal,input.inputSequence);
      return operationResult(output);
    },
  };
  if(pool.isDurableRuntime?.()===true)host.recover=async(input:OperationExecution)=>{
    if(!pool.reconcileAddonOperation)throw Error('Native add-on recovery unavailable');
    const output=await pool.reconcileAddonOperation(input.operationId,input.inputSequence);
    return output===null?null:operationResult(output);
  };
  return host;
}
