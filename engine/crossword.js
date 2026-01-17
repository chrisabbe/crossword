/* ===============================
   Inbox Puzzles – Crossword Engine
   =============================== */

const LS_KEY = (() => {
  const parts = location.pathname.split("/").filter(Boolean);
  const day = parts.find(p => p.startsWith("day") || p.startsWith("trial"));
  return "cw_" + (day || "default");
})();

let puzzleData = null;
let cellMap = [];
let acrossMap = {}, downMap = {};
let activeDirection = null;
let activeClueNum = null;
let activeCells = [];
let activeIndex = 0;

/* ---------- INIT ---------- */

fetch("puzzle.json")
  .then(r => r.json())
  .then(data => {
    puzzleData = data;

    document.title = (data.meta?.title || "Daily Crossword").toUpperCase();
    const titleEl = document.getElementById("titleEl");
    const subtitleEl = document.getElementById("subtitleEl");
    if(titleEl) titleEl.textContent = document.title;
    if(subtitleEl) subtitleEl.textContent = data.meta?.subtitle || "";

    buildPuzzle(data);
  })
  .catch(() => {
    document.getElementById("puzzleArea").innerHTML =
      "<div style='text-align:center;color:#b00000;font-weight:bold;margin-top:30px;'>Crossword Unavailable</div>";
  });

/* ---------- BUILD ---------- */

function buildPuzzle(puz){
  cellMap = [];
  acrossMap = {};
  downMap = {};

  const wrap = document.createElement("div");
  wrap.className = "grid-wrapper";

  const tbl = document.createElement("table");
  tbl.className = "crossword";

  const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");

  for(let r=0; r<puz.size.rows; r++){
    cellMap[r] = [];
    const tr = document.createElement("tr");

    for(let c=0; c<puz.size.cols; c++){
      const td = document.createElement("td");
      const obj = { td, input:null, acrossNum:null, downNum:null };
      cellMap[r][c] = obj;

      if(puz.grid[r][c] === "#"){
        td.classList.add("block");
      }else{
        const inp = document.createElement("input");
        inp.maxLength = 1;
        inp.dataset.row = r;
        inp.dataset.col = c;

        const k = r+"-"+c;
        if(saved[k]) inp.value = saved[k];

        inp.addEventListener("input", handleInput);
        inp.addEventListener("keydown", handleKeyNav);
        inp.addEventListener("focus", () => onCellFocus(r,c));

        td.appendChild(inp);
        obj.input = inp;
      }

      if(puz.numbers[r][c] > 0){
        const n = document.createElement("div");
        n.className = "num";
        n.textContent = puz.numbers[r][c];
        td.appendChild(n);
      }

      td.addEventListener("click", () => onCellFocus(r,c,true));
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }

  wrap.appendChild(tbl);
  document.getElementById("puzzleArea").innerHTML = "";
  document.getElementById("puzzleArea").appendChild(wrap);

  computeWordMaps(puz);
  buildClues(puz);
}

/* ---------- WORD MAPS ---------- */

function computeWordMaps(puz){
  const { rows, cols } = puz.size;
  const grid = puz.grid;
  const nums = puz.numbers;

  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      if(grid[r][c] === "#") continue;

      if((c===0||grid[r][c-1]==="#") && c+1<cols && grid[r][c+1]!=="#"){
        const n = nums[r][c];
        if(n>0){
          let cc=c;
          while(cc<cols && grid[r][cc]!=="#"){
            cellMap[r][cc].acrossNum = n;
            cc++;
          }
        }
      }

      if((r===0||grid[r-1][c]==="#") && r+1<rows && grid[r+1][c]!=="#"){
        const n = nums[r][c];
        if(n>0){
          let rr=r;
          while(rr<rows && grid[rr][c]!=="#"){
            cellMap[rr][c].downNum = n;
            rr++;
          }
        }
      }
    }
  }

  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const obj = cellMap[r][c];
      if(obj.acrossNum!=null){
        (acrossMap[obj.acrossNum] ??= []).push({r,c,...obj});
      }
      if(obj.downNum!=null){
        (downMap[obj.downNum] ??= []).push({r,c,...obj});
      }
    }
  }
}

/* ---------- CLUES ---------- */

function buildClues(p){
  const acrossDiv = document.getElementById("across");
  const downDiv = document.getElementById("down");
  acrossDiv.innerHTML = "";
  downDiv.innerHTML = "";

  Object.keys(p.clues.across).sort((a,b)=>a-b).forEach(n=>{
    const d=document.createElement("div");
    d.className="clue-item";
    d.textContent=`${n}. ${p.clues.across[n]}`;
    d.onclick=()=>activateWord("across",+n,true);
    acrossDiv.appendChild(d);
  });

  Object.keys(p.clues.down).sort((a,b)=>a-b).forEach(n=>{
    const d=document.createElement("div");
    d.className="clue-item";
    d.textContent=`${n}. ${p.clues.down[n]}`;
    d.onclick=()=>activateWord("down",+n,true);
    downDiv.appendChild(d);
  });
}

/* ---------- NAVIGATION ---------- */

function activateWord(dir,num,focus){
  clearHighlights();
  activeDirection=dir;
  activeClueNum=num;
  activeCells=(dir==="across"?acrossMap:downMap)[num]||[];
  activeIndex=0;

  activeCells.forEach(c=>c.td.classList.add("active-word"));

  if(focus){
    for(let i=0;i<activeCells.length;i++){
      if(activeCells[i].input?.value===""){ activeIndex=i; break; }
    }
    focusActiveCell();
  }
}

function focusActiveCell(){
  document.querySelectorAll("td").forEach(td=>td.classList.remove("active-cell"));
  const cell=activeCells[activeIndex];
  if(cell?.input){
    cell.td.classList.add("active-cell");
    cell.input.focus();
  }
}

function onCellFocus(r,c){
  const obj=cellMap[r][c];
  if(!obj?.input) return;

  const dir=obj.acrossNum!=null?"across":"down";
  const num=obj[dir+"Num"];
  if(num!=null){
    activateWord(dir,num,false);
    activeIndex=activeCells.findIndex(x=>x.r===r&&x.c===c);
    focusActiveCell();
  }
}

/* ---------- INPUT ---------- */

function handleInput(e){
  const input=e.target;
  const r=+input.dataset.row, c=+input.dataset.col;
  let val=input.value.toUpperCase().slice(-1);

  if(/^[A-Z]$/.test(val)){
    input.value=val;
    saveProgress();
    moveNext();
  }else{
    input.value="";
    saveProgress();
  }
}

function handleKeyNav(e){
  if(!activeCells.length) return;

  if(e.key==="Backspace"){
    e.preventDefault();
    const cell=activeCells[activeIndex];
    if(cell.input.value!==""){
      cell.input.value="";
      saveProgress();
      return;
    }
    if(activeIndex>0){
      activeIndex--;
      focusActiveCell();
      activeCells[activeIndex].input.value="";
      saveProgress();
    }
    return;
  }

  if(e.key.startsWith("Arrow")){
    e.preventDefault();
    if(e.key==="ArrowRight"||e.key==="ArrowDown") activeIndex++;
    if(e.key==="ArrowLeft"||e.key==="ArrowUp") activeIndex--;
    activeIndex=Math.max(0,Math.min(activeIndex,activeCells.length-1));
    focusActiveCell();
  }
}

function moveNext(){
  for(let i=activeIndex+1;i<activeCells.length;i++){
    if(activeCells[i].input.value===""){
      activeIndex=i;
      focusActiveCell();
      return;
    }
  }
}

/* ---------- SAVE ---------- */

function saveProgress(){
  const out={};
  document.querySelectorAll("td input").forEach(inp=>{
    if(inp.value) out[inp.dataset.row+"-"+inp.dataset.col]=inp.value;
  });
  localStorage.setItem(LS_KEY,JSON.stringify(out));
}

function clearHighlights(){
  document.querySelectorAll("td").forEach(td=>td.className=td.className.replace(/\bactive\w+|\bwrong\b/g,""));
}
