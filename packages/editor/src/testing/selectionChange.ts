// Browsers queue `selectionchange` as a task, one at a time; happy-dom fires it synchronously
// from Selection methods, so an editor writing its DOM selection re-enters its own update.
const dispatchNow = document.dispatchEvent.bind(document);
// Captured before any test installs fake timers, so the event never waits on a fake clock.
const queueTask = globalThis.setTimeout;
let queued = false;

document.dispatchEvent = (event) => {
  if (event.type !== "selectionchange") return dispatchNow(event);
  if (!queued) {
    queued = true;
    queueTask(() => {
      queued = false;
      dispatchNow(event);
    });
  }
  return true;
};
