import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHostDelegateFileReader, validateDelegateFiles } from "../../runtime/durable-engine/src/host-delegate-files.ts";

test("native attachments: actual bytes, workspace policy, UTF-8, special files and authority checkpoints", async () => {
  const root = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, "attachments-"));
  const outside = `${root}-outside`;
  const read = createHostDelegateFileReader(root);
  const allow = () => {};
  try {
    const exact = "é\r\n\t" + "x".repeat(99995);
    writeFileSync(join(root, "unknown"), exact);
    const result = await read(["unknown"], allow);
    expect(result[0]!.text).toContain(exact);
    expect(result[0]!.text).not.toContain(root);
    writeFileSync(join(root, "extra"), "x");
    await expect(read(["unknown", "extra"], allow)).rejects.toThrow("Delegate attachment unavailable");
    writeFileSync(join(root, "large"), "é".repeat(50001));
    writeFileSync(outside, "private");
    symlinkSync(outside, join(root, "escape"));
    symlinkSync(join(root, "extra"), join(root, "inside"));
    expect((await read(["inside"], allow))[0]!.text).toContain("\nx\n");
    // Fixture creation only; production reader never invokes a process.
    execFileSync("mkfifo", [join(root, "fifo")]);
    for (const path of ["large", "escape", outside, "../absent", "missing", ".", "fifo", "*.txt"]) {
      await expect(read([path], allow)).rejects.toThrow("Delegate attachment unavailable");
    }
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from("a\0b"), Buffer.from("GIF89a"), Buffer.from("%PDF-1.7"), Buffer.from("PK\x03\x04"), Buffer.from("BMtext"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff])]) {
      writeFileSync(join(root, "binary"), bytes);
      await expect(read(["binary"], allow)).rejects.toThrow("Delegate attachment unavailable");
    }
    writeFileSync(join(root, "svg"), "<svg>text only</svg>");
    expect((await read(["svg"], allow))[0]!.type).toBe("text");
    expect(await read([], allow)).toEqual([]);
    for (const invalid of [Array(1), Array(11).fill("extra"), [42], ["a\0"], ["x".repeat(4097)], "extra"]) expect(() => validateDelegateFiles(invalid)).toThrow();
    // Revoke at every checkpoint, including immediately after fstat/read.
    let checkpoints = 0;
    await read(["extra"], () => { checkpoints++; });
    for (let stop = 1; stop <= checkpoints; stop++) {
      let calls = 0;
      const before = readdirSync("/proc/self/fd").length;
      await expect(read(["extra"], () => { if (++calls === stop) throw Error("revoked"); })).rejects.toThrow();
      expect(readdirSync("/proc/self/fd").length).toBe(before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { force: true }); }
});
