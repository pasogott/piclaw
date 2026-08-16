import { posix } from "node:path";

export type VirtualTreeNode =
  | { readonly kind: "directory" }
  | { readonly kind: "file"; readonly content: string }
  | { readonly kind: "symlink"; readonly target: string }
  | { readonly kind: "unreadable" }
  | { readonly kind: "broken" };
export interface VirtualPackageTree {
  readonly nodeModulesRoot: string;
  readonly nodes: Readonly<Record<string, VirtualTreeNode>>;
}
export type AddonRejectionCode =
  | "duplicate_declaration"
  | "lexical_escape"
  | "missing_target"
  | "non_file_target"
  | "realpath_escape"
  | "unreadable_target";
export interface AddonPathRejection {
  readonly packagePath: string;
  readonly declaration: string;
  readonly code: AddonRejectionCode;
}
export interface AddonExtensionResolution {
  readonly fixtureValid: boolean;
  readonly extensionPaths: readonly string[];
  readonly packagePaths: readonly string[];
  readonly rejections: readonly AddonPathRejection[];
}

const TREE_FIELDS = new Set(["nodeModulesRoot", "nodes"]);
const MAX_TREE_NODES = 20_000;
const INVALID_RESULT = Object.freeze({
  fixtureValid: false,
  extensionPaths: Object.freeze([]),
  packagePaths: Object.freeze([]),
  rejections: Object.freeze([]),
});

/** Hermetic descriptor-closed model of production pi.extensions discovery. */
export function resolveAddonPackageTree(value: unknown): AddonExtensionResolution {
  const tree = snapshotTree(value);
  if (!tree) return INVALID_RESULT;
  const root = normalize(tree.nodeModulesRoot);
  const packagePaths = listPackagePaths(root, tree);
  const extensions: string[] = [];
  const seenRealTargets = new Set<string>();
  const rejections: AddonPathRejection[] = [];

  for (const packagePath of packagePaths) {
    const packageResolution = resolveNode(packagePath, tree);
    if (!packageResolution || packageResolution.node.kind !== "directory") continue;
    const manifestResolution = resolveNode(posix.join(packagePath, "package.json"), tree);
    if (!manifestResolution || manifestResolution.node.kind !== "file") continue;

    let manifest: unknown;
    try { manifest = JSON.parse(manifestResolution.node.content); }
    catch { continue; }
    const declared = readDeclaredExtensions(manifest);
    if (!declared) continue;

    const packageRealRoot = packageResolution.realPath;
    const seenDeclarations = new Set<string>();
    for (const declaration of declared) {
      // Production discovery ignores malformed declaration values with the package.
      if (typeof declaration !== "string" || !declaration.trim()) continue;
      if (seenDeclarations.has(declaration)) {
        reject(rejections, packagePath, declaration, "duplicate_declaration");
        continue;
      }
      seenDeclarations.add(declaration);
      const lexicalTarget = normalize(posix.resolve(packagePath, declaration));
      if (!contained(packagePath, lexicalTarget)) {
        reject(rejections, packagePath, declaration, "lexical_escape");
        continue;
      }
      const target = resolveNode(lexicalTarget, tree);
      if (!target) {
        reject(rejections, packagePath, declaration, "missing_target");
        continue;
      }
      if (!contained(packageRealRoot, target.realPath)) {
        reject(rejections, packagePath, declaration, "realpath_escape");
        continue;
      }
      if (target.node.kind === "unreadable") {
        reject(rejections, packagePath, declaration, "unreadable_target");
        continue;
      }
      if (target.node.kind !== "file") {
        reject(rejections, packagePath, declaration, "non_file_target");
        continue;
      }
      if (seenRealTargets.has(target.realPath)) {
        reject(rejections, packagePath, declaration, "duplicate_declaration");
        continue;
      }
      seenRealTargets.add(target.realPath);
      extensions.push(lexicalTarget);
    }
  }

  return Object.freeze({
    fixtureValid: true,
    extensionPaths: Object.freeze(extensions),
    packagePaths: Object.freeze(packagePaths),
    rejections: Object.freeze(rejections),
  });
}

function snapshotTree(value: unknown): VirtualPackageTree | null {
  const outer = snapshotClosedObject(value, TREE_FIELDS);
  if (!outer || typeof outer.nodeModulesRoot !== "string" || !outer.nodeModulesRoot) return null;
  if (!outer.nodes || typeof outer.nodes !== "object") return null;
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(outer.nodes)) return null;
    keys = Reflect.ownKeys(outer.nodes);
    descriptors = Object.getOwnPropertyDescriptors(outer.nodes);
  } catch { return null; }
  if (keys.length > MAX_TREE_NODES) return null;
  const nodes: Record<string, VirtualTreeNode> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") return null;
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) return null;
    const node = snapshotNode(descriptor.value);
    if (!node) return null;
    const path = normalize(key);
    if (Object.hasOwn(nodes, path)) return null;
    nodes[path] = node;
  }
  return Object.freeze({ nodeModulesRoot: outer.nodeModulesRoot, nodes: Object.freeze(nodes) });
}

function snapshotNode(value: unknown): VirtualTreeNode | null {
  const kindSnapshot = snapshotClosedObject(value, new Set(["kind", "content", "target"]));
  if (!kindSnapshot || typeof kindSnapshot.kind !== "string") return null;
  const keys = Object.keys(kindSnapshot).sort().join(",");
  switch (kindSnapshot.kind) {
    case "directory":
    case "unreadable":
    case "broken":
      return keys === "kind" ? Object.freeze({ kind: kindSnapshot.kind }) : null;
    case "file":
      return keys === "content,kind" && typeof kindSnapshot.content === "string"
        ? Object.freeze({ kind: "file", content: kindSnapshot.content }) : null;
    case "symlink":
      return keys === "kind,target" && typeof kindSnapshot.target === "string"
        ? Object.freeze({ kind: "symlink", target: kindSnapshot.target }) : null;
    default:
      return null;
  }
}

function snapshotClosedObject(value: unknown, fields: ReadonlySet<string>): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(value)) return null;
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return null; }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !fields.has(key)) return null;
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function listPackagePaths(root: string, tree: VirtualPackageTree): string[] {
  const immediate = childNames(root, tree);
  const packages: string[] = [];
  for (const name of immediate) {
    const path = posix.join(root, name);
    const lexical = tree.nodes[path];
    if (!lexical || lexical.kind !== "directory" && lexical.kind !== "symlink") continue;
    if (name.startsWith("@")) {
      const scope = resolveNode(path, tree);
      if (!scope || scope.node.kind !== "directory") continue;
      for (const child of childNames(path, tree)) {
        const childPath = posix.join(path, child);
        const childNode = resolveNode(childPath, tree);
        if (childNode?.node.kind === "directory" || tree.nodes[childPath]?.kind === "symlink") packages.push(childPath);
      }
    } else packages.push(path);
  }
  return packages.sort();
}

function childNames(parent: string, tree: VirtualPackageTree): string[] {
  const resolvedParent = resolveNode(parent, tree);
  const scanRoot = resolvedParent?.node.kind === "directory" ? resolvedParent.realPath : normalize(parent);
  const prefix = `${scanRoot}/`;
  const names = new Set<string>();
  for (const path of Object.keys(tree.nodes)) {
    const normalized = normalize(path);
    if (!normalized.startsWith(prefix)) continue;
    const remainder = normalized.slice(prefix.length);
    if (remainder && !remainder.includes("/")) names.add(remainder);
  }
  return [...names].sort();
}

function resolveNode(path: string, tree: VirtualPackageTree): { realPath: string; node: VirtualTreeNode } | null {
  let current = normalize(path);
  const seen = new Set<string>();
  for (let depth = 0; depth < 16; depth += 1) {
    if (seen.has(current)) return null;
    seen.add(current);
    const node = tree.nodes[current];
    if (node?.kind === "broken") return null;
    if (node?.kind === "symlink") {
      current = normalize(posix.resolve(posix.dirname(current), node.target));
      continue;
    }
    if (node) return { realPath: current, node };
    let ancestor = posix.dirname(current);
    while (ancestor !== "/") {
      const ancestorNode = tree.nodes[ancestor];
      if (ancestorNode?.kind === "broken") return null;
      if (ancestorNode?.kind === "symlink") {
        const suffix = posix.relative(ancestor, current);
        current = normalize(posix.join(posix.resolve(posix.dirname(ancestor), ancestorNode.target), suffix));
        break;
      }
      ancestor = posix.dirname(ancestor);
    }
    if (ancestor === "/") return null;
  }
  return null;
}

function readDeclaredExtensions(value: unknown): unknown[] | null {
  if (!plainRecord(value)) return null;
  const pi = value.pi;
  if (!plainRecord(pi) || !Array.isArray(pi.extensions)) return null;
  return [...pi.extensions];
}
function plainRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function normalize(path: string): string { return posix.resolve("/", path); }
function contained(parent: string, child: string): boolean {
  const relative = posix.relative(normalize(parent), normalize(child));
  return relative === "" || (!relative.startsWith("../") && relative !== "..");
}
function reject(rejections: AddonPathRejection[], packagePath: string, declaration: string, code: AddonRejectionCode): void {
  rejections.push(Object.freeze({ packagePath, declaration, code }));
}
