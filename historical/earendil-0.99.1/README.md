# Frozen Earendil 0.99.1 evidence

`source.tar.gz` preserves the Piclaw source/test layout at `eea4816484ff80a917b43ed33cd93ea55eaf2948`. The manifest records the commit, included paths, archive SHA-256, hashes of retired files and the explicit 45-file test list. No credentials or installed dependencies are included.

Pi 1.0.0 removed the old Harness, Pico3 and execution-environment exports. The dormant local SDK backend, Harness assignments and old semantic tests now run only in this historical consumer. Current Piclaw keeps its own execution contract, adapter, fakes and authority tests. The old dual-family tool-schema comparisons, process cleanup tests and negative Harness probes remain unchanged in the archive.

Run from the repository root:

```sh
bun run check:earendil-history
```

The gate verifies the archive and retired-file hashes, extracts into an owned temporary directory, installs the frozen 0.99.1 lock with lifecycle scripts disabled and a private cache, checks all eight family versions, compiles the old runtime, and runs the explicit service-effect and historical fingerprint-receipt test list through Piclaw's isolation/niceness launcher. It cleans its temporary consumer afterwards. It requires package-registry access for an uncached install. Tests use Bun, including the upstream class named `NodeExecutionEnv`; no Node runtime is launched.

Five 0.99.1 auth fingerprint-receipt tests run here too, so they compare old receipts against the old installed SDK and lockfile. They must not compare those hashes to current 1.0.0 packages. The 1.0.0 browser/CLI qualification remains separate.

The archive is inert data. Production must not import it, resolve dependencies through it, activate its Harness or count its tests as Pi 1.0.0 qualification. The current negative boundary tests enforce that separation. Preserve this fixture unchanged when adding later-version evidence.
