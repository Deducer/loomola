// extension/options.js
import {
  DEFAULT_APP_ORIGIN,
  getAppOrigin,
  hasStoredAppOrigin,
  setAppOrigin,
  clearAppOrigin,
} from "./lib/app-origin.js";

const input = document.getElementById("origin");
const statusEl = document.getElementById("status");

function showStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.className = ok ? "ok" : "error";
}

async function load() {
  if (await hasStoredAppOrigin()) {
    input.value = await getAppOrigin();
  }
  input.placeholder = DEFAULT_APP_ORIGIN;
}

document.getElementById("save").addEventListener("click", async () => {
  const raw = input.value.trim();
  try {
    if (!raw) {
      await clearAppOrigin();
      showStatus(`Using the default: ${DEFAULT_APP_ORIGIN}`, true);
      return;
    }
    const saved = await setAppOrigin(raw);
    input.value = saved;
    // The background worker re-registers the app bridge via its
    // storage.onChanged listener; already-open app tabs need a reload.
    showStatus(`Saved: ${saved} — reload your Loomola tab.`, true);
  } catch (err) {
    showStatus(err?.message ?? "Invalid URL.", false);
  }
});

document.getElementById("reset").addEventListener("click", async () => {
  await clearAppOrigin();
  input.value = "";
  showStatus(`Using the default: ${DEFAULT_APP_ORIGIN}`, true);
});

void load();
