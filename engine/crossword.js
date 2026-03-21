/* ===============================
  Inbox Puzzles – Crossword Engine
  Hardened: supports v0 + v1 JSON
  iOS-stable tap-to-toggle Across/Down (PuzzleMe-style)
  =============================== */

const LS_KEY = (() => {
 const parts = location.pathname.split("/").filter(Boolean);
 const day = parts.find(p => /^day\d+$/i.test(p) || /^trial/i.test(p));
 return "cw_" + (day ? day.toLowerCase() : "default");
})();

let puzzleData = null;
let cellMap = [];
let acrossMap = {}, downMap = {};
let activeDirection = null;
let activeClueNum = null;
let activeCells = [];
let activeIndex = 0;

// last tapped cell (for toggle)
let lastTapCell = { r: null, c: null };
let lastTapTime = 0;

// prevents focus->onCellTap recursion on iOS/desktop
let suppressFocusHandler = false;

// Fix iPhone Safari back-button restore issue
window.addEventListener("pageshow", function (event) {
 if (event.persisted) {
   window.location.reload();
 }
});


function showFatal(msg, err) {
 const area = document.getElementById("puzzleArea");
 if (area) {
   area.innerHTML =
     `<div style="text-align:center;color:#b00000;font-weight:700;margin:24px 0;">${msg}</div>`;
 }
 console.error(msg, err || "");
}

/** Normalize either:
*  v1: { meta, size, grid("."/"#"), numbers, clues:{across,down}, solution }
*  v0: { title, subtitle, rows, cols, grid("" or "#"), numbers, across, down, solution }
*/
function normalizePuzzle(raw) {
 const p = JSON.parse(JSON.stringify(raw));

 if (!p.meta) p.meta = { title: p.title, subtitle: p.subtitle };
 if (!p.size) p.size = { rows: p.rows, cols: p.cols };
 if (!p.clues) p.clues = { across: p.across, down: p.down };

 if (!p.size?.rows || !p.size?.cols) throw new Error("Missing size.rows/size.cols");
 if (!Array.isArray(p.grid)) throw new Error("Missing grid");

 // normalize grid cells: "" -> ".", null -> "."
 for (let r = 0; r < p.size.rows; r++) {
   for (let c = 0; c < p.size.cols; c++) {
     const v = p.grid[r]?.[c];
     if (v === "" || v == null) p.grid[r][c] = ".";
   }
 }

 if (!Array.isArray(p.numbers)) throw new Error("Missing numbers matrix");
 if (!p.clues?.across || !p.clues?.down) throw new Error("Missing clues.across/clues.down");

 return p;
}

/* ---------- INIT ---------- */

fetch("puzzle.json", { cache: "no-store" })
 .then(r => {
   if (!r.ok) throw new Error("HTTP " + r.status);
   return r.json();
 })
 .then(raw => {
   puzzleData = normalizePuzzle(raw);

   const titleText = (puzzleData.meta?.title || "Daily Crossword").toUpperCase();
   document.title = titleText;

   const titleEl = document.getElementById("titleEl");
   const subtitleEl = document.getElementById("subtitleEl");
   if (titleEl) titleEl.textContent = titleText;
   if (subtitleEl) subtitleEl.textContent = puzzleData.meta?.subtitle || "";

   buildPuzzle(puzzleData);
 })
 .catch(err => showFatal("Crossword Unavailable (puzzle.json load/parse failed).", err));

/* ---------- BUILD ---------- */

function buildPuzzle(puz) {
 try {
   cellMap = [];
   acrossMap = {};
   downMap = {};
   activeDirection = null;
   activeClueNum = null;
   activeCells = [];
   activeIndex = 0;
   lastTapCell = { r: null, c: null };

   const wrap = document.createElement("div");
   wrap.className = "grid-wrapper";

   const tbl = document.createElement("table");
   tbl.className = "crossword";

   const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");

   for (let r = 0; r < puz.size.rows; r++) {
     cellMap[r] = [];
     const tr = document.createElement("tr");

     for (let c = 0; c < puz.size.cols; c++) {
       const td = document.createElement("td");
       const obj = { td, input: null, acrossNum: null, downNum: null };
       cellMap[r][c] = obj;

       if (puz.grid[r][c] === "#") {
         td.classList.add("block");
       } else {
         const inp = document.createElement("input");
         inp.maxLength = 1;

         // iOS/Safari hardening
         inp.autocomplete = "off";
         inp.autocapitalize = "characters";
         inp.spellcheck = false;

         inp.dataset.row = r;
         inp.dataset.col = c;

         const k = r + "-" + c;
         if (saved[k]) inp.value = saved[k];

         inp.addEventListener("input", handleInput);
         inp.addEventListener("keydown", handleKeyNav);

         // Focus handler: keyboard/tab focus only (desktop/accessibility)
         inp.addEventListener("focus", () => {
           if (suppressFocusHandler) return;
           onCellFocus(r, c);
         });

         td.appendChild(inp);
         obj.input = inp;
       }

       const n = puz.numbers?.[r]?.[c] || 0;
       if (n > 0) {
         const d = document.createElement("div");
         d.className = "num";
         d.textContent = n;
         td.appendChild(d);
       }

       // iOS-stable tap handler
       td.addEventListener("click", () => {
 onCellTap(r, c);
});


       tr.appendChild(td);
     }

     tbl.appendChild(tr);
   }

   wrap.appendChild(tbl);
   const area = document.getElementById("puzzleArea");
   area.innerHTML = "";
   area.appendChild(wrap);

   computeWordMaps(puz);
   buildClues(puz);
 } catch (err) {
   showFatal("Crossword failed while building grid/clues.", err);
 }
}

/* ---------- WORD MAPS ---------- */

function computeWordMaps(puz) {
 const { rows, cols } = puz.size;
 const grid = puz.grid;
 const nums = puz.numbers;

 for (let r = 0; r < rows; r++) {
   for (let c = 0; c < cols; c++) {
     if (grid[r][c] === "#") continue;

     const startsAcross =
       (c === 0 || grid[r][c - 1] === "#") && (c + 1 < cols && grid[r][c + 1] !== "#");
     if (startsAcross) {
       const n = nums[r][c];
       if (n > 0) {
         let cc = c;
         while (cc < cols && grid[r][cc] !== "#") {
           cellMap[r][cc].acrossNum = n;
           cc++;
         }
       }
     }

     const startsDown =
       (r === 0 || grid[r - 1][c] === "#") && (r + 1 < rows && grid[r + 1][c] !== "#");
     if (startsDown) {
       const n = nums[r][c];
       if (n > 0) {
         let rr = r;
         while (rr < rows && grid[rr][c] !== "#") {
           cellMap[rr][c].downNum = n;
           rr++;
         }
       }
     }
   }
 }

 for (let r = 0; r < rows; r++) {
   for (let c = 0; c < cols; c++) {
     const obj = cellMap[r][c];
     if (obj.acrossNum != null) (acrossMap[obj.acrossNum] ??= []).push({ r, c, ...obj });
     if (obj.downNum != null) (downMap[obj.downNum] ??= []).push({ r, c, ...obj });
   }
 }
}

/* ---------- CLUES ---------- */

function buildClues(p) {
 const acrossDiv = document.getElementById("across");
 const downDiv = document.getElementById("down");
 acrossDiv.innerHTML = "";
 downDiv.innerHTML = "";

 Object.keys(p.clues.across).map(Number).sort((a, b) => a - b).forEach(n => {
   const d = document.createElement("div");
   d.className = "clue-item";
   d.dataset.dir = "across";
   d.dataset.num = n;
   d.textContent = `${n}. ${p.clues.across[String(n)]}`;
   d.onclick = () => activateWord("across", n, true);
   acrossDiv.appendChild(d);
 });

 Object.keys(p.clues.down).map(Number).sort((a, b) => a - b).forEach(n => {
   const d = document.createElement("div");
   d.className = "clue-item";
   d.dataset.dir = "down";
   d.dataset.num = n;
   d.textContent = `${n}. ${p.clues.down[String(n)]}`;
   d.onclick = () => activateWord("down", n, true);
   downDiv.appendChild(d);
 });
}

/* ---------- NAVIGATION ---------- */

function activateWord(dir, num, focus) {
 clearHighlights();

 activeDirection = dir;
 activeClueNum = num;
 activeCells = (dir === "across" ? acrossMap : downMap)[num] || [];

 // highlight all cells of the word (PuzzleMe style)
 activeCells.forEach(c => c.td.classList.add("active-word"));

 // highlight the clue
 document.querySelectorAll(".clue-item").forEach(el => el.classList.remove("active-clue"));
 const clueEl = document.querySelector(`.clue-item[data-dir="${dir}"][data-num="${num}"]`);
 if (clueEl) clueEl.classList.add("active-clue");

 // choose index
 activeIndex = 0;
 if (focus) {
   for (let i = 0; i < activeCells.length; i++) {
     if ((activeCells[i].input?.value || "") === "") { activeIndex = i; break; }
   }
 }

 focusActiveCell();
}

function focusActiveCell() {
 document.querySelectorAll("td").forEach(td => td.classList.remove("active-cell"));

 const cell = activeCells[activeIndex];
 if (!cell?.input) return;

 cell.td.classList.add("active-cell");

 // Focus the real input so typing flows.
 // preventScroll avoids iOS jumping the page.
 suppressFocusHandler = true;
 try {
   cell.input.focus({ preventScroll: true });
   // do NOT select() — selection triggers the bubble more often on iOS
 } catch (e) {
   // ignore
 } finally {
   // release guard next tick
   setTimeout(() => { suppressFocusHandler = false; }, 0);
 }
}


function onCellTap(r, c) {
 const obj = cellMap?.[r]?.[c];
 if (!obj?.input) return;

 const hasAcross = obj.acrossNum != null;
 const hasDown = obj.downNum != null;

 let dir = activeDirection;
 const now = Date.now();

 // 🔁 double-tap toggle logic
 if (
   lastTapCell.r === r &&
   lastTapCell.c === c &&
   hasAcross &&
   hasDown &&
   now - lastTapTime < 350
 ) {
   dir = activeDirection === "across" ? "down" : "across";
 } else {
   if (dir === "across" && !hasAcross) dir = "down";
   if (dir === "down" && !hasDown) dir = "across";
   if (!dir) dir = hasAcross ? "across" : "down";
 }

 lastTapTime = now;

 const num = dir === "across" ? obj.acrossNum : obj.downNum;
 if (num == null) return;

 activateWord(dir, num, true);

 lastTapCell = { r, c };
}



function onCellFocus(r, c) {
 // keyboard/tab focus fallback (desktop/accessibility)
 onCellTap(r, c);
}

/* ---------- INPUT ---------- */

function handleInput(e) {
 const input = e.target;
 let val = (input.value || "").toUpperCase().slice(-1);

 if (/^[A-Z]$/.test(val)) {
   input.value = val;
   saveProgress();
   moveNext();
 } else {
   input.value = "";
   saveProgress();
 }
}

function handleKeyNav(e) {
 if (!activeCells.length) return;

 if (e.key === "Backspace") {
   e.preventDefault();
   const cell = activeCells[activeIndex];
   if (cell?.input?.value) {
     cell.input.value = "";
     saveProgress();
     return;
   }
   if (activeIndex > 0) {
     activeIndex--;
     focusActiveCell();
     activeCells[activeIndex].input.value = "";
     saveProgress();
   }
   return;
 }

 if (e.key.startsWith("Arrow")) {
   e.preventDefault();
   if (e.key === "ArrowRight" || e.key === "ArrowDown") activeIndex++;
   if (e.key === "ArrowLeft" || e.key === "ArrowUp") activeIndex--;
   activeIndex = Math.max(0, Math.min(activeIndex, activeCells.length - 1));
   focusActiveCell();
 }
}

function moveNext() {
 for (let i = activeIndex + 1; i < activeCells.length; i++) {
   if ((activeCells[i].input?.value || "") === "") {
     activeIndex = i;
     focusActiveCell();
     return;
   }
 }
}

/* ---------- CHECK / REVEAL HELPERS ---------- */

function solutionAt(r, c) {
 const s = puzzleData?.solution?.[r]?.[c];
 if (!s || s === "#") return null;
 return s.toUpperCase();
}

function clearWrongOnActiveWord() {
 activeCells.forEach(cell => cell.td.classList.remove("wrong"));
}

/* ---------- REQUIRED GLOBAL BUTTON HANDLERS ---------- */

function clearGrid() {
 localStorage.removeItem(LS_KEY);
 document.querySelectorAll("td input").forEach(inp => { inp.value = ""; });

 clearHighlights();
 document.querySelectorAll(".clue-item").forEach(el => el.classList.remove("active-clue"));

 activeDirection = null;
 activeClueNum = null;
 activeCells = [];
 activeIndex = 0;
 lastTapCell = { r: null, c: null };
}

/* (keeping your working versions) */
function checkWord() {
 if (!activeCells.length || !puzzleData?.solution) return;

 clearWrongOnActiveWord();

 activeCells.forEach(cell => {
   const sol = solutionAt(cell.r, cell.c);
   if (!sol) return;

   const val = (cell.input?.value || "").toUpperCase();
   if (val && val !== sol) cell.td.classList.add("wrong");
 });
}

function revealLetter() {
 if (!activeCells.length || !puzzleData?.solution) return;

 const cell = activeCells[activeIndex];
 if (!cell?.input) return;

 const sol = solutionAt(cell.r, cell.c);
 if (!sol) return;

 cell.input.value = sol;
 cell.td.classList.remove("wrong");
 saveProgress();
 moveNext();
}

function revealWord() {
 if (!activeCells.length || !puzzleData?.solution) return;

 activeCells.forEach(cell => {
   const sol = solutionAt(cell.r, cell.c);
   if (!sol || !cell.input) return;
   cell.input.value = sol;
   cell.td.classList.remove("wrong");
 });

 saveProgress();
}

/* ---------- SAVE / HIGHLIGHTS ---------- */

function saveProgress() {
 const out = {};
 document.querySelectorAll("td input").forEach(inp => {
   if (inp.value) out[inp.dataset.row + "-" + inp.dataset.col] = inp.value;
 });
 localStorage.setItem(LS_KEY, JSON.stringify(out));
}

function clearHighlights() {
 document.querySelectorAll("td").forEach(td => {
   td.classList.remove("active-word", "active-cell", "wrong");
 });
}
