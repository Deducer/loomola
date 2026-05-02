(async function () {
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const meetingStatusEl = document.getElementById("meeting-status");
  const meetingStatusText = document.getElementById("meeting-status-text");
  const meetingDetail = document.getElementById("meeting-detail");

  function setDot(el, className) {
    const dot = el.querySelector(".dot");
    dot.classList.remove("dot-grey", "dot-red", "dot-green");
    dot.classList.add(className);
  }

  function sourceLabel(source) {
    if (source === "meet") return "Google Meet";
    if (source === "teams") return "Microsoft Teams";
    if (source === "zoom") return "Zoom";
    return "Meeting";
  }

  try {
    const [stateResponse, meetingResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: "loom-clone:get-state" }),
      chrome.runtime.sendMessage({ type: "loom-clone:get-meeting-signal" }),
    ]);

    if (stateResponse?.state) {
      statusEl.classList.remove("status-idle");
      statusEl.classList.add("status-active");
      setDot(statusEl, "dot-red");
      statusText.textContent = "Recording in progress";
    }

    const meeting = meetingResponse?.meeting;
    if (meeting?.receivedAt && Date.now() - meeting.receivedAt < 120_000) {
      meetingStatusEl.classList.remove("status-idle");
      meetingStatusEl.classList.add("status-meeting");
      setDot(meetingStatusEl, "dot-green");
      meetingStatusText.textContent = `${sourceLabel(meeting.source)} active`;
      meetingDetail.textContent = meeting.title ?? meeting.tabUrl ?? "";
    } else if (meeting?.receivedAt) {
      meetingDetail.textContent = `Last saw ${sourceLabel(meeting.source)} recently.`;
    }
  } catch {
    /* idle is the default */
  }
})();
