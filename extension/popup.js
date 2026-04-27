(async function () {
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "loom-clone:get-state",
    });
    if (response?.state) {
      statusEl.classList.remove("status-idle");
      statusEl.classList.add("status-active");
      statusEl.querySelector(".dot").classList.remove("dot-grey");
      statusEl.querySelector(".dot").classList.add("dot-red");
      statusText.textContent = "Recording in progress";
    }
  } catch {
    /* idle is the default */
  }
})();
