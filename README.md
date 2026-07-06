# 📄 Vision Reader

A fast, lightweight, modern PDF Reader built with **HTML5, CSS3, and Vanilla JavaScript** — powered by Mozilla's **PDF.js** (CDN). No frameworks, no bloat.

---

## ✅ Full Feature List

**Core Viewer**
- Open PDF (file picker or drag & drop), password-protected PDF support
- Continuous Scroll (default), Single Page, Two-Page View
- Zoom In/Out (small magnifying-glass buttons), Fit Width/Page/Height
- Rotate, Fullscreen, Presentation Mode, Light/Dark theme
- HiDPI-crisp rendering — text stays sharp even above 100% zoom

**Search & Text**
- Small floating search box (`Ctrl+F` to open, `Esc` to close)
- Full-document search with highlight + match counter
- Real, copyable, selectable PDF text (`Ctrl+A` to select all on current page)

**Annotations**
- Highlight any selected text via right-click menu — saved permanently per file/page (localStorage), survives reload, zoom, and rotation

**Right-Click Context Menu**
- 🔎 Search Google — opens selected text as a Google search in a new tab
- 🔎 Search Bing — same, via Bing
- 🖍️ Highlight — saves a persistent highlight over the selection
- 📋 Copy — copies selected text to clipboard
- 🔗 Share — uses the Web Share API where available

**File Management**
- Recent Files dropdown (last 8), Reopen Last PDF, Remember Last Page
- Chrome/Edge: true one-click reopen via File System Access API + IndexedDB
- Firefox/Safari: Recent Files list still works, prompts reselect (browser security limit)

**Menu & Help**
- ☰ Hamburger menu: Home (open new PDF), Print, Help
- Help modal lists every keyboard shortcut

**Print**
- Opens the original PDF in a new tab and triggers the browser print dialog

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open PDF |
| `Ctrl+F` | Search |
| `Ctrl+P` | Print |
| `Ctrl+A` | Select all text (current page) |
| `+` / `-` | Zoom in / out |
| `Ctrl+0` | Reset zoom |
| `h` | Fit Height |
| `a` | Actual Size (100%) |
| `r` / `Shift+R` | Rotate right / left |
| `←` `→` | Prev / next page |
| `Home` / `End` | First / last page |
| `Ctrl+Alt+1/2/3` | Single / Continuous / Two-Page view |
| `p` | Presentation Mode |
| `f` | Fullscreen |
| `Alt+M` | Menu |
| `Esc` | Close whatever's open (search → presentation → fullscreen) |

Also visible any time in-app via the **☰ → Help** menu.

---

## 📁 Project Structure

```
Vision Reader/
├── index.html
├── style.css
├── script.js
├── README.md
└── assets/
    └── logo.png
```

## 🚀 Getting Started

Place `logo.png` in `assets/` and `favicon.png` in the root, then either open `index.html` directly or run:

```bash
python -m http.server 8000
```

## 🧩 Browser Notes

| Feature | Chrome/Edge | Firefox/Safari |
|---|---|---|
| Everything core | ✅ | ✅ |
| Recent Files one-click reopen | ✅ | ⚠️ Reselect needed |
| Reopen Last PDF on launch | ✅ | ❌ |
| Web Share API | ✅ | ⚠️ Partial/none — falls back to copying filename |

## 🗺️ Not Yet Built

Thumbnail sidebar, bookmarks, sticky-note/freehand annotations, text-to-speech, multi-tab PDFs, document properties panel, screenshot export.

## 📜 License

Free to use, modify, and distribute.