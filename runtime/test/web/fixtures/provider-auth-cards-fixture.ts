import { renderAdaptiveCard } from "../../../web/src/ui/adaptive-card-renderer.js";

const container = document.querySelector<HTMLElement>("#card")!;
const status = document.querySelector<HTMLElement>("#status")!;
async function show(result: any) {
  status.textContent = result.message;
  container.replaceChildren();
  const block = result.contentBlocks?.[0];
  if (!block) return;
  await renderAdaptiveCard(container, block, { onAction: async action => {
    if (action.type !== "Action.Submit") return;
    const response = await fetch("/fixture/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action.data) });
    await show(await response.json());
  } });
}
void fetch("/fixture/start").then(response => response.json()).then(show);
