/** Restricted invitation page. Grants live only in memory; no storage, logging or automatic claim. */
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing invitation form element.");
  return node as T;
}
const status = element<HTMLParagraphElement>("invitation-status");
const error = element<HTMLDivElement>("invitation-error");
const claimButton = element<HTMLButtonElement>("claim-invitation");
const section = element<HTMLElement>("enrolment");
const account = element<HTMLParagraphElement>("enrolment-account");
const secret = element<HTMLElement>("enrolment-secret");
const qr = element<HTMLImageElement>("enrolment-qr");
const form = element<HTMLFormElement>("confirmation-form");
const code = element<HTMLInputElement>("confirmation-code");
const confirmButton = element<HTMLButtonElement>("confirm-invitation");

let token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
// Remove fragment and query before any fetch. Reload deliberately requires a fresh invitation link.
history.replaceState(null, "", location.pathname);
let enrolmentToken = "", busy = false, claimed = false, finished = false;
let expiresAt = 0, expiryTimer: ReturnType<typeof setTimeout> | undefined;
let activeRequest: AbortController | undefined;

function clearSecrets(): void {
  token = ""; enrolmentToken = ""; secret.textContent = ""; qr.removeAttribute("src"); code.value = "";
  section.hidden = true; code.disabled = true; confirmButton.disabled = true; claimButton.hidden = true;
  if (expiryTimer) clearTimeout(expiryTimer);
}
function expire(): void {
  finished = true; activeRequest?.abort(); clearSecrets();
  status.textContent = "This setup session has expired.";
  error.textContent = "Ask your administrator for a new invitation.";
}

if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) {
  clearSecrets(); status.textContent = "No valid invitation was provided.";
  error.textContent = "Open the complete invitation link from your administrator.";
} else {
  status.textContent = "This invitation sets up an authenticator for one account. Setup expires five minutes after you begin.";
  claimButton.hidden = false;
}

claimButton.addEventListener("click", async () => {
  if (busy || claimed || !token || finished) return;
  busy = true; claimed = true; claimButton.disabled = true; error.textContent = "";
  activeRequest = new AbortController();
  const timeout = setTimeout(() => activeRequest?.abort(), 15000);
  try {
    const response = await fetch("/auth/invitation/claim", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: activeRequest.signal });
    if (!response.ok) throw new Error("Claim rejected.");
    const body = await response.json();
    if (finished) return;
    if (typeof body.enrolment_token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.enrolment_token)
      || typeof body.secret !== "string" || !/^[A-Z2-7]{32}$/.test(body.secret)
      || typeof body.username !== "string" || !Number.isFinite(body.expires_at) || body.expires_at <= Date.now()
      || typeof body.qr_data_url !== "string" || !body.qr_data_url.startsWith("data:image/svg+xml;base64,")) throw new Error("Invalid enrolment response.");
    enrolmentToken = body.enrolment_token; expiresAt = body.expires_at;
    account.textContent = `Account: ${body.username}`; secret.textContent = body.secret; qr.src = body.qr_data_url;
    claimButton.hidden = true; section.hidden = false; code.disabled = false; confirmButton.disabled = false;
    status.textContent = "Scan the QR code, then enter the six-digit code from your authenticator.";
    expiryTimer = setTimeout(expire, Math.min(expiresAt - Date.now(), 5 * 60_000)); code.focus();
  } catch {
    if (!finished) {
      finished = true; clearSecrets(); status.textContent = "Setup could not begin.";
      error.textContent = "The invitation may be expired or already used. Ask your administrator for a new link; do not retry a consumed claim.";
    }
  } finally { clearTimeout(timeout); busy = false; }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || finished || !token || !enrolmentToken) return;
  if (Date.now() >= expiresAt) { expire(); return; }
  const value = code.value.trim();
  if (!/^\d{6}$/.test(value)) { error.textContent = "Enter a six-digit code."; return; }
  busy = true; confirmButton.disabled = true; error.textContent = "";
  activeRequest = new AbortController();
  const timeout = setTimeout(() => activeRequest?.abort(), 15000);
  try {
    const response = await fetch("/auth/invitation/confirm", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, enrolment_token: enrolmentToken, code: value }), signal: activeRequest.signal });
    const body = await response.json();
    if (finished) return;
    if (!response.ok || body.enrolled !== true || body.login_required !== true) { error.textContent = "The code or invitation was not accepted. Check the code; after repeated failures request a new invitation."; return; }
    finished = true; clearSecrets(); status.textContent = "Account setup complete. Sign in to continue.";
    element<HTMLAnchorElement>("invitation-login").textContent = "Sign in";
  } catch {
    if (!finished) error.textContent = "Confirmation could not be verified. Try signing in if setup completed, or request a new invitation.";
  } finally { clearTimeout(timeout); busy = false; if (!finished) confirmButton.disabled = false; }
});

addEventListener("hashchange", () => {
  if (!location.hash) return;
  // A fresh link in this tab must not reuse the previous one-use ceremony.
  finished = true; activeRequest?.abort(); clearSecrets(); location.reload();
});
addEventListener("pagehide", () => { finished = true; activeRequest?.abort(); clearSecrets(); });
addEventListener("pageshow", event => {
  if (event.persisted) { finished = true; clearSecrets(); status.textContent = "Reopen a fresh invitation link to continue."; }
});
