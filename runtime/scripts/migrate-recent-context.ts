#!/usr/bin/env bun
/** One-shot operator copy. No web, AgentPool, admission loop or model invocation. */
import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isAbsolute, join, resolve, relative, dirname } from "node:path";

export const HELP = `Usage: bun runtime/scripts/migrate-recent-context.ts --workspace /ABS --agent-dir /ABS --manifest /ABS [--preflight | --apply] [--relocate-archives /ABS]
Target must be offline/checkpointed with no SQLite WAL/SHM/journal sidecars.
Apply opens explicit offline maintenance: external background services are not started.
Archive relocation requires qualified Linux renameat2 no-replace support; no overwrite/copy fallback.
Default: read-only preflight. No force, install, automatic archive move or model calls.
Manifest v1: {version:1, workspace, agentDir, schemaSHA256, timeline, sources:[
 {chatJid,branchId,path,sha256,sourceSessionId,selectedLeaf,asOf,payloadSHA256,sourceEntryIds}
], archives:[{path,sha256}]}
Sources are explicit absolute JSONL copies; archives inventory ALL files relative to SESSIONS_DIR.
Timeline is captureLegacyTimeline receipt; schemaSHA256 hashes JSON of sqlite_master
SELECT type,name,tbl_name,sql ORDER BY type,name. payloadSHA256 hashes selected messages JSON.
--relocate-archives requires --apply, absent destination outside workspace/agent-dir,
and existing canonical parent; renames the entire sessions tree, preserving every raw byte.
Preflight audits the same installed add-on source gate as apply, without evaluating factories.
It does not prove runtime construction; rehearse apply on a copy before live cutover.
Preflight with archives reports the required relocation plan but never performs it.`;

const pathExists = (path: string) => !!lstatSync(path, { throwIfNoEntry:false });
function absolute(path: string) {
  if (!path || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) throw Error("Explicit canonical absolute path required: " + path);
  return path;
}
export async function main(args = process.argv.slice(2), testDependencies?: { getModels: () => Promise<import("../src/agent-pool/model-services.js").RuntimeModelServices> }) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) { console.log(HELP); return; }
  const flags = new Map<string,string>(); let apply = false, preflight = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (flags.has(key)) throw Error("Duplicate option");
    if (key === "--apply" || key === "--preflight") { if (key === "--apply") apply = true; else preflight = true; flags.set(key, ""); }
    else if (["--workspace", "--agent-dir", "--manifest", "--relocate-archives"].includes(key) && args[i+1] && !args[i+1]!.startsWith("--")) flags.set(key,args[++i]!);
    else throw Error("Unknown or missing option: " + key);
  }
  if (apply && preflight) throw Error("Conflicting modes");
  const workspace = absolute(flags.get("--workspace")!), agentDir = absolute(flags.get("--agent-dir")!), manifestPath = absolute(flags.get("--manifest")!);
  if (flags.has("--relocate-archives") && !apply) throw Error("Relocation requires explicit --apply");
  // Set paths BEFORE any runtime/SDK/config import. Never inherit another profile's bootstrap overrides.
  for (const key of ["PICLAW_WORKSPACE", "PICLAW_STORE", "PICLAW_DATA", "PICLAW_RUNTIME_ROOT", "PICLAW_PI_AGENT_DIR", "PI_CODING_AGENT_DIR"]) delete process.env[key];
  delete process.env.PICLAW_DB_IN_MEMORY;
  process.env.PICLAW_WORKSPACE = workspace;
  process.env.PICLAW_PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR = agentDir;
  const { STORE_DIR, SESSIONS_DIR } = await import("../src/core/config.js");
  const { acquireRuntimeLock, getDefaultRuntimeLockPath } = await import("../src/runtime/single-instance.js");
  const { Database, constants } = await import("bun:sqlite");
  const { digest, selectRecent } = await import("./helpers/recent-context.js");
  const { captureLegacyTimeline } = await import("../durable-engine/src/application-legacy-timeline.js");
  const { validateRecentHistoryScopes } = await import("../durable-engine/src/application-recent-history.js");
  const { auditInstalledApplicationAddonSources } = await import("../durable-engine/src/host-extension-catalog.js");
  const lockPath = getDefaultRuntimeLockPath();
  if (lockPath !== join(STORE_DIR, "runtime.lock")) throw Error("Noncanonical lock");
  const dbPath = absolute(join(STORE_DIR, "messages.db"));
  const inventory = (root: string): {path:string;sha256:string}[] => {
    if (!existsSync(root)) return [];
    absolute(root);
    const walk = (dir: string): {path:string;sha256:string}[] => readdirSync(dir).sort().flatMap(name => {
      const path = join(dir,name), stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error("Unsafe archive path");
      return stat.isDirectory() ? walk(path) : [{path:relative(root,path),sha256:digest(readFileSync(path))}];
    }); return walk(root);
  };
  const rawManifest = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(rawManifest);
  if (manifest.version !== 1 || manifest.workspace !== workspace || manifest.agentDir !== agentDir || !Array.isArray(manifest.sources) || !manifest.sources.length || !Array.isArray(manifest.archives)) throw Error("Invalid manifest scope");
  const destination = flags.get("--relocate-archives");
  if (destination) {
    if (!isAbsolute(destination) || resolve(destination) !== destination || pathExists(destination) || absolute(dirname(destination)) !== dirname(destination) ||
      [workspace,agentDir].some(root => destination === root || destination.startsWith(root + "/"))) throw Error("Unsafe or existing archive destination");
  }
  const validate = async () => {
    if(manifest.archives.length){const{assertArchiveRelocationPrimitiveAvailable}=await import('./helpers/relocate-archives.js');await assertArchiveRelocationPrimitiveAvailable();}
    if (readFileSync(manifestPath,"utf8") !== rawManifest) throw Error("Manifest changed");
    // immutable avoids SQLite creating WAL/SHM even for a read-only connection.
    // It is safe ONLY for a stopped, checkpointed target with no sidecars.
    if (["-wal", "-shm", "-journal"].some(suffix => existsSync(dbPath + suffix))) throw Error("Offline checkpointed DB required; SQLite sidecars present");
    const root = new Database(pathToFileURL(dbPath).href + "?immutable=1", constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI);
    try {
      root.exec("BEGIN");
      const schema = root.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
      if (digest(JSON.stringify(schema)) !== manifest.schemaSHA256) throw Error("Schema digest mismatch");
      if (root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('durable_schema','conversations','documents','entries','tasks','submissions') LIMIT 1").get()) throw Error("Requires fresh SDK target");
      if (JSON.stringify(captureLegacyTimeline(root, () => {})) !== JSON.stringify(manifest.timeline)) throw Error("Timeline digest mismatch");
      const has = (name: string) => !!root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (has("service_effect_s01_chats") && root.query(`SELECT 1 FROM service_effect_s01_chats WHERE active_operation_id IS NOT NULL
        UNION ALL SELECT 1 FROM service_effect_s01_sources WHERE state NOT IN ('consumed','disposed')
        UNION ALL SELECT 1 FROM service_effect_s01_operations WHERE phase <> 'terminal'
        UNION ALL SELECT 1 FROM service_effect_s01_queued_inputs WHERE state NOT IN ('consumed','disposed') LIMIT 1`).get()) throw Error("Pending work");
      const scopes = root.query("SELECT chat_jid AS chatJid, branch_id AS branchId FROM chat_branches WHERE archived_at IS NULL ORDER BY chat_jid,branch_id").all() as any[];
      const selections: any[] = [];
      const recentHistory = manifest.sources.map((s: any) => {
        if (![s.chatJid,s.branchId,s.sourceSessionId,s.selectedLeaf].every(v => typeof v === "string" && v.trim() === v && v.length)) throw Error("Noncanonical source scope");
        const bytes = readFileSync(absolute(s.path));
        if (digest(bytes) !== s.sha256) throw Error("Source file hash mismatch");
        const lines = bytes.toString("utf8").trim().split("\n");
        const header = JSON.parse(lines.shift()!);
        const entries: any[] = []; let malformedLines = 0;
        for (const line of lines) {
          try { entries.push(JSON.parse(line)); } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            malformedLines++;
          }
        }
        // An unreadable row may be an unidentifiable branch/parent. Never choose
        // an older branch or weaken provenance; require an explicit empty manifest.
        const unverifiable = malformedLines > 0 || entries.some(e => !e || typeof e.id !== "string" || !e.id || !(e.parentId === null || typeof e.parentId === "string"));
        if (header.type !== "session" || header.id !== s.sourceSessionId || new Set(entries.filter(e => e && typeof e.id === "string").map(e => e.id)).size !== entries.filter(e => e && typeof e.id === "string").length) throw Error("Source identity mismatch");
        const selected = unverifiable ? {messages:[],sourceEntryIds:[],completedTurns:0,selection:"empty",skipped:{"unverifiable-jsonl-source":1, "malformed-lines":malformedLines}} : selectRecent(entries,s.selectedLeaf,s.asOf);
        selections.push({chatJid:s.chatJid,branchId:s.branchId,selection:selected.selection,skipped:selected.skipped});
        if (digest(JSON.stringify(selected.messages)) !== s.payloadSHA256 || JSON.stringify(selected.sourceEntryIds) !== JSON.stringify(s.sourceEntryIds)) throw Error("Projection payload/provenance mismatch");
        return {chatJid:s.chatJid,branchId:s.branchId,sourceSessionId:header.id,sourceLeafId:s.selectedLeaf,owner:"operator:recent-context-copy",sourceHash:s.payloadSHA256,messages:selected.messages};
      });
      // Scope ownership is strict even for an explicitly empty selection.
      const seen = new Set<string>();
      for (const item of recentHistory) {
        const key = JSON.stringify([item.chatJid,item.branchId]);
        if (seen.has(key) || !scopes.some(b => b.chatJid === item.chatJid && b.branchId === item.branchId)) throw Error("Invalid recent history scope or boundary");
        seen.add(key);
      }
      const eligible = recentHistory.filter(item => item.messages.length);
      validateRecentHistoryScopes(eligible,scopes);
      if (JSON.stringify(inventory(SESSIONS_DIR)) !== JSON.stringify(manifest.archives)) throw Error("Archive inventory mismatch");
      const installedAddonSources=auditInstalledApplicationAddonSources(workspace).profiles;
      return {timeline:manifest.timeline,recentHistory:eligible,selections,installedAddonSources};
    } finally { root.close(); }
  };
  if (!apply) {
    if (pathExists(lockPath)) throw Error("Existing runtime lock; preflight requires offline target");
    const migration = await validate();
    console.log(JSON.stringify({mode:"preflight",writes:0,copies:migration.recentHistory.length,selections:migration.selections,installedAddonSources:migration.installedAddonSources.map(({name,version})=>({name,version})),validation:"immutable-offline-data-and-installed-sources-not-runtime-construction",archivePlan:manifest.archives.length ? {action:"explicit-relocation-required",from:SESSIONS_DIR,files:manifest.archives} : null,archiveRelocationRequired:existsSync(SESSIONS_DIR) && readdirSync(SESSIONS_DIR).length > 0,owningPaths:{workspace,agentDir,dbPath,lockPath,sessions:SESSIONS_DIR}})); return;
  }
  const owner = acquireRuntimeLock({ lockPath, strictOwnership:true, disabled:false, maintenance:true });
  let backend: any, dbModule: typeof import("../src/db.js") | undefined, safe = true;
  let phase='validation',archivesRelocated=false,archivesVerified=false,runtimeInitializationStarted=false,completed=false;
  try {
    owner.assertCurrentOwner();
    const migration = await validate();
    if (existsSync(SESSIONS_DIR) && readdirSync(SESSIONS_DIR).length) {
      if (!destination) throw Error("Explicit --relocate-archives required before backend open");
      owner.assertCurrentOwner();
      console.log(JSON.stringify({action:"relocate-raw-archive-tree",owningPaths:{from:SESSIONS_DIR,to:destination},files:manifest.archives}));
      phase='archive-relocation';
      const {relocateArchivesNoReplace}=await import('./helpers/relocate-archives.js');
      await relocateArchivesNoReplace(SESSIONS_DIR,destination); archivesRelocated=true;
      if (JSON.stringify(inventory(destination)) !== JSON.stringify(manifest.archives)) throw Error("Relocated archive verification failed");
      archivesVerified=true;
    } else if (destination) throw Error("No archive tree to relocate");
    owner.assertCurrentOwner();
    dbModule = await import("../src/db.js");
    safe = false; runtimeInitializationStarted=true; phase='runtime-initialization';
    dbModule.initDatabase();
    const { createDefaultApplicationRuntime } = await import("../durable-engine/src/default-application-runtime.js");
    const loadModels = async () => {
      const { createRuntimeModelServices } = await import("../src/agent-pool/model-services.js");
      const services = await createRuntimeModelServices({agentDir});
      const { installRuntimeModelExecutor } = await import("../src/extensions/model-execution-runtime.js");
      const { registerGitHubCopilotDynamicModels } = await import("../src/extensions/github-copilot-dynamic-models.js");
      installRuntimeModelExecutor(services.modelRuntime);
      registerGitHubCopilotDynamicModels(services.modelRuntime);
      return services;
    };
    let models: ReturnType<typeof loadModels> | undefined;
    const getModels = () => models ??= (testDependencies?.getModels ?? loadModels)();
    backend = await createDefaultApplicationRuntime(owner,getModels,migration,{offlineMaintenance:true});
    backend.stop(); await backend.close(); backend = undefined;
    dbModule.closeDatabase(); dbModule = undefined;
    owner.assertCurrentOwner(); safe = true;
    completed=true;
    console.log(JSON.stringify({mode:"applied",copies:migration.recentHistory.length,selections:migration.selections,rawArchives:destination ?? SESSIONS_DIR,timelinePreserved:true}));
  } finally {
    try { if (backend) { backend.stop(); await backend.close(); } }
    catch { safe=false; }
    // A factory failure without a returned backend cannot prove all native handles closed.
    try { if (dbModule) dbModule.closeDatabase(); }
    catch { safe=false; }
    let runtimeLock='retained';
    if(safe){
      try{owner.assertCurrentOwner();owner.markSafeReleaseOnExit();owner.release();runtimeLock='released';}
      catch{safe=false;runtimeLock='unknown';}
    }
    if(!safe)console.error('Cleanup not proven; runtime.lock may be retained. Offline operator inspection required.');
    if(!completed||!safe)console.error(JSON.stringify({mode:'recovery-required',phase,runtimeInitializationStarted,commitCertainty:runtimeInitializationStarted?'unknown':'not-started',runtimeLock,archives:{relocated:archivesRelocated,verified:archivesVerified,original:SESSIONS_DIR,retained:destination??null},action:'preserve-state-and-inspect-offline-no-automatic-restore-or-retry'}));
    if(completed&&!safe)throw Error('Apply cleanup uncertain; offline operator inspection required');
  }
}
if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
