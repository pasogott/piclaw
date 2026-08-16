import { readdirSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import ts from "typescript";

const runtimeRoot = resolve(import.meta.dir, "../../..");
const BUILTIN_ROOT = "src/extensions/index.ts";
const SESSION_ROOT = "src/agent-pool/session.ts";
const SERVICE_FACTORY_ROOT = "src/agent-pool/service-factory.ts";

/** SDK/effective families are composition inputs, not extension registrations. */
export const CORE_SDK_TOOL_FAMILIES = Object.freeze(["read", "write", "edit", "bash"]);
export const EFFECTIVE_SEARCH_FAMILIES = Object.freeze(["grep", "find", "ls"]);

const TOOL_NAME_CONSTANTS = new Map<string, string>([
  ["CONTEXT_PRUNE_TOOL_NAME", "context_prune"],
  ["CONTEXT_TREE_QUERY_TOOL_NAME", "context_tree_query"],
  ["PRIMARY_TOOL_NAME", "list_tools"],
]);

const FACTORY_TOOL_NAMES = new Map<string, string>([
  ["createReadTool", "read"],
  ["createWriteTool", "write"],
  ["createEditTool", "edit"],
  ["createBashTool", "bash"],
  ["createToolOutputSearchTool", "search_tool_output"],
  ["createBatchExecTool", "exec_batch"],
]);

export interface SourceTree {
  readonly files: Readonly<Record<string, string>>;
}

export interface ProductionCompositionConfig {
  readonly platform?: "linux" | "win32";
  readonly enabledEnv?: ReadonlySet<string>;
}

export interface RepositoryToolFamilyInventory {
  readonly names: readonly string[];
  readonly unresolvedRegistrations: readonly string[];
  readonly productionRoots: readonly string[];
  readonly registrationSites: ReadonlyMap<string, readonly string[]>;
  readonly nonProductionDuplicateSites: ReadonlyMap<string, readonly string[]>;
}

/**
 * Read repository source as data. No extension, add-on, MCP adapter, or tool is
 * imported or executed.
 */
export function readRepositorySourceTree(root = runtimeRoot): SourceTree {
  const files: Record<string, string> = {};
  for (const directory of [resolve(root, "src"), resolve(root, "extensions")]) {
    for (const path of walkTypeScript(directory)) {
      files[relative(root, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
    }
  }
  return Object.freeze({ files: Object.freeze(files) });
}

/** Resolve only production composition roots and registrations reachable from them. */
export function inventoryRepositoryToolFamilies(
  tree: SourceTree = readRepositorySourceTree(),
  config: ProductionCompositionConfig = {},
): RepositoryToolFamilyInventory {
  const files = tree.files;
  const names = new Set<string>([...CORE_SDK_TOOL_FAMILIES, ...EFFECTIVE_SEARCH_FAMILIES]);
  const sites = new Map<string, Set<string>>();
  const unresolved = new Set<string>();
  const roots = new Set<string>();

  for (const root of parseBuiltinFactoryRoots(files[BUILTIN_ROOT] ?? "", BUILTIN_ROOT, files)) roots.add(root);
  for (const root of parseOptionalExtensionRoots(files[SESSION_ROOT] ?? "", config)) roots.add(root);
  if (files[SERVICE_FACTORY_ROOT]) roots.add(SERVICE_FACTORY_ROOT);
  if (containsCall(files[SESSION_ROOT] ?? "", "createMcpAdapter")) names.add("mcp");

  const queue = [...roots].sort();
  const scanned = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (scanned.has(file)) continue;
    scanned.add(file);
    const source = files[file];
    if (source === undefined) {
      unresolved.add(`${file}#missing-production-root`);
      continue;
    }
    for (const registration of parseRegistrations(file, source)) {
      if (registration.name) {
        names.add(registration.name);
        addSite(sites, registration.name, file);
      } else {
        unresolved.add(`${file}#${registration.fingerprint}`);
      }
    }
    const referenced = new Set(resolveCalledImportedRoots(file, source, files));
    const forwarded = resolveForwardedDefaultRoot(file, source, files);
    if (forwarded) referenced.add(forwarded);
    for (const dependency of referenced) {
      if (scanned.has(dependency)) continue;
      roots.add(dependency);
      queue.push(dependency);
    }
    queue.sort();
  }

  const duplicateSites = new Map<string, Set<string>>();
  for (const [file, source] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    if (scanned.has(file)) continue;
    for (const registration of parseRegistrations(file, source)) {
      if (registration.name && names.has(registration.name)) addSite(duplicateSites, registration.name, file);
    }
  }

  return Object.freeze({
    names: Object.freeze([...names].sort()),
    unresolvedRegistrations: Object.freeze([...unresolved].sort()),
    productionRoots: Object.freeze([...roots].sort()),
    registrationSites: readonlySiteMap(sites),
    nonProductionDuplicateSites: readonlySiteMap(duplicateSites),
  });
}

function parseBuiltinFactoryRoots(source: string, file: string, files: Readonly<Record<string, string>>): string[] {
  const ast = sourceFile(file, source);
  const imports = importBindings(ast);
  const roots = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "createBuiltinExtensionFactories") {
      const returned = findReturnedArray(node.body);
      for (const expression of returned?.elements ?? []) {
        const identifier = ts.isCallExpression(expression) ? expression.expression : expression;
        if (!ts.isIdentifier(identifier)) continue;
        const binding = imports.get(identifier.text);
        if (!binding) continue;
        const resolved = resolveSourceFile(file, binding.specifier, files);
        if (resolved) roots.add(resolved);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...roots].sort();
}

function parseOptionalExtensionRoots(source: string, config: ProductionCompositionConfig): string[] {
  const ast = sourceFile(SESSION_ROOT, source);
  const roots: string[] = [];
  const platform = config.platform;
  const enabledEnv = config.enabledEnv;
  const visit = (node: ts.Node): void => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== "OPTIONAL_EXTENSIONS") {
      ts.forEachChild(node, visit);
      return;
    }
    if (!node.initializer || !ts.isArrayLiteralExpression(node.initializer)) return;
    for (const element of node.initializer.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      const pathProperty = objectProperty(element, "path");
      const path = pathProperty && optionalPath(pathProperty.initializer);
      if (!path) continue;
      const envGate = stringProperty(element, "envGate");
      const platforms = stringArrayProperty(element, "platforms");
      if (enabledEnv && envGate && !enabledEnv.has(envGate)) continue;
      if (platform && platforms.length > 0 && !platforms.includes(platform)) continue;
      roots.push(path);
    }
  };
  visit(ast);
  return [...new Set(roots)].sort();
}

function optionalPath(expression: ts.Expression): string | null {
  if (!ts.isCallExpression(expression) || expression.arguments.length < 2) return null;
  const parts = expression.arguments.slice(1).map((argument) => ts.isStringLiteralLike(argument) ? argument.text : null);
  if (parts.some((part) => part === null)) return null;
  return posix.join("extensions", ...(parts as string[]));
}

export function extractLiteralRegistrationParameterFields(file: string, source: string): ReadonlyMap<string, readonly string[]> {
  const ast = sourceFile(file, source);
  const variables = variableInitializers(ast);
  const result = new Map<string, readonly string[]>();
  const parameterKeys = (expression: ts.Expression, seen = new Set<string>()): string[] => {
    if (ts.isCallExpression(expression) && expression.arguments[0]) return parameterKeys(expression.arguments[0], seen);
    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.flatMap((property) => {
        if (!ts.isPropertyAssignment(property)) return [];
        const name = propertyName(property.name);
        return name ? [name] : [];
      });
    }
    if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
      seen.add(expression.text);
      const initializer = variables.get(expression.text);
      return initializer ? parameterKeys(initializer, seen) : [];
    }
    return [];
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRegisterToolCall(node.expression) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const nameProperty = objectProperty(node.arguments[0], "name");
      const parametersProperty = objectProperty(node.arguments[0], "parameters");
      if (nameProperty && ts.isStringLiteralLike(nameProperty.initializer) && parametersProperty) {
        result.set(nameProperty.initializer.text, Object.freeze(parameterKeys(parametersProperty.initializer)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

function parseRegistrations(file: string, source: string): Array<{ name: string | null; fingerprint: string }> {
  const ast = sourceFile(file, source);
  const constants = stringConstants(ast);
  const variables = variableInitializers(ast);
  const registrations: Array<{ name: string | null; fingerprint: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRegisterToolCall(node.expression)) {
      const argument = node.arguments[0];
      registrations.push(argument
        ? resolveRegistration(argument, constants, variables, ast)
        : { name: null, fingerprint: "missing-argument" });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return registrations;
}

function resolveRegistration(
  argument: ts.Expression,
  constants: ReadonlyMap<string, string>,
  variables: ReadonlyMap<string, ts.Expression>,
  ast: ts.SourceFile,
): { name: string | null; fingerprint: string } {
  if (ts.isObjectLiteralExpression(argument)) {
    const property = objectProperty(argument, "name");
    if (property) {
      if (ts.isStringLiteralLike(property.initializer)) return { name: property.initializer.text, fingerprint: "literal" };
      if (ts.isIdentifier(property.initializer)) {
        const name = constants.get(property.initializer.text) ?? TOOL_NAME_CONSTANTS.get(property.initializer.text);
        if (name) return { name, fingerprint: "constant" };
      }
      return { name: null, fingerprint: `name:${compact(property.initializer.getText(ast))}` };
    }
    const spreads = argument.properties.filter(ts.isSpreadAssignment);
    if (spreads.length === 1 && ts.isIdentifier(spreads[0].expression)) {
      const identifier = spreads[0].expression.text;
      const initializer = variables.get(identifier);
      if (initializer && ts.isCallExpression(initializer)) {
        const factory = calleeName(initializer.expression);
        const name = factory && FACTORY_TOOL_NAMES.get(factory);
        if (name) return { name, fingerprint: `factory:${factory}` };
      }
      const inferred = /(?:^|_)(read|write|edit|bash)$/i.exec(identifier)?.[1]?.toLowerCase();
      if (inferred) return { name: inferred, fingerprint: `spread:${identifier}` };
    }
    return { name: null, fingerprint: `spread:${spreads.map((spread) => compact(spread.expression.getText(ast))).join("+") || "none"}` };
  }
  if (ts.isCallExpression(argument)) {
    const factory = calleeName(argument.expression);
    const name = factory && FACTORY_TOOL_NAMES.get(factory);
    return name ? { name, fingerprint: `factory:${factory}` } : { name: null, fingerprint: `factory:${factory ?? "unknown"}` };
  }
  return { name: null, fingerprint: `expression:${compact(argument.getText(ast))}` };
}

function resolveCalledImportedRoots(file: string, source: string, files: Readonly<Record<string, string>>): string[] {
  const ast = sourceFile(file, source);
  const imports = importBindings(ast);
  const roots = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = imports.get(node.expression.text);
      if (binding) {
        const resolved = resolveSourceFile(file, binding.specifier, files);
        if (resolved) roots.add(resolved);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...roots].sort();
}

function resolveForwardedDefaultRoot(file: string, source: string, files: Readonly<Record<string, string>>): string | null {
  const ast = sourceFile(file, source);
  const imports = importBindings(ast);
  for (const statement of ast.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const binding = imports.get(statement.expression.text);
      if (binding) return resolveSourceFile(file, binding.specifier, files);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause) && clause.elements.some((element) => element.name.text === "default")) {
        return resolveSourceFile(file, statement.moduleSpecifier.text, files);
      }
    }
  }
  return null;
}

function resolveSourceFile(fromFile: string, specifier: string, files: Readonly<Record<string, string>>): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const withoutJs = base.replace(/\.js$/, "");
  const candidates = [base, `${withoutJs}.ts`, posix.join(base, "index.ts")];
  return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
}

function importBindings(ast: ts.SourceFile): Map<string, { specifier: string; imported: string }> {
  const bindings = new Map<string, { specifier: string; imported: string }>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.name) bindings.set(clause.name.text, { specifier, imported: "default" });
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        bindings.set(element.name.text, { specifier, imported: element.propertyName?.text ?? element.name.text });
      }
    }
  }
  return bindings;
}

function findReturnedArray(body: ts.Block | undefined): ts.ArrayLiteralExpression | null {
  if (!body) return null;
  let found: ts.ArrayLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isReturnStatement(node) && node.expression && ts.isArrayLiteralExpression(node.expression)) found = node.expression;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function stringConstants(ast: ts.SourceFile): Map<string, string> {
  const values = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteralLike(node.initializer)) {
      values.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return values;
}

function variableInitializers(ast: ts.SourceFile): Map<string, ts.Expression> {
  const values = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) values.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return values;
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | null {
  return object.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && propertyName(property.name) === name
  ) ?? null;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | null {
  const property = objectProperty(object, name);
  return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : null;
}

function stringArrayProperty(object: ts.ObjectLiteralExpression, name: string): string[] {
  const property = objectProperty(object, name);
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.filter(ts.isStringLiteralLike).map((entry) => entry.text);
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
}

function isRegisterToolCall(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "registerTool";
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function containsCall(source: string, name: string): boolean {
  const ast = sourceFile(SESSION_ROOT, source);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === name) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

function sourceFile(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function addSite(target: Map<string, Set<string>>, name: string, file: string): void {
  const values = target.get(name) ?? new Set<string>();
  values.add(file);
  target.set(name, values);
}

function readonlySiteMap(source: Map<string, Set<string>>): ReadonlyMap<string, readonly string[]> {
  return new Map([...source].sort(([left], [right]) => left.localeCompare(right)).map(([name, values]) => [name, Object.freeze([...values].sort())]));
}

function compact(value: string): string {
  return value.replace(/\s+/g, "").slice(0, 120);
}

function walkTypeScript(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...walkTypeScript(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files.sort();
}
