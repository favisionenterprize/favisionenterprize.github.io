// Runs on the FA Vision admin: tells the page the add-on is installed and how it
// updates, and passes jobs from the autopilot screen (Facebook and Instagram) to the add-on.
const mark = () => {
  document.documentElement.dataset.favsyncExt = "1";
  document.documentElement.dataset.favautoExt = "5";   // 4 = Instagram, 5 = updates itself from the website
};
if (document.documentElement) mark(); else document.addEventListener("readystatechange", mark, { once: true });

// Each time the admin opens, the add-on fetches the latest scripts from the website.
function hello(force) {
  try {
    chrome.runtime.sendMessage({ type: "hello", force: !!force }, st => {
      if (!st) return;
      const d = document.documentElement.dataset;
      d.favautoMode = st.mode;                // "live" = updates itself, "bundled" = using the copy in the folder
      d.favautoUs = st.userScripts ? "1" : "";
      d.favautoVersion = st.version || "";
      d.favautoShell = st.shell || "";        // add-on version itself (5.1+ may open YouTube)
      d.favautoError = st.error || "";
      window.postMessage({ type: "favauto-status", status: st }, location.origin);
    });
  } catch (e) { /* add-on was reloaded: the page needs a refresh */ }
}
hello(false);

window.addEventListener("message", e => {
  if (e.source !== window || e.origin !== location.origin || !e.data) return;
  if (e.data.type === "favauto-recheck") return hello(true);
  if (e.data.type !== "favauto-start") return;
  chrome.runtime.sendMessage({ type: "start", url: e.data.url, job: e.data.job }, r => {
    if (!r || !r.ok) window.postMessage({ type: "favauto-start-failed" }, location.origin);
  });
});
