#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

start_ms=$(date +%s%3N)

# Fast syntax/import precheck for key shell seams touched in this loop.
bun -e "await import('./runtime/web/src/ui/app-branch-actions.ts'); await import('./runtime/web/src/ui/app-window-actions.ts'); await import('./runtime/web/src/ui/app-status-refresh-orchestration.ts');" >/dev/null

tests=(
  runtime/test/web/app-branch-actions.test.ts
  runtime/test/web/app-window-actions.test.ts
  runtime/test/web/app-pane-mode-render.test.ts
  runtime/test/web/app-main-shell-render.test.ts
  runtime/test/web/app-status-refresh-orchestration.test.ts
)

for optional_test in \
  runtime/test/web/app-boot-load-orchestration.test.ts \
  runtime/test/web/app-branch-pane-orchestration.test.ts \
  runtime/test/web/app-shell-ref-utils.test.ts \
  runtime/test/web/app-main-shell-composition.test.ts \
  runtime/test/web/app-agent-status-orchestration.test.ts \
  runtime/test/web/app-timeline-actions.test.ts \
  runtime/test/web/app-btw-orchestration.test.ts
  do
  if [[ -f "$optional_test" ]]; then
    tests+=("$optional_test")
  fi
done

bun run ../runtime/scripts/local-test-priority.ts --env PICLAW_DB_IN_MEMORY=1 -- bun test --max-concurrency=1 "${tests[@]}"

end_ms=$(date +%s%3N)
focused_web_tests_ms=$((end_ms - start_ms))

app_ts_lines=$(wc -l < runtime/web/src/app.ts)

coherent_modules=(
  runtime/web/src/ui/app-boot-load-orchestration.ts
  runtime/web/src/ui/app-branch-pane-orchestration.ts
  runtime/web/src/ui/app-shell-ref-utils.ts
  runtime/web/src/ui/app-main-shell-composition.ts
  runtime/web/src/ui/app-agent-status-orchestration.ts
  runtime/web/src/ui/app-timeline-actions.ts
  runtime/web/src/ui/app-btw-orchestration.ts
)

number_of_coherent_modules=0
largest_extracted_module_lines=0
for module_path in "${coherent_modules[@]}"; do
  if [[ -f "$module_path" ]]; then
    number_of_coherent_modules=$((number_of_coherent_modules + 1))
    module_lines=$(wc -l < "$module_path")
    if (( module_lines > largest_extracted_module_lines )); then
      largest_extracted_module_lines=$module_lines
    fi
  fi
done

echo "METRIC app_ts_lines=${app_ts_lines}"
echo "METRIC focused_web_tests_ms=${focused_web_tests_ms}"
echo "METRIC largest_extracted_module_lines=${largest_extracted_module_lines}"
echo "METRIC number_of_coherent_modules=${number_of_coherent_modules}"
