/* ==========================================================================
   VISION READER — FINAL SCRIPT.JS
   All prior phases (password, recent files, last page, view modes,
   presentation mode) PLUS:
     - Hamburger menu (Home / Print / Help)
     - Small floating search box (Ctrl+F)
     - Right-click context menu: Search Google, Search Bing, Highlight,
       Copy, Share
     - Persistent highlight annotations (localStorage per file+page)
     - Print (opens rendered pages in a new window and calls print())
     - HiDPI-crisp canvas rendering (sharp at any zoom level)
     - Continuous Scroll is the default view
     - Full keyboard shortcut set + Help modal listing them
   ========================================================================== */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ---------------------- CONSTANTS ---------------------- */
const RECENT_FILES_KEY = "visionReaderRecentFiles";
const LAST_PAGES_KEY = "visionReaderLastPages";
const LAST_OPENED_ID_KEY = "visionReaderLastOpenedId";
const ANNOTATIONS_KEY = "visionReaderAnnotations";
const MAX_RECENT_FILES = 8;
const IDB_NAME = "VisionReaderDB";
const IDB_STORE = "fileHandles";
const IDB_VERSION = 1;
const VIEW_MODES = { SINGLE: "single", CONTINUOUS: "continuous", TWO_PAGE: "twoPage" };
const SUPPORTS_FS_ACCESS = "showOpenFilePicker" in window;
const DPR = Math.max(window.devicePixelRatio || 1, 1); // for crisp rendering

/* ---------------------- STATE ---------------------- */
const state = {
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  scale: 1.0,
  rotation: 0,
  fitMode: null,
  viewMode: VIEW_MODES.CONTINUOUS,
  presentationMode: false,
  fileName: "",
  fileId: null,
  isRendering: false,
  pendingPage: null,
  currentRenderTask: null,
  continuousObserver: null,
  searchTerm: "",
  searchMatches: [],
  currentMatchIndex: -1,
  pageTextCache: {},
  recentFiles: [],
  annotations: {},      // fileId -> [{page, xPct, yPct, wPct, hPct, text}]
  lastSelectionRange: null,
  lastSelectedText: "",
  contextMenuPageDiv: null,
  contextMenuPageNum: null,
};

/* ---------------------- DOM REFERENCES ---------------------- */
const $ = (id) => document.getElementById(id);

const dom = {
  menuToggle: $("menuToggle"),
  mainMenu: $("mainMenu"),
  menuHomeBtn: $("menuHomeBtn"),
  menuPrintBtn: $("menuPrintBtn"),
  menuHelpBtn: $("menuHelpBtn"),
  openBtn: $("openBtn"),
  fileInput: $("fileInput"),
  recentFilesToggle: $("recentFilesToggle"),
  recentFilesPanel: $("recentFilesPanel"),
  recentFilesList: $("recentFilesList"),
  recentFilesEmpty: $("recentFilesEmpty"),
  clearRecentBtn: $("clearRecentBtn"),
  prevPageBtn: $("prevPageBtn"),
  nextPageBtn: $("nextPageBtn"),
  pageNumInput: $("pageNumInput"),
  totalPages: $("totalPages"),
  zoomOutBtn: $("zoomOutBtn"),
  zoomInBtn: $("zoomInBtn"),
  zoomLevel: $("zoomLevel"),
  fitWidthBtn: $("fitWidthBtn"),
  fitPageBtn: $("fitPageBtn"),
  fitHeightBtn: $("fitHeightBtn"),
  rotateLeftBtn: $("rotateLeftBtn"),
  rotateRightBtn: $("rotateRightBtn"),
  viewModeSingleBtn: $("viewModeSingleBtn"),
  viewModeContinuousBtn: $("viewModeContinuousBtn"),
  viewModeTwoPageBtn: $("viewModeTwoPageBtn"),
  presentationModeBtn: $("presentationModeBtn"),
  searchToggleBtn: $("searchToggleBtn"),
  themeToggleBtn: $("themeToggleBtn"),
  fullscreenBtn: $("fullscreenBtn"),
  viewerContainer: $("viewerContainer"),
  dropOverlay: $("dropOverlay"),
  emptyState: $("emptyState"),
  loadingSpinner: $("loadingSpinner"),
  errorMessage: $("errorMessage"),
  errorText: $("errorText"),
  errorCloseBtn: $("errorCloseBtn"),
  canvasWrapper: $("canvasWrapper"),
  pdfCanvas: $("pdfCanvas"),
  textLayer: $("textLayer"),
  fileNameDisplay: $("fileNameDisplay"),
  statusMessage: $("statusMessage"),
  toolbar: document.querySelector(".toolbar"),
  statusBar: document.querySelector(".status-bar"),
  searchOverlay: $("searchOverlay"),
  searchInput: $("searchInput"),
  searchPrevBtn: $("searchPrevBtn"),
  searchNextBtn: $("searchNextBtn"),
  searchResultCount: $("searchResultCount"),
  searchCloseBtn: $("searchCloseBtn"),
  contextMenu: $("contextMenu"),
  helpModal: $("helpModal"),
  helpModalBody: $("helpModalBody"),
  helpCloseBtn: $("helpCloseBtn"),
};

const ctx = dom.pdfCanvas.getContext("2d");

/* ---------------------- UI HELPERS ---------------------- */
function showEmptyState() {
  dom.emptyState.classList.remove("hidden");
  dom.canvasWrapper.classList.add("hidden");
  dom.loadingSpinner.classList.add("hidden");
  dom.errorMessage.classList.add("hidden");
}
function showLoading() {
  dom.loadingSpinner.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  dom.errorMessage.classList.add("hidden");
  dom.canvasWrapper.classList.add("hidden");
}
function showViewer() {
  dom.canvasWrapper.classList.remove("hidden");
  dom.loadingSpinner.classList.add("hidden");
  dom.emptyState.classList.add("hidden");
  dom.errorMessage.classList.add("hidden");
}
function showError(message) {
  dom.errorText.textContent = message;
  dom.errorMessage.classList.remove("hidden");
  dom.loadingSpinner.classList.add("hidden");
  dom.canvasWrapper.classList.add("hidden");
  dom.emptyState.classList.add("hidden");
}
function setStatus(message, duration = 3000) {
  dom.statusMessage.textContent = message;
  if (duration > 0) {
    clearTimeout(setStatus._timer);
    setStatus._timer = setTimeout(() => { dom.statusMessage.textContent = ""; }, duration);
  }
}
function updateZoomDisplay() { dom.zoomLevel.textContent = `${Math.round(state.scale * 100)}%`; }
function updatePageDisplay() {
  dom.pageNumInput.value = state.currentPage;
  dom.totalPages.textContent = state.totalPages;
  dom.prevPageBtn.disabled = state.currentPage <= 1;
  dom.nextPageBtn.disabled = state.currentPage >= state.totalPages;
}
function updateViewModeButtons() {
  [dom.viewModeSingleBtn, dom.viewModeContinuousBtn, dom.viewModeTwoPageBtn].forEach((b) => b?.classList.remove("active-state"));
  if (state.viewMode === VIEW_MODES.SINGLE) dom.viewModeSingleBtn?.classList.add("active-state");
  else if (state.viewMode === VIEW_MODES.CONTINUOUS) dom.viewModeContinuousBtn?.classList.add("active-state");
  else if (state.viewMode === VIEW_MODES.TWO_PAGE) dom.viewModeTwoPageBtn?.classList.add("active-state");
}

/* ---------------------- HAMBURGER MENU ---------------------- */
dom.menuToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  dom.mainMenu.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!dom.mainMenu.contains(e.target) && !dom.menuToggle.contains(e.target)) {
    dom.mainMenu.classList.add("hidden");
  }
});
dom.menuHomeBtn.addEventListener("click", () => { dom.mainMenu.classList.add("hidden"); openFilePicker(); });
dom.menuPrintBtn.addEventListener("click", () => { dom.mainMenu.classList.add("hidden"); printPdf(); });
dom.menuHelpBtn.addEventListener("click", () => { dom.mainMenu.classList.add("hidden"); openHelpModal(); });

/* ---------------------- HELP MODAL ---------------------- */
const SHORTCUTS = [
  ["Open PDF", "Ctrl+O"],
  ["Search", "Ctrl+F"],
  ["Print", "Ctrl+P"],
  ["Select All Text", "Ctrl+A"],
  ["Zoom In / Out", "+ / -"],
  ["Reset Zoom", "Ctrl+0"],
  ["Fit Height", "h"],
  ["Actual Size", "a"],
  ["Rotate Right / Left", "r / Shift+R"],
  ["Next / Previous Page", "→ / ←"],
  ["First / Last Page", "Home / End"],
  ["Single / Continuous / Two-Page", "Ctrl+Alt+1 / 2 / 3"],
  ["Presentation Mode", "p"],
  ["Fullscreen", "f"],
  ["Menu", "Alt+M"],
  ["Close / Exit", "Esc"],
];
function openHelpModal() {
  dom.helpModalBody.innerHTML = SHORTCUTS
    .map(([label, key]) => `<div class="help-row"><span>${label}</span><span class="help-key">${key}</span></div>`)
    .join("");
  dom.helpModal.classList.remove("hidden");
}
function closeHelpModal() { dom.helpModal.classList.add("hidden"); }
dom.helpCloseBtn.addEventListener("click", closeHelpModal);
dom.helpModal.addEventListener("click", (e) => { if (e.target === dom.helpModal) closeHelpModal(); });

/* =====================================================================
   INDEXEDDB — FileSystemFileHandle storage for Recent Files
   ===================================================================== */
function openHandleDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveFileHandle(fileId, handle) {
  try {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(handle, fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) { console.warn("Could not save file handle:", err); }
}
async function getFileHandle(fileId) {
  try {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(fileId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) { console.warn("Could not read file handle:", err); return null; }
}
async function deleteFileHandle(fileId) {
  try {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) { console.warn("Could not delete file handle:", err); }
}

/* =====================================================================
   RECENT FILES
   ===================================================================== */
function makeFileId(name, size) { return `${name}_${size}`; }
function loadRecentFiles() {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    state.recentFiles = raw ? JSON.parse(raw) : [];
  } catch { state.recentFiles = []; }
}
function persistRecentFiles() { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(state.recentFiles)); }
function addToRecentFiles(fileId, name, size) {
  state.recentFiles = state.recentFiles.filter((f) => f.id !== fileId);
  state.recentFiles.unshift({ id: fileId, name, size, lastOpened: Date.now() });
  if (state.recentFiles.length > MAX_RECENT_FILES) {
    state.recentFiles.splice(MAX_RECENT_FILES).forEach((e) => deleteFileHandle(e.id));
  }
  persistRecentFiles();
  renderRecentFilesList();
}
function removeRecentFile(fileId) {
  state.recentFiles = state.recentFiles.filter((f) => f.id !== fileId);
  persistRecentFiles();
  deleteFileHandle(fileId);
  renderRecentFilesList();
}
function clearRecentFiles() {
  const ids = state.recentFiles.map((f) => f.id);
  state.recentFiles = [];
  persistRecentFiles();
  ids.forEach((id) => deleteFileHandle(id));
  renderRecentFilesList();
}
function formatFileSize(b) { if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b/1024).toFixed(1)} KB`; return `${(b/1048576).toFixed(1)} MB`; }
function formatRelativeTime(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
function renderRecentFilesList() {
  dom.recentFilesList.innerHTML = "";
  if (state.recentFiles.length === 0) {
    dom.recentFilesEmpty.classList.remove("hidden");
    dom.recentFilesList.classList.add("hidden");
    return;
  }
  dom.recentFilesEmpty.classList.add("hidden");
  dom.recentFilesList.classList.remove("hidden");
  state.recentFiles.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "recent-file-item";
    li.title = entry.name;
    li.innerHTML = `<span class="recent-file-icon">📄</span>
      <div class="recent-file-info">
        <span class="recent-file-name">${entry.name}</span>
        <span class="recent-file-meta">${formatFileSize(entry.size)} • ${formatRelativeTime(entry.lastOpened)}</span>
      </div>`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "recent-file-remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => { e.stopPropagation(); removeRecentFile(entry.id); });
    li.appendChild(removeBtn);
    li.addEventListener("click", () => openRecentFile(entry));
    dom.recentFilesList.appendChild(li);
  });
}
async function openRecentFile(entry) {
  closeRecentFilesPanel();
  if (SUPPORTS_FS_ACCESS) {
    const handle = await getFileHandle(entry.id);
    if (handle) {
      try {
        const perm = await handle.queryPermission({ mode: "read" });
        if (perm !== "granted" && (await handle.requestPermission({ mode: "read" })) !== "granted") throw new Error("denied");
        loadPdfFile(await handle.getFile(), handle);
        return;
      } catch { setStatus("Couldn't auto-reopen — please reselect it."); }
    }
  }
  setStatus(`Please reselect "${entry.name}" to reopen it.`);
  openFilePicker();
}
function openRecentFilesPanel() { renderRecentFilesList(); dom.recentFilesPanel.classList.remove("hidden"); dom.recentFilesToggle.classList.add("open"); }
function closeRecentFilesPanel() { dom.recentFilesPanel.classList.add("hidden"); dom.recentFilesToggle.classList.remove("open"); }
function toggleRecentFilesPanel() { dom.recentFilesPanel.classList.contains("hidden") ? openRecentFilesPanel() : closeRecentFilesPanel(); }
dom.recentFilesToggle.addEventListener("click", (e) => { e.stopPropagation(); toggleRecentFilesPanel(); });
dom.clearRecentBtn.addEventListener("click", (e) => { e.stopPropagation(); clearRecentFiles(); });
document.addEventListener("click", (e) => {
  if (!dom.recentFilesPanel.contains(e.target) && !dom.recentFilesToggle.contains(e.target)) closeRecentFilesPanel();
});

/* ---------------------- LAST PAGE MEMORY ---------------------- */
function loadLastPagesMap() { try { return JSON.parse(localStorage.getItem(LAST_PAGES_KEY) || "{}"); } catch { return {}; } }
function saveLastPage(fileId, pageNum) { const m = loadLastPagesMap(); m[fileId] = pageNum; localStorage.setItem(LAST_PAGES_KEY, JSON.stringify(m)); }
function getLastPage(fileId) { return loadLastPagesMap()[fileId] || null; }

/* =====================================================================
   ANNOTATIONS (persistent highlight, saved as % coords so they survive
   zoom/rotation/resize changes)
   ===================================================================== */
function loadAllAnnotations() { try { return JSON.parse(localStorage.getItem(ANNOTATIONS_KEY) || "{}"); } catch { return {}; } }
function saveAllAnnotations(all) { localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(all)); }
function getAnnotationsForFile(fileId) { return loadAllAnnotations()[fileId] || []; }
function addAnnotation(fileId, annotation) {
  const all = loadAllAnnotations();
  if (!all[fileId]) all[fileId] = [];
  all[fileId].push(annotation);
  saveAllAnnotations(all);
}
function renderAnnotationsForPage(pageDiv, pageNum, canvasWidth, canvasHeight) {
  if (!state.fileId) return;
  pageDiv.querySelectorAll(".annotation-highlight").forEach((el) => el.remove());
  const list = getAnnotationsForFile(state.fileId).filter((a) => a.page === pageNum);
  list.forEach((a) => {
    const mark = document.createElement("div");
    mark.className = "annotation-highlight";
    mark.style.left = `${a.xPct * canvasWidth}px`;
    mark.style.top = `${a.yPct * canvasHeight}px`;
    mark.style.width = `${a.wPct * canvasWidth}px`;
    mark.style.height = `${a.hPct * canvasHeight}px`;
    pageDiv.appendChild(mark);
  });
}
function highlightCurrentSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !state.fileId) {
    setStatus("Select some text first to highlight it.");
    return;
  }
  const range = selection.getRangeAt(0);
  const pageDiv = state.contextMenuPageDiv;
  const pageNum = state.contextMenuPageNum;
  if (!pageDiv) return;

  const pageRect = pageDiv.getBoundingClientRect();
  const canvas = pageDiv.querySelector("canvas") || dom.pdfCanvas;
  const canvasWidth = canvas.clientWidth;
  const canvasHeight = canvas.clientHeight;
  const rects = range.getClientRects();

  Array.from(rects).forEach((r) => {
    const xPct = (r.left - pageRect.left) / canvasWidth;
    const yPct = (r.top - pageRect.top) / canvasHeight;
    const wPct = r.width / canvasWidth;
    const hPct = r.height / canvasHeight;
    addAnnotation(state.fileId, { page: pageNum, xPct, yPct, wPct, hPct, text: selection.toString() });
  });

  renderAnnotationsForPage(pageDiv, pageNum, canvasWidth, canvasHeight);
  selection.removeAllRanges();
  setStatus("Highlighted ✓");
}

/* ---------------------- FILE LOADING ---------------------- */
function openFilePicker() {
  if (SUPPORTS_FS_ACCESS) {
    window.showOpenFilePicker({ types: [{ description: "PDF Files", accept: { "application/pdf": [".pdf"] } }], multiple: false })
      .then(async ([handle]) => loadPdfFile(await handle.getFile(), handle))
      .catch((err) => { if (err?.name !== "AbortError") dom.fileInput.click(); });
    return;
  }
  dom.fileInput.click();
}
dom.openBtn.addEventListener("click", openFilePicker);
dom.fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadPdfFile(file, null);
  dom.fileInput.value = "";
});

function loadPdfFile(file, handle) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showError("Invalid file type. Please select a valid PDF file.");
    return;
  }
  state.fileName = file.name;
  state.fileId = makeFileId(file.name, file.size);
  dom.fileNameDisplay.textContent = file.name;
  showLoading();

  const reader = new FileReader();
  reader.onload = (evt) => loadPdfFromData(new Uint8Array(evt.target.result), file, handle);
  reader.onerror = () => showError("Failed to read the selected file. Please try again.");
  reader.readAsArrayBuffer(file);
}

function loadPdfFromData(data, file, handle) {
  state.pdfBytes = data; // kept for Print
  const loadingTask = pdfjsLib.getDocument({ data });

  loadingTask.onPassword = (updatePassword, reason) => {
    const isRetry = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
    const pwd = window.prompt(isRetry ? "Incorrect password. Try again:" : "This PDF is password protected. Enter password:");
    if (pwd === null) { loadingTask.destroy(); showError("Password entry was cancelled."); return; }
    if (pwd === "") { loadingTask.destroy(); showError("A password is required to open this PDF."); return; }
    updatePassword(pwd);
  };

  loadingTask.promise
    .then(async (pdfDoc) => {
      state.pdfDoc = pdfDoc;
      state.totalPages = pdfDoc.numPages;
      state.currentPage = 1;
      state.scale = 1.0;
      state.rotation = 0;
      state.fitMode = null;
      state.pageTextCache = {};
      clearSearch();
      exitContinuousMode();

      state.viewMode = VIEW_MODES.CONTINUOUS;
      updateViewModeButtons();

      addToRecentFiles(state.fileId, file.name, file.size);
      if (handle) await saveFileHandle(state.fileId, handle);
      localStorage.setItem(LAST_OPENED_ID_KEY, state.fileId);

      updatePageDisplay();
      updateZoomDisplay();
      showViewer();

      const savedPage = getLastPage(state.fileId);
      state.currentPage = savedPage && savedPage >= 1 && savedPage <= state.totalPages ? savedPage : 1;

      renderContinuousMode(false);
      setStatus(`Loaded "${state.fileName}" successfully.`);
    })
    .catch((err) => {
      console.error("Error loading PDF:", err);
      if (dom.errorMessage.classList.contains("hidden")) showError("Unable to load this PDF. The file may be corrupted or invalid.");
    });
}

/* ---------------------- RENDERING (Single Page — HiDPI crisp) ---------------------- */
function clampZoom(scale) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale)); }

function renderPage(pageNum) {
  if (state.viewMode !== VIEW_MODES.SINGLE) return;
  if (!state.pdfDoc || pageNum < 1 || pageNum > state.totalPages) return;

  if (state.currentRenderTask) { state.currentRenderTask.cancel(); state.currentRenderTask = null; }
  state.isRendering = true;

  state.pdfDoc.getPage(pageNum).then((page) => {
    let viewport = page.getViewport({ scale: state.scale, rotation: state.rotation });

    if (state.fitMode === "width") {
      const cw = dom.viewerContainer.clientWidth - 48;
      const uv = page.getViewport({ scale: 1, rotation: state.rotation });
      state.scale = clampZoom(cw / uv.width);
      viewport = page.getViewport({ scale: state.scale, rotation: state.rotation });
      updateZoomDisplay();
    } else if (state.fitMode === "page") {
      const cw = dom.viewerContainer.clientWidth - 48, chh = dom.viewerContainer.clientHeight - 48;
      const uv = page.getViewport({ scale: 1, rotation: state.rotation });
      state.scale = clampZoom(Math.min(cw / uv.width, chh / uv.height));
      viewport = page.getViewport({ scale: state.scale, rotation: state.rotation });
      updateZoomDisplay();
    } else if (state.fitMode === "height") {
      const chh = dom.viewerContainer.clientHeight - 48;
      const uv = page.getViewport({ scale: 1, rotation: state.rotation });
      state.scale = clampZoom(chh / uv.height);
      viewport = page.getViewport({ scale: state.scale, rotation: state.rotation });
      updateZoomDisplay();
    }

    // HiDPI: render at device pixel ratio for crisp text/lines at any zoom
    dom.pdfCanvas.width = Math.floor(viewport.width * DPR);
    dom.pdfCanvas.height = Math.floor(viewport.height * DPR);
    dom.pdfCanvas.style.width = `${viewport.width}px`;
    dom.pdfCanvas.style.height = `${viewport.height}px`;
    dom.canvasWrapper.style.width = `${viewport.width}px`;
    dom.canvasWrapper.style.height = `${viewport.height}px`;
    dom.textLayer.style.width = `${viewport.width}px`;
    dom.textLayer.style.height = `${viewport.height}px`;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const renderTask = page.render({ canvasContext: ctx, viewport });
    state.currentRenderTask = renderTask;

    return renderTask.promise.then(() => {
      state.currentRenderTask = null;
      state.currentPage = pageNum;
      updatePageDisplay();
      if (state.fileId) saveLastPage(state.fileId, pageNum);
      return renderTextLayer(page, viewport);
    });
  })
  .then(() => {
    state.isRendering = false;
    if (state.pendingPage !== null) { const n = state.pendingPage; state.pendingPage = null; renderPage(n); }
    else if (state.searchTerm) highlightMatchesOnCurrentPage();
  })
  .catch((err) => {
    state.isRendering = false;
    if (err?.name === "RenderingCancelledException") return;
    console.error("Error rendering page:", err);
    showError("An error occurred while rendering this page.");
  });
}

function renderTextLayer(page, viewport) {
  return page.getTextContent().then((textContent) => {
    state.pageTextCache[state.currentPage] = textContent;
    dom.textLayer.innerHTML = "";
    dom.textLayer.style.setProperty("--scale-factor", state.scale);
    textContent.items.forEach((item) => {
      const span = document.createElement("span");
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      span.textContent = item.str;
      span.style.left = `${tx[4]}px`;
      span.style.top = `${tx[5] - fh}px`;
      span.style.fontSize = `${fh}px`;
      span.style.fontFamily = "sans-serif";
      dom.textLayer.appendChild(span);
    });
    renderAnnotationsForPage(dom.canvasWrapper, state.currentPage, viewport.width, viewport.height);
  });
}

/* =====================================================================
   CONTINUOUS SCROLL / TWO-PAGE — default view, HiDPI crisp, selectable
   text, persistent highlight annotations, lazy render via IntersectionObserver
   ===================================================================== */
function ensureContinuousContainer() {
  let el = document.getElementById("continuousContainer");
  if (!el) {
    el = document.createElement("div");
    el.id = "continuousContainer";
    el.className = "continuous-container hidden";
    dom.viewerContainer.appendChild(el);
  }
  return el;
}
function exitContinuousMode() {
  const c = document.getElementById("continuousContainer");
  if (c) {
    if (state.continuousObserver) { state.continuousObserver.disconnect(); state.continuousObserver = null; }
    c.classList.add("hidden");
    c.innerHTML = "";
  }
  dom.canvasWrapper.classList.remove("hidden");
}
function setViewMode(mode) {
  if (!state.pdfDoc) { state.viewMode = mode; updateViewModeButtons(); return; }
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  updateViewModeButtons();
  if (mode === VIEW_MODES.SINGLE) { exitContinuousMode(); renderPage(state.currentPage); }
  else renderContinuousMode(mode === VIEW_MODES.TWO_PAGE);
}
function renderContinuousMode(twoPage) {
  if (!state.pdfDoc) return;
  dom.canvasWrapper.classList.add("hidden");
  const container = ensureContinuousContainer();
  container.classList.remove("hidden");
  container.innerHTML = "";
  container.classList.toggle("two-page-layout", twoPage);

  const pageEntries = [];
  for (let p = 1; p <= state.totalPages; p++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "continuous-page";
    pageDiv.dataset.pageNumber = String(p);
    const canvas = document.createElement("canvas");
    canvas.className = "continuous-canvas";
    pageDiv.appendChild(canvas);
    container.appendChild(pageDiv);
    pageEntries.push(pageDiv);
  }

  if (state.continuousObserver) state.continuousObserver.disconnect();
  state.continuousObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const pageDiv = entry.target;
      const pageNum = parseInt(pageDiv.dataset.pageNumber, 10);
      if (entry.isIntersecting) {
        if (!pageDiv.dataset.rendered) { renderContinuousPage(pageDiv, pageNum); pageDiv.dataset.rendered = "true"; }
        if (entry.intersectionRatio > 0.5) {
          state.currentPage = pageNum;
          updatePageDisplay();
          if (state.fileId) saveLastPage(state.fileId, pageNum);
        }
      }
    });
  }, { root: dom.viewerContainer, rootMargin: "300px 0px", threshold: [0.1, 0.5] });

  pageEntries.forEach((el) => state.continuousObserver.observe(el));
  const target = pageEntries[state.currentPage - 1];
  if (target) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
}

async function renderContinuousPage(pageDiv, pageNum) {
  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const unscaled = page.getViewport({ scale: 1, rotation: state.rotation });
    const containerWidth = dom.viewerContainer.clientWidth - 64;
    const targetWidth = state.viewMode === VIEW_MODES.TWO_PAGE ? containerWidth / 2 - 20 : containerWidth;
    const scale = clampZoom(targetWidth / unscaled.width);
    const viewport = page.getViewport({ scale, rotation: state.rotation });

    const canvas = pageDiv.querySelector("canvas");
    canvas.width = Math.floor(viewport.width * DPR);
    canvas.height = Math.floor(viewport.height * DPR);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const pageCtx = canvas.getContext("2d");
    pageCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    await page.render({ canvasContext: pageCtx, viewport }).promise;

    const textContent = await page.getTextContent();
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "text-layer";
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;
    textContent.items.forEach((item) => {
      const span = document.createElement("span");
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      span.textContent = item.str;
      span.style.left = `${tx[4]}px`;
      span.style.top = `${tx[5] - fh}px`;
      span.style.fontSize = `${fh}px`;
      span.style.fontFamily = "sans-serif";
      textLayerDiv.appendChild(span);
    });
    pageDiv.appendChild(textLayerDiv);

    renderAnnotationsForPage(pageDiv, pageNum, viewport.width, viewport.height);
  } catch (err) { console.error(`Error rendering continuous page ${pageNum}:`, err); }
}

/* ---------------------- PAGE NAVIGATION ---------------------- */
function goToPage(pageNum) {
  const target = Math.max(1, Math.min(state.totalPages, pageNum));
  if (state.viewMode !== VIEW_MODES.SINGLE) {
    const container = document.getElementById("continuousContainer");
    const pageDiv = container?.querySelector(`[data-page-number="${target}"]`);
    if (pageDiv) pageDiv.scrollIntoView({ block: "start", behavior: "smooth" });
    state.currentPage = target;
    updatePageDisplay();
    return;
  }
  if (target !== state.currentPage || !state.pdfDoc) renderPage(target);
}
dom.prevPageBtn.addEventListener("click", () => goToPage(state.currentPage - 1));
dom.nextPageBtn.addEventListener("click", () => goToPage(state.currentPage + 1));
dom.pageNumInput.addEventListener("change", () => {
  const val = parseInt(dom.pageNumInput.value, 10);
  if (!isNaN(val)) goToPage(val); else dom.pageNumInput.value = state.currentPage;
});
dom.pageNumInput.addEventListener("keydown", (e) => { if (e.key === "Enter") dom.pageNumInput.blur(); });

/* ---------------------- ZOOM ---------------------- */
const ZOOM_STEP = 0.15, MIN_ZOOM = 0.25, MAX_ZOOM = 5.0;
function setZoom(newScale) {
  state.fitMode = null;
  state.scale = clampZoom(newScale);
  updateZoomDisplay();
  if (state.viewMode === VIEW_MODES.SINGLE) renderPage(state.currentPage);
  else renderContinuousMode(state.viewMode === VIEW_MODES.TWO_PAGE);
}
function actualSize() { setZoom(1.0); }
dom.zoomInBtn.addEventListener("click", () => setZoom(state.scale + ZOOM_STEP));
dom.zoomOutBtn.addEventListener("click", () => setZoom(state.scale - ZOOM_STEP));
dom.fitWidthBtn.addEventListener("click", () => { state.fitMode = "width"; renderPage(state.currentPage); });
dom.fitPageBtn.addEventListener("click", () => { state.fitMode = "page"; renderPage(state.currentPage); });
dom.fitHeightBtn?.addEventListener("click", () => { state.fitMode = "height"; renderPage(state.currentPage); });
dom.viewModeSingleBtn?.addEventListener("click", () => setViewMode(VIEW_MODES.SINGLE));
dom.viewModeContinuousBtn?.addEventListener("click", () => setViewMode(VIEW_MODES.CONTINUOUS));
dom.viewModeTwoPageBtn?.addEventListener("click", () => setViewMode(VIEW_MODES.TWO_PAGE));
dom.presentationModeBtn?.addEventListener("click", () => togglePresentationMode());

/* ---------------------- ROTATE ---------------------- */
function rotate(deltaDeg) {
  state.rotation = (state.rotation + deltaDeg + 360) % 360;
  if (state.viewMode === VIEW_MODES.SINGLE) renderPage(state.currentPage);
  else renderContinuousMode(state.viewMode === VIEW_MODES.TWO_PAGE);
}
dom.rotateLeftBtn.addEventListener("click", () => rotate(-90));
dom.rotateRightBtn.addEventListener("click", () => rotate(90));

/* ---------------------- PRESENTATION MODE ---------------------- */
function togglePresentationMode() {
  if (!state.pdfDoc && !state.presentationMode) { setStatus("Open a PDF first."); return; }
  state.presentationMode = !state.presentationMode;
  if (state.presentationMode) {
    dom.toolbar.style.display = "none";
    dom.statusBar.style.display = "none";
    closeSearchOverlay();
    setViewMode(VIEW_MODES.SINGLE);
    state.fitMode = "page";
    renderPage(state.currentPage);
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    dom.toolbar.style.display = "";
    dom.statusBar.style.display = "";
    if (document.fullscreenElement) document.exitFullscreen();
  }
}

/* ---------------------- FLOATING SEARCH BOX ---------------------- */
function openSearchOverlay() { dom.searchOverlay.classList.add("active"); dom.searchInput.focus(); dom.searchInput.select(); }
function closeSearchOverlay() { dom.searchOverlay.classList.remove("active"); clearSearch(); }
function isSearchOverlayOpen() { return dom.searchOverlay.classList.contains("active"); }
dom.searchToggleBtn.addEventListener("click", openSearchOverlay);
dom.searchCloseBtn.addEventListener("click", closeSearchOverlay);

function clearSearch() {
  state.searchTerm = ""; state.searchMatches = []; state.currentMatchIndex = -1;
  dom.searchResultCount.textContent = ""; dom.searchInput.value = "";
  document.querySelectorAll(".text-layer .highlight").forEach((el) => el.classList.remove("highlight", "active-match"));
}
async function performSearch(term) {
  state.searchTerm = term.trim(); state.searchMatches = []; state.currentMatchIndex = -1;
  if (!state.searchTerm || !state.pdfDoc) { dom.searchResultCount.textContent = ""; return; }
  const lowerTerm = state.searchTerm.toLowerCase();
  for (let p = 1; p <= state.totalPages; p++) {
    let tc = state.pageTextCache[p];
    if (!tc) { const page = await state.pdfDoc.getPage(p); tc = await page.getTextContent(); state.pageTextCache[p] = tc; }
    tc.items.forEach((item, idx) => {
      const str = item.str.toLowerCase(); let i = str.indexOf(lowerTerm);
      while (i !== -1) { state.searchMatches.push({ page: p, itemIndex: idx }); i = str.indexOf(lowerTerm, i + 1); }
    });
  }
  if (state.searchMatches.length === 0) { dom.searchResultCount.textContent = "0/0"; setStatus(`No results for "${state.searchTerm}"`); return; }
  state.currentMatchIndex = 0;
  updateSearchCount();
  goToPage(state.searchMatches[0].page);
}
function updateSearchCount() {
  dom.searchResultCount.textContent = state.searchMatches.length === 0 ? "0/0" : `${state.currentMatchIndex + 1}/${state.searchMatches.length}`;
}
function highlightMatchesOnCurrentPage() {
  if (!state.searchTerm) return;
  let spans;
  if (state.viewMode === VIEW_MODES.SINGLE) spans = dom.textLayer.querySelectorAll("span");
  else {
    const container = document.getElementById("continuousContainer");
    const pageDiv = container?.querySelector(`[data-page-number="${state.currentPage}"]`);
    spans = pageDiv ? pageDiv.querySelectorAll(".text-layer span") : [];
  }
  const lowerTerm = state.searchTerm.toLowerCase();
  spans.forEach((span) => {
    span.classList.remove("highlight", "active-match");
    if (span.textContent.toLowerCase().includes(lowerTerm)) span.classList.add("highlight");
  });
  const activeMatch = state.searchMatches[state.currentMatchIndex];
  if (activeMatch && activeMatch.page === state.currentPage) {
    const activeSpan = spans[activeMatch.itemIndex];
    if (activeSpan) { activeSpan.classList.add("active-match"); activeSpan.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
}
function goToMatch(index) {
  if (state.searchMatches.length === 0) return;
  const total = state.searchMatches.length;
  state.currentMatchIndex = ((index % total) + total) % total;
  updateSearchCount();
  const match = state.searchMatches[state.currentMatchIndex];
  goToPage(match.page);
  if (match.page === state.currentPage) highlightMatchesOnCurrentPage();
}
let searchDebounceTimer = null;
dom.searchInput.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  const value = e.target.value;
  searchDebounceTimer = setTimeout(() => performSearch(value), 300);
});
dom.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.shiftKey ? goToMatch(state.currentMatchIndex - 1) : goToMatch(state.currentMatchIndex + 1); }
  else if (e.key === "Escape") closeSearchOverlay();
});
dom.searchNextBtn.addEventListener("click", () => goToMatch(state.currentMatchIndex + 1));
dom.searchPrevBtn.addEventListener("click", () => goToMatch(state.currentMatchIndex - 1));

/* =====================================================================
   RIGHT-CLICK CONTEXT MENU — Search Google/Bing, Highlight, Copy, Share
   ===================================================================== */
function showContextMenu(x, y, pageDiv, pageNum) {
  state.contextMenuPageDiv = pageDiv;
  state.contextMenuPageNum = pageNum;
  const menu = dom.contextMenu;
  menu.classList.remove("hidden");
  const maxX = window.innerWidth - menu.offsetWidth - 10;
  const maxY = window.innerHeight - menu.offsetHeight - 10;
  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;
}
function hideContextMenu() { dom.contextMenu.classList.add("hidden"); }

document.addEventListener("contextmenu", (e) => {
  const pageDiv = e.target.closest(".continuous-page") || (dom.canvasWrapper.contains(e.target) ? dom.canvasWrapper : null);
  if (!pageDiv || !state.pdfDoc) return;
  e.preventDefault();
  const pageNum = pageDiv.dataset?.pageNumber ? parseInt(pageDiv.dataset.pageNumber, 10) : state.currentPage;
  const selection = window.getSelection();
  state.lastSelectedText = selection ? selection.toString() : "";
  showContextMenu(e.clientX, e.clientY, pageDiv, pageNum);
});
document.addEventListener("click", (e) => { if (!dom.contextMenu.contains(e.target)) hideContextMenu(); });

dom.contextMenu.addEventListener("click", async (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  hideContextMenu();

  const text = state.lastSelectedText.trim();

  switch (action) {
    case "google":
      if (!text) { setStatus("Select some text first."); return; }
      window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, "_blank");
      break;
    case "bing":
      if (!text) { setStatus("Select some text first."); return; }
      window.open(`https://www.bing.com/search?q=${encodeURIComponent(text)}`, "_blank");
      break;
    case "highlight":
      highlightCurrentSelection();
      break;
    case "copy":
      if (!text) { setStatus("Select some text first."); return; }
      try { await navigator.clipboard.writeText(text); setStatus("Copied ✓"); }
      catch { setStatus("Copy failed — try Ctrl+C instead."); }
      break;
    case "share":
      await sharePdf();
      break;
  }
});

/* ---------------------- SHARE ---------------------- */
async function sharePdf() {
  if (!state.fileName) { setStatus("Open a PDF first."); return; }
  if (navigator.share) {
    try {
      await navigator.share({ title: state.fileName, text: `Check out "${state.fileName}"` });
      setStatus("Shared ✓");
    } catch { /* user cancelled — no-op */ }
  } else {
    try {
      await navigator.clipboard.writeText(state.fileName);
      setStatus("Share not supported here — filename copied instead.");
    } catch { setStatus("Sharing isn't supported in this browser."); }
  }
}

/* ---------------------- PRINT ---------------------- */
function printPdf() {
  if (!state.pdfBytes) { setStatus("Open a PDF first."); return; }
  const blob = new Blob([state.pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, "_blank");
  if (!printWindow) { setStatus("Please allow popups to print."); return; }
  printWindow.addEventListener("load", () => {
    setTimeout(() => { printWindow.print(); }, 300);
  });
}

/* ---------------------- SELECT ALL TEXT ---------------------- */
function selectAllVisibleText() {
  const layer =
    state.viewMode === VIEW_MODES.SINGLE
      ? dom.textLayer
      : document.getElementById("continuousContainer")?.querySelector(`[data-page-number="${state.currentPage}"] .text-layer`);
  if (!layer) return;
  const range = document.createRange();
  range.selectNodeContents(layer);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ---------------------- THEME ---------------------- */
function initTheme() { applyTheme(localStorage.getItem("pdfReaderTheme") || "light"); }
function applyTheme(theme) {
  if (theme === "dark") { document.documentElement.setAttribute("data-theme", "dark"); dom.themeToggleBtn.textContent = "☀️"; }
  else { document.documentElement.removeAttribute("data-theme"); dom.themeToggleBtn.textContent = "🌙"; }
  localStorage.setItem("pdfReaderTheme", theme);
}
dom.themeToggleBtn.addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});

/* ---------------------- FULLSCREEN ---------------------- */
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => setStatus("Fullscreen blocked."));
  else document.exitFullscreen();
}
dom.fullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  dom.fullscreenBtn.textContent = document.fullscreenElement ? "🗗" : "⛶";
  if (!document.fullscreenElement && state.presentationMode) {
    state.presentationMode = false;
    dom.toolbar.style.display = "";
    dom.statusBar.style.display = "";
  }
});

/* ---------------------- DRAG & DROP ---------------------- */
let dragCounter = 0;
window.addEventListener("dragenter", (e) => { e.preventDefault(); dragCounter++; dom.dropOverlay.classList.add("active"); });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dom.dropOverlay.classList.remove("active"); } });
window.addEventListener("drop", (e) => {
  e.preventDefault(); dragCounter = 0; dom.dropOverlay.classList.remove("active");
  if (e.dataTransfer.files?.length > 0) loadPdfFile(e.dataTransfer.files[0], null);
});

/* ---------------------- ERROR CLOSE ---------------------- */
dom.errorCloseBtn.addEventListener("click", () => { dom.errorMessage.classList.add("hidden"); state.pdfDoc ? showViewer() : showEmptyState(); });

/* ---------------------- KEYBOARD SHORTCUTS ---------------------- */
document.addEventListener("keydown", (e) => {
  const isTyping = document.activeElement.tagName === "INPUT";

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openSearchOverlay(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); printPdf(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !isTyping) { e.preventDefault(); selectAllVisibleText(); return; }
  if (e.altKey && e.key.toLowerCase() === "m") { e.preventDefault(); dom.mainMenu.classList.toggle("hidden"); return; }

  if ((e.ctrlKey || e.metaKey) && e.altKey) {
    if (e.key === "1") { e.preventDefault(); setViewMode(VIEW_MODES.SINGLE); return; }
    if (e.key === "2") { e.preventDefault(); setViewMode(VIEW_MODES.CONTINUOUS); return; }
    if (e.key === "3") { e.preventDefault(); setViewMode(VIEW_MODES.TWO_PAGE); return; }
  }

  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case "o": e.preventDefault(); openFilePicker(); break;
      case "=": case "+": e.preventDefault(); setZoom(state.scale + ZOOM_STEP); break;
      case "-": e.preventDefault(); setZoom(state.scale - ZOOM_STEP); break;
      case "0": e.preventDefault(); setZoom(1.0); break;
    }
    return;
  }

  if (isTyping) return;

  switch (e.key) {
    case "ArrowLeft": case "PageUp": goToPage(state.currentPage - 1); break;
    case "ArrowRight": case "PageDown": goToPage(state.currentPage + 1); break;
    case "Home": goToPage(1); break;
    case "End": goToPage(state.totalPages); break;
    case "+": setZoom(state.scale + ZOOM_STEP); break;
    case "-": setZoom(state.scale - ZOOM_STEP); break;
    case "r": rotate(90); break;
    case "R": rotate(-90); break;
    case "h": state.fitMode = "height"; renderPage(state.currentPage); break;
    case "a": actualSize(); break;
    case "f": case "F": toggleFullscreen(); break;
    case "p": togglePresentationMode(); break;
    case "Escape":
      if (!dom.helpModal.classList.contains("hidden")) closeHelpModal();
      else if (isSearchOverlayOpen()) closeSearchOverlay();
      else if (state.presentationMode) togglePresentationMode();
      else if (document.fullscreenElement) document.exitFullscreen();
      break;
  }
});

/* ---------------------- WINDOW RESIZE ---------------------- */
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.pdfDoc) return;
    if (state.viewMode === VIEW_MODES.SINGLE) {
      if (["width", "page", "height"].includes(state.fitMode)) renderPage(state.currentPage);
    } else renderContinuousMode(state.viewMode === VIEW_MODES.TWO_PAGE);
  }, 200);
});

/* ---------------------- REOPEN LAST PDF ---------------------- */
async function tryReopenLastPdf() {
  if (!SUPPORTS_FS_ACCESS) return;
  const lastId = localStorage.getItem(LAST_OPENED_ID_KEY);
  if (!lastId) return;
  const handle = await getFileHandle(lastId);
  if (!handle) return;
  try {
    const perm = await handle.queryPermission({ mode: "read" });
    if (perm !== "granted") return;
    loadPdfFile(await handle.getFile(), handle);
  } catch (err) { console.warn("Could not auto-reopen last PDF:", err); }
}

/* ---------------------- INIT ---------------------- */
function init() {
  initTheme();
  showEmptyState();
  updateZoomDisplay();
  updateViewModeButtons();
  loadRecentFiles();
  renderRecentFilesList();
  tryReopenLastPdf();
}
init();