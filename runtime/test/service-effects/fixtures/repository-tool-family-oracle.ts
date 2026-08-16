import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import ts from "typescript";

const runtimeRoot = resolve(import.meta.dir, "../../..");
const BUILTIN_ROOT = "src/extensions/index.ts";
const SESSION_ROOT = "src/agent-pool/session.ts";
const SERVICE_FACTORY_ROOT = "src/agent-pool/service-factory.ts";
const SDK_TOOLS_SOURCE = resolve(runtimeRoot, "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js");

export interface SourceTree {
  readonly files: Readonly<Record<string, string>>;
}

export interface ProductionCompositionConfig {
  readonly platform?: "linux" | "win32";
  readonly enabledEnv?: ReadonlySet<string>;
  readonly sdkToolFamilies?: readonly string[];
}

export interface StaticToolContract {
  readonly name: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly parameterSchemaFingerprint: string;
}

export interface RepositoryToolFamilyInventory {
  readonly names: readonly string[];
  readonly unresolvedRegistrations: readonly string[];
  readonly sdkToolFamilies: readonly string[];
  readonly compositionRoots: readonly string[];
  readonly productionRoots: readonly string[];
  readonly registrationSites: Readonly<Record<string, readonly string[]>>;
  readonly nonProductionDuplicateSites: Readonly<Record<string, readonly string[]>>;
}

/**
 * Read repository source as data. No extension, add-on, MCP adapter, or tool is
 * imported or executed.
 */
export function readRepositorySourceTree(root = runtimeRoot): SourceTree {
  const files: Record<string, string> = {};
  for (const [name, path] of [["tsconfig.json", resolve(root, "tsconfig.json")], ["package.json", resolve(root, "../package.json")]] as const) {
    try { files[name] = readFileSync(path, "utf8"); } catch (error) { void error; /* A synthetic source tree may omit repository config. */ }
  }
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
  const sdkToolFamilies = Object.freeze([...(config.sdkToolFamilies ?? extractSdkToolFamilies(readFileSync(SDK_TOOLS_SOURCE, "utf8")))].sort());
  const names = new Set<string>(sdkToolFamilies);
  const sites = new Map<string, Set<string>>();
  const unresolved = new Set<string>();
  const roots = new Set<string>();

  for (const root of parseBuiltinFactoryRoots(files[BUILTIN_ROOT] ?? "", BUILTIN_ROOT, files)) roots.add(root);
  for (const root of parseOptionalExtensionRoots(files[SESSION_ROOT] ?? "", config)) roots.add(root);
  if (files[SERVICE_FACTORY_ROOT]) roots.add(SERVICE_FACTORY_ROOT);
  if (containsCall(files[SESSION_ROOT] ?? "", "createMcpAdapter")) names.add("mcp");

  const compositionRoots = Object.freeze([...roots].sort());
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
    for (const registration of parseRegistrations(file, source, files)) {
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

  // Module-graph-only edges prove latent reachability without pretending that an imported
  // factory's registerTool body was invoked by current composition.
  const graphQueue = [...roots].sort();
  const graphScanned = new Set<string>();
  while (graphQueue.length > 0) {
    const file = graphQueue.shift()!;
    if (graphScanned.has(file)) continue;
    graphScanned.add(file);
    const source = files[file];
    if (source === undefined) continue;
    for (const dependency of resolveModuleGraphEdges(file, source, files)) {
      if (!roots.has(dependency)) roots.add(dependency);
      if (!graphScanned.has(dependency)) graphQueue.push(dependency);
    }
    graphQueue.sort();
  }

  const duplicateSites = new Map<string, Set<string>>();
  for (const [file, source] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    if (scanned.has(file)) continue;
    for (const registration of parseRegistrations(file, source, files)) {
      if (registration.name && names.has(registration.name)) addSite(duplicateSites, registration.name, file);
    }
  }

  return Object.freeze({
    names: Object.freeze([...names].sort()),
    unresolvedRegistrations: Object.freeze([...unresolved].sort()),
    sdkToolFamilies,
    compositionRoots,
    productionRoots: Object.freeze([...roots].sort()),
    registrationSites: readonlySiteRecord(sites),
    nonProductionDuplicateSites: readonlySiteRecord(duplicateSites),
  });
}

export function snapshotRepositoryToolContracts(
  tree: SourceTree = readRepositorySourceTree(),
  config: ProductionCompositionConfig = {},
): Readonly<Record<string, StaticToolContract>> {
  const inventory = inventoryRepositoryToolFamilies(tree, config);
  const contracts: Record<string, StaticToolContract> = Object.create(null);
  for (const [name, sites] of Object.entries(inventory.registrationSites)) {
    const file = sites[0];
    const source = file && tree.files[file];
    if (!file || source === undefined) continue;
    const contract = staticRegistrationContract(name, file, source, tree.files);
    if (contract) contracts[name] = contract;
  }
  for (const name of inventory.sdkToolFamilies) {
    const path = resolve(runtimeRoot, `../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/${name}.js`);
    contracts[name] = staticSdkContract(name, readFileSync(path, "utf8"));
  }
  if (inventory.names.includes("mcp")) {
    contracts.mcp = freezeContract("mcp", "programmatic pi-mcp-adapter factory", "", "external:pi-mcp-adapter");
  }
  return Object.freeze(Object.fromEntries(Object.entries(contracts).sort(([left], [right]) => left.localeCompare(right))));
}

export function resolveRepositoryModule(fromFile: string, specifier: string, files: Readonly<Record<string, string>>): string | null {
  return resolveSourceFile(fromFile, specifier, files);
}

export function extractSdkToolFamilies(source: string): readonly string[] {
  const ast = sourceFile("@earendil-works/pi-coding-agent/core/tools/index.js", source);
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "allToolNames" || !declaration.initializer) continue;
      const initializer = declaration.initializer;
      if (!ts.isNewExpression(initializer) || calleeName(initializer.expression) !== "Set") continue;
      const values = initializer.arguments?.[0];
      if (!values || !ts.isArrayLiteralExpression(values) || !values.elements.every(ts.isStringLiteralLike)) continue;
      return Object.freeze(values.elements.map((entry) => entry.text).sort());
    }
  }
  throw new Error("SDK allToolNames literal was not found");
}

function staticRegistrationContract(name: string, file: string, source: string, files: Readonly<Record<string, string>>): StaticToolContract | null {
  const ast = sourceFile(file, source);
  const constants = stringConstants(ast);
  const variables = variableInitializers(ast);
  let contract: StaticToolContract | null = null;
  const visit = (node: ts.Node): void => {
    if (contract || !ts.isCallExpression(node) || !isRegisterToolCall(node.expression) || !node.arguments[0]) {
      if (!contract) ts.forEachChild(node, visit);
      return;
    }
    const resolved = resolveRegistration(node.arguments[0], constants, variables, ast, file, files);
    if (resolved.name !== name) return;
    const argument = node.arguments[0];
    const object = ts.isObjectLiteralExpression(argument) ? argument : null;
    const description = object && objectProperty(object, "description");
    const prompt = object && objectProperty(object, "promptSnippet");
    const parameters = object && objectProperty(object, "parameters");
    contract = freezeContract(
      name,
      description ? normalizeContractText(description.initializer.getText(ast)) : `factory:${normalizeContractText(argument.getText(ast))}`,
      prompt ? normalizeContractText(prompt.initializer.getText(ast)) : "",
      parameters ? fingerprint(parameters.initializer.getText(ast)) : fingerprint(`factory:${argument.getText(ast)}`),
    );
  };
  visit(ast);
  return contract;
}

function staticSdkContract(name: string, source: string): StaticToolContract {
  const ast = sourceFile(`${name}.js`, source);
  const definition = `create${name[0]!.toUpperCase()}${name.slice(1)}ToolDefinition`;
  let object: ts.ObjectLiteralExpression | null = null;
  for (const statement of ast.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== definition || !statement.body) continue;
    const visit = (node: ts.Node): void => {
      if (!object && ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) object = node.expression;
      if (!object) ts.forEachChild(node, visit);
    };
    visit(statement.body);
  }
  if (!object) return freezeContract(name, `unresolved:${definition}`, "", fingerprint(`unresolved:${definition}`));
  const description = objectProperty(object, "description");
  const prompt = objectProperty(object, "promptSnippet");
  const parameters = objectProperty(object, "parameters");
  return freezeContract(
    name,
    description ? normalizeContractText(description.initializer.getText(ast)) : "",
    prompt ? normalizeContractText(prompt.initializer.getText(ast)) : "",
    parameters ? fingerprint(parameters.initializer.getText(ast)) : fingerprint(`unresolved-schema:${definition}`),
  );
}

function freezeContract(name: string, description: string, promptSnippet: string, parameterSchemaFingerprint: string): StaticToolContract {
  return Object.freeze({ name, description, promptSnippet, parameterSchemaFingerprint });
}

function normalizeContractText(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function fingerprint(value: string): string { return createHash("sha256").update(normalizeContractText(value)).digest("hex"); }

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

export interface RegistrationParameterInventory {
  readonly fieldsByTool: Readonly<Record<string, readonly string[]>>;
  readonly unresolvedSchemas: readonly Readonly<{ file: string; registration: string }>[];
}

export interface NativeToolSchemaInventory {
  readonly fieldsByTool: Readonly<Record<string, readonly string[]>>;
  readonly variantsByTool: Readonly<Record<string, readonly Readonly<{ source: string; fields: readonly string[]; fingerprint: string }>[]>>;
  readonly unresolvedSchemas: readonly Readonly<{ file: string; registration: string }>[];
}

export function extractNativeToolParameterFields(): NativeToolSchemaInventory {
  const fieldsByTool: Record<string, readonly string[]> = Object.create(null);
  const variantsByTool: Record<string, readonly Readonly<{ source: string; fields: readonly string[]; fingerprint: string }>[]> = Object.create(null);
  const unresolvedSchemas: Array<Readonly<{ file: string; registration: string }>> = [];
  for (const toolName of ["read", "write", "edit", "bash", "grep", "find", "ls"] as const) {
    const variants = toolName === "grep" || toolName === "find" || toolName === "ls"
      ? [["@earendil-works/pi-coding-agent", resolve(runtimeRoot, `../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/${toolName}.js`)]] as const
      : [
          ["@earendil-works/pi-agent-core", resolve(runtimeRoot, `../node_modules/@earendil-works/pi-agent-core/dist/harness/tools/${toolName}.js`)],
          ["@earendil-works/pi-coding-agent", resolve(runtimeRoot, `../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/${toolName}.js`)],
        ] as const;
    const snapshots: Array<Readonly<{ source: string; fields: readonly string[]; fingerprint: string }>> = [];
    for (const [packageName, path] of variants) {
      const source = readFileSync(path, "utf8");
      const schema = extractFirstTypeObjectSchema(path, source);
      if (!schema) {
        unresolvedSchemas.push(Object.freeze({ file: path, registration: toolName }));
        continue;
      }
      snapshots.push(Object.freeze({ source: `${packageName}:${posix.basename(path)}`, fields: Object.freeze(schema.fields), fingerprint: fingerprint(schema.source) }));
    }
    if (snapshots.length > 0) fieldsByTool[toolName] = snapshots[0]!.fields;
    variantsByTool[toolName] = Object.freeze(snapshots);
  }
  return Object.freeze({
    fieldsByTool: Object.freeze(fieldsByTool),
    variantsByTool: Object.freeze(variantsByTool),
    unresolvedSchemas: Object.freeze(unresolvedSchemas),
  });
}

function extractFirstTypeObjectSchema(file: string, source: string): { fields: string[]; source: string } | null {
  const ast = sourceFile(file, source);
  const variables = variableInitializers(ast);
  let schema: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (!schema && ts.isPropertyAssignment(node) && propertyName(node.name) === "parameters") {
      schema = ts.isIdentifier(node.initializer) ? variables.get(node.initializer.text) ?? null : node.initializer;
    }
    if (!schema) ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!schema || !ts.isCallExpression(schema) || !ts.isPropertyAccessExpression(schema.expression)
    || schema.expression.expression.getText(ast) !== "Type" || schema.expression.name.text !== "Object") return null;
  const object = schema.arguments[0];
  if (!object || !ts.isObjectLiteralExpression(object)) return null;
  const fields = object.properties.map((property) => propertyName(property.name)).filter((name): name is string => name !== null);
  if (fields.length !== object.properties.length) return null;
  return { fields, source: schema.getText(ast) };
}

export function extractLiteralRegistrationParameterFields(
  file: string,
  source: string,
  files: Readonly<Record<string, string>> = {},
): RegistrationParameterInventory {
  const ast = sourceFile(file, source);
  const variables = variableInitializers(ast);
  const constants = stringConstants(ast);
  const fieldsByTool: Record<string, readonly string[]> = Object.create(null);
  const unresolvedSchemas: Array<Readonly<{ file: string; registration: string }>> = [];
  const parameterKeys = (expression: ts.Expression, seen = new Set<string>()): string[] | null => {
    if (ts.isCallExpression(expression) && expression.arguments[0]) return parameterKeys(expression.arguments[0], seen);
    if (ts.isObjectLiteralExpression(expression)) {
      const jsonSchemaProperties = objectProperty(expression, "properties");
      const fieldObject = jsonSchemaProperties && ts.isObjectLiteralExpression(jsonSchemaProperties.initializer)
        ? jsonSchemaProperties.initializer : expression;
      const names: string[] = [];
      for (const property of fieldObject.properties) {
        if (!ts.isPropertyAssignment(property)) return null;
        const name = propertyName(property.name);
        if (!name) return null;
        names.push(name);
      }
      return names;
    }
    if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
      seen.add(expression.text);
      const initializer = variables.get(expression.text);
      return initializer ? parameterKeys(initializer, seen) : null;
    }
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRegisterToolCall(node.expression) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const nameProperty = objectProperty(node.arguments[0], "name");
      const parametersProperty = objectProperty(node.arguments[0], "parameters");
      if (nameProperty && parametersProperty) {
        const toolName = ts.isStringLiteralLike(nameProperty.initializer)
          ? nameProperty.initializer.text
          : ts.isIdentifier(nameProperty.initializer)
            ? constants.get(nameProperty.initializer.text) ?? resolveImportedString(nameProperty.initializer.text, file, ast, files) ?? undefined
            : undefined;
        const fields = parameterKeys(parametersProperty.initializer);
        if (toolName && fields) fieldsByTool[toolName] = Object.freeze(fields);
        else unresolvedSchemas.push(Object.freeze({
          file,
          registration: `${toolName ?? compact(nameProperty.initializer.getText(ast))}#${compact(parametersProperty.initializer.getText(ast))}`,
        }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return Object.freeze({
    fieldsByTool: Object.freeze(fieldsByTool),
    unresolvedSchemas: Object.freeze(unresolvedSchemas),
  });
}

function parseRegistrations(
  file: string,
  source: string,
  files: Readonly<Record<string, string>> = {},
): Array<{ name: string | null; fingerprint: string }> {
  const ast = sourceFile(file, source);
  const constants = stringConstants(ast);
  const variables = variableInitializers(ast);
  const registrations: Array<{ name: string | null; fingerprint: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRegisterToolCall(node.expression)) {
      const argument = node.arguments[0];
      registrations.push(argument
        ? resolveRegistration(argument, constants, variables, ast, file, files)
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
  file: string,
  files: Readonly<Record<string, string>>,
): { name: string | null; fingerprint: string } {
  if (ts.isObjectLiteralExpression(argument)) {
    const property = objectProperty(argument, "name");
    if (property) {
      if (ts.isStringLiteralLike(property.initializer)) return { name: property.initializer.text, fingerprint: "literal" };
      if (ts.isIdentifier(property.initializer)) {
        const name = constants.get(property.initializer.text) ?? resolveImportedString(property.initializer.text, file, ast, files);
        if (name) return { name, fingerprint: "source-constant" };
      }
      return { name: null, fingerprint: `name:${compact(property.initializer.getText(ast))}` };
    }
    const spreads = argument.properties.filter(ts.isSpreadAssignment);
    if (spreads.length === 1 && ts.isIdentifier(spreads[0].expression)) {
      const identifier = spreads[0].expression.text;
      const initializer = variables.get(identifier);
      if (initializer && ts.isCallExpression(initializer)) {
        const factory = calleeName(initializer.expression);
        const name = factory && resolveFactoryToolName(factory, file, ast, files);
        if (name) return { name, fingerprint: `source-factory:${factory}` };
      }
      const inferred = /([A-Za-z][A-Za-z0-9]*)Tool$/.exec(identifier)?.[1];
      if (inferred) return { name: camelToSnake(inferred), fingerprint: `spread:${identifier}` };
    }
    return { name: null, fingerprint: `spread:${spreads.map((spread) => compact(spread.expression.getText(ast))).join("+") || "none"}` };
  }
  if (ts.isCallExpression(argument)) {
    const factory = calleeName(argument.expression);
    const name = factory && resolveFactoryToolName(factory, file, ast, files);
    return name ? { name, fingerprint: `source-factory:${factory}` } : { name: null, fingerprint: `factory:${factory ?? "unknown"}` };
  }
  return { name: null, fingerprint: `expression:${compact(argument.getText(ast))}` };
}

function resolveImportedString(
  localName: string,
  file: string,
  ast: ts.SourceFile,
  files: Readonly<Record<string, string>>,
): string | null {
  const binding = importBindings(ast).get(localName);
  if (!binding) return null;
  const target = resolveSourceFile(file, binding.specifier, files);
  return target ? resolveExportedString(target, binding.imported, files, new Set()) : null;
}

function resolveExportedString(
  file: string,
  exportedName: string,
  files: Readonly<Record<string, string>>,
  seen: Set<string>,
): string | null {
  const key = `${file}#${exportedName}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const source = files[file];
  if (source === undefined) return null;
  const ast = sourceFile(file, source);
  const local = stringConstants(ast).get(exportedName);
  if (local) return local;
  for (const statement of ast.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    const specifier = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text : null;
    if (clause && ts.isNamedExports(clause)) {
      const element = clause.elements.find((candidate) => candidate.name.text === exportedName);
      if (!element) continue;
      const original = element.propertyName?.text ?? element.name.text;
      if (!specifier) return stringConstants(ast).get(original) ?? null;
      const target = resolveSourceFile(file, specifier, files);
      return target ? resolveExportedString(target, original, files, seen) : null;
    }
    if (!clause && specifier) {
      const target = resolveSourceFile(file, specifier, files);
      const value = target ? resolveExportedString(target, exportedName, files, seen) : null;
      if (value) return value;
    }
  }
  return null;
}

function resolveFactoryToolName(
  localName: string,
  file: string,
  ast: ts.SourceFile,
  files: Readonly<Record<string, string>>,
): string | null {
  const local = findFactoryToolName(ast, localName);
  if (local) return local;
  const binding = importBindings(ast).get(localName);
  if (!binding) return factoryConvention(localName);
  const target = resolveSourceFile(file, binding.specifier, files);
  return target
    ? resolveExportedFactoryToolName(target, binding.imported, files, new Set())
    : factoryConvention(binding.imported);
}

function resolveExportedFactoryToolName(
  file: string,
  exportedName: string,
  files: Readonly<Record<string, string>>,
  seen: Set<string>,
): string | null {
  const key = `${file}#${exportedName}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const source = files[file];
  if (source === undefined) return null;
  const ast = sourceFile(file, source);
  const local = findFactoryToolName(ast, exportedName);
  if (local) return local;
  for (const statement of ast.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    const specifier = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text : null;
    if (clause && ts.isNamedExports(clause)) {
      const element = clause.elements.find((candidate) => candidate.name.text === exportedName);
      if (!element) continue;
      const original = element.propertyName?.text ?? element.name.text;
      if (!specifier) return findFactoryToolName(ast, original);
      const target = resolveSourceFile(file, specifier, files);
      return target ? resolveExportedFactoryToolName(target, original, files, seen) : null;
    }
    if (!clause && specifier) {
      const target = resolveSourceFile(file, specifier, files);
      const value = target ? resolveExportedFactoryToolName(target, exportedName, files, seen) : null;
      if (value) return value;
    }
  }
  return null;
}

function findFactoryToolName(ast: ts.SourceFile, symbol: string): string | null {
  let body: ts.ConciseBody | undefined;
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === symbol) body = statement.body;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === symbol && declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) body = declaration.initializer.body;
    }
  }
  if (!body) return null;
  let found: string | null = null;
  const inspectObject = (object: ts.ObjectLiteralExpression): void => {
    const property = objectProperty(object, "name");
    if (property && ts.isStringLiteralLike(property.initializer)) found = property.initializer.text;
  };
  if (ts.isObjectLiteralExpression(body)) inspectObject(body);
  else {
    const visit = (node: ts.Node): void => {
      if (!found && ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) inspectObject(node.expression);
      if (!found) ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return found;
}

function factoryConvention(value: string): string | null {
  const stem = /^create(.+)Tool$/.exec(value)?.[1];
  return stem ? camelToSnake(stem) : null;
}

function camelToSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
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

function resolveModuleGraphEdges(file: string, source: string, files: Readonly<Record<string, string>>): string[] {
  const ast = sourceFile(file, source);
  const roots: string[] = [];
  const add = (specifier: string): void => {
    const resolved = resolveSourceFile(file, specifier, files);
    if (resolved && !roots.includes(resolved)) roots.push(resolved);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) add(node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) add(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") {
        add(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return roots.sort();
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
  if (specifier.startsWith(".")) return resolveCandidate(posix.join(posix.dirname(fromFile), specifier), files);
  const configured = resolveTsconfigPath(specifier, files);
  if (configured) return configured;
  const imported = resolvePackageImport(specifier, files);
  if (imported) return imported;
  return resolvePackageExport(specifier, files);
}

function resolveTsconfigPath(specifier: string, files: Readonly<Record<string, string>>): string | null {
  const parsed = parseJsonConfig(files["tsconfig.json"]);
  const compiler = parsed?.compilerOptions;
  if (!compiler || typeof compiler !== "object" || Array.isArray(compiler)) return null;
  const paths = (compiler as Record<string, unknown>).paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return null;
  const baseUrl = typeof (compiler as Record<string, unknown>).baseUrl === "string"
    ? (compiler as Record<string, unknown>).baseUrl as string : ".";
  for (const [pattern, rawTargets] of Object.entries(paths as Record<string, unknown>)) {
    const wildcard = matchPattern(pattern, specifier);
    if (wildcard === null || !Array.isArray(rawTargets)) continue;
    for (const rawTarget of rawTargets) {
      if (typeof rawTarget !== "string") continue;
      const target = rawTarget.replace("*", wildcard);
      const resolved = resolveCandidate(posix.join(baseUrl, target), files);
      if (resolved) return resolved;
    }
  }
  return null;
}

function resolvePackageImport(specifier: string, files: Readonly<Record<string, string>>): string | null {
  if (!specifier.startsWith("#")) return null;
  const manifest = parseJsonConfig(files["package.json"]);
  const imports = manifest?.imports;
  if (!imports || typeof imports !== "object" || Array.isArray(imports)) return null;
  return resolveExportMapTarget(specifier, imports as Record<string, unknown>, "", files);
}

function resolvePackageExport(specifier: string, files: Readonly<Record<string, string>>): string | null {
  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? "";
  if (!packageName) return null;
  const subpath = specifier.slice(packageName.length);
  const rootManifest = parseJsonConfig(files["package.json"]);
  const rootName = typeof rootManifest?.name === "string" ? rootManifest.name : null;
  const packageRoot = rootName === packageName ? "" : `node_modules/${packageName}`;
  const manifest = rootName === packageName ? rootManifest : parseJsonConfig(files[posix.join(packageRoot, "package.json")]);
  if (!manifest) return null;
  const exports = manifest.exports;
  if (exports === undefined) return null;
  const exportKey = subpath ? `.${subpath}` : ".";
  if (typeof exports === "string" && exportKey === ".") return resolveCandidate(posix.join(packageRoot, normalizePackageTarget(exports)), files);
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) return null;
  return resolveExportMapTarget(exportKey, exports as Record<string, unknown>, packageRoot, files);
}

function resolveExportMapTarget(specifier: string, map: Record<string, unknown>, packageRoot: string, files: Readonly<Record<string, string>>): string | null {
  for (const [pattern, rawTarget] of Object.entries(map)) {
    const wildcard = matchPattern(pattern, specifier);
    if (wildcard === null) continue;
    const target = selectExportTarget(rawTarget);
    if (!target) continue;
    const resolved = resolveCandidate(posix.join(packageRoot, normalizePackageTarget(target.replace("*", wildcard))), files);
    if (resolved) return resolved;
  }
  return null;
}

function selectExportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const condition of ["import", "bun", "node", "default"]) {
    const selected = selectExportTarget(record[condition]);
    if (selected) return selected;
  }
  return null;
}

function matchPattern(pattern: string, value: string): string | null {
  const index = pattern.indexOf("*");
  if (index < 0) return pattern === value ? "" : null;
  if (pattern.indexOf("*", index + 1) >= 0) return null;
  const prefix = pattern.slice(0, index);
  const suffix = pattern.slice(index + 1);
  return value.startsWith(prefix) && value.endsWith(suffix) ? value.slice(prefix.length, value.length - suffix.length) : null;
}

function normalizePackageTarget(target: string): string {
  const normalized = target.replace(/^\.\//, "");
  return normalized.startsWith("runtime/") ? normalized.slice("runtime/".length) : normalized;
}

function resolveCandidate(value: string, files: Readonly<Record<string, string>>): string | null {
  const base = posix.normalize(value).replace(/^\.\//, "");
  if (base.startsWith("../") || base === "..") return null;
  const withoutExtension = base.replace(/\.(?:[cm]?js|tsx?)$/, "");
  const candidates = [base, `${withoutExtension}.ts`, `${withoutExtension}.tsx`, posix.join(base, "index.ts")];
  return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
}

function parseJsonConfig(source: string | undefined): Record<string, unknown> | null {
  if (source === undefined) return null;
  try {
    const parsed = ts.parseConfigFileTextToJson("fixture.json", source).config;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
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

function readonlySiteRecord(source: Map<string, Set<string>>): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(Object.fromEntries(
    [...source].sort(([left], [right]) => left.localeCompare(right)).map(([name, values]) => [name, Object.freeze([...values].sort())]),
  ));
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
