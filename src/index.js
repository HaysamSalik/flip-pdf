import { Flipbook, autoInit, setWorkerSrcResolver, installStyles } from "./flipbook.js";
import { defaultWorkerSrc } from "./pdf-source.js";

export { Flipbook, autoInit, installStyles };
export { BookModel, spreadLabel } from "./book.js";
export { CURL_DEFAULTS, buildSheetGeometry, sheetEdge } from "./curl.js";
export const version = "0.1.0";

// The worker travels inside this file, so there is nothing to configure.
setWorkerSrcResolver(defaultWorkerSrc);
installStyles();

if (typeof window !== "undefined") {
  window.FlipPdf = Object.assign(window.FlipPdf || {}, { Flipbook, autoInit, version });

  const boot = () => autoInit();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
