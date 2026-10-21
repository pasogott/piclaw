import { isAbsolute } from "node:path";

async function openRelocationPrimitive() {
  if (process.platform !== "linux") throw Error("Atomic no-replace archive relocation requires qualified Linux support");
  const { dlopen, FFIType } = await import("bun:ffi");
  return dlopen("libc.so.6", { renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 } });
}
export async function assertArchiveRelocationPrimitiveAvailable() { (await openRelocationPrimitive()).close(); }

/** Offline Linux operator primitive. No overwrite or cross-device copy fallback. */
export async function relocateArchivesNoReplace(source: string, destination: string) {
  if (![source, destination].every(p => isAbsolute(p) && !p.includes("\0"))) throw Error("Invalid archive relocation path");
  const { ptr } = await import("bun:ffi");
  const libc = await openRelocationPrimitive();
  const from = Buffer.from(source + "\0"), to = Buffer.from(destination + "\0");
  try {
    if (libc.symbols.renameat2(-100, ptr(from), -100, ptr(to), 1) !== 0) throw Error("Atomic no-replace archive relocation failed; no copy fallback attempted");
  } finally { libc.close(); }
}
