/* ====== 設定（請依你的 repo 調整） ====== */
const CONFIG = {
  OWNER: 'YOUR_GITHUB_USER_OR_ORG',
  REPO: 'YOUR_REPO_NAME',
  BRANCH: 'main',
  // 建議改走你的 proxy；若直連 GitHub API，將 PAT 放 localStorage：localStorage.setItem('gh_token','ghp_...')
  get token() { return localStorage.getItem('gh_token') || ''; }
};
/* ======================================= */

const SELECTORS = 'h1,h2,h3,p'; // 取最上層段落用
const INITIAL_LOAD = 30;
const PAGE_LOAD = 30;
const backendURL = "https://newsbeiter.onrender.com";

let booksList = [];            // [{name,fileName,author,progress}]
let currentBook = null;        // 上述物件
let enSeg = [];                // [{tag, html}]
let zhSeg = [];                // [{tag, html}]
let notes = {};                // { idx: html } 存 localStorage
let windowStart = 0;           // 目前視窗起始 index
let windowSize = INITIAL_LOAD; // 目前已載入數量
let lastFocused = { idx: -1, lang: null }; // lang: 'en'|'zh'|'note'

/* ====== 初始化 ====== */
// document.addEventListener('DOMContentLoaded', async () => {
//   bindToolbar();
//   bindScrollers();

//   await loadBooksList();
//   populateBookSelect();

//   // 手機 swipe 輔助（加強感知）
//   setupSwipe(document.getElementById('scrollHostCard'));
// });

document.addEventListener("DOMContentLoaded", async () => {
  bindToolbar();
  bindScrollers();

  await loadBooksList();
  populateBookSelect();

  const table = document.getElementById("tableView");

  // ========= 工具列按鈕 =========
  document.getElementById("btnMerge").addEventListener("click", () => {
    const info = getCurrentCellInfo();console.log(info);
    if (info) mergeRow(info.index, info.lang);
  });

  document.getElementById("btnDelete").addEventListener("click", () => {
    const info = getCurrentCellInfo();
    if (info) deleteRow(info.index, info.lang);
  });

  // ========= 初始化編輯事件 =========
  table.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("cell")) {
      e.preventDefault();
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      const after = range.extractContents();
      const afterHTML = new XMLSerializer().serializeToString(after).trim();
      if (afterHTML) {
        const index = e.target.closest("[data-idx]").dataset.idx;
        splitParagraph(index, afterHTML, e.target.dataset.lang, range);
      }
    }
  });

  // 手機 swipe 輔助（加強感知）
  setupSwipe(document.getElementById('scrollHostCard'));
});


/* ====== UI 綁定 ====== */
function bindToolbar() {
  document.getElementById('bookSelect').addEventListener('change', onBookChange);
  // document.getElementById('btnMerge').addEventListener('click', onMergeRow);
  // document.getElementById('btnDelete').addEventListener('click',onDeleteRow);
  document.getElementById('btnSave').addEventListener('click', onSave);
}

function bindScrollers() {
  const hostTable = document.getElementById('scrollHostTable');
  const hostCard = document.getElementById('scrollHostCard');

  [hostTable, hostCard].forEach(host => {
    if (!host) return;
    host.addEventListener('scroll', () => onScroll(host));
    host.addEventListener('wheel', (e) => {
      // 向上頂端拉，補前一批
      if (host.scrollTop === 0 && e.deltaY < 0) {
        tryLoadPrev();
      }
      // 向下底部拉，補後一批
      if (host.scrollHeight - host.clientHeight - host.scrollTop < 40 && e.deltaY > 0) {
        tryLoadNext();
      }
    });
  });
}

/* ====== 資料載入 ====== */
async function loadBooksList() {
  url=`${backendURL}/note/read`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({category:'book', path:'list.txt'})
  });
  if (!res.ok) throw new Error('無法讀取書籍列表');
  const raw = await res.json();
  raw.forEach(item => {booksList.push(JSON.parse(item))});
}

function populateBookSelect() {
  const sel = document.getElementById('bookSelect');
  sel.innerHTML = '<option value="">請選擇...</option>' + booksList.map((b,i) =>
    `<option value="${i}">${b.name} - ${b.author}</option>`
  ).join('');
}

async function onBookChange(e) {
  const idx = e.target.value;
  if (idx === '') return;
  currentBook = booksList[Number(idx)];
  notes = loadNotes(currentBook.fileName);

  //const base = `books/${currentBook.fileName}`;
  const [enHTML, zhHTML] = await Promise.all([
    fetch(`${backendURL}/note/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({category:'book', path:`${currentBook.fileName}/en.txt`})
    }).then(r => r.json();console.log(r.json())), 
    fetch(`${backendURL}/note/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({category:'book', path:`${currentBook.fileName}/zh.txt`})
    }).then(r => r.json();console.log(r.json())),
  ]);
  console.log([enHTML, zhHTML]);
  enHTML.forEach(h=>{enSeg.puah(extractSegments(h))});
  zhHTML.forEach(h=>{zhSeg.puah(extractSegments(h))});

  // 設定視窗
  windowStart = Math.max(0, Math.min(currentBook.progress || 0, enSeg.length-1));
  windowSize = INITIAL_LOAD;
  ensureWindowBounds();

  render();
}

/* ====== 段落抽取 ====== */
function extractSegments(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {tag:doc.tagName.toLowerCase(), html:doc.innerHTML.trim()};
}

/* ====== 視窗載入/滾動 ====== */
function ensureWindowBounds() {
  if (windowStart < 0) windowStart = 0;
  if (windowStart >= enSeg.length) windowStart = Math.max(0, enSeg.length-1);
  const maxSize = Math.min(enSeg.length - windowStart, Math.max(windowSize, 0));
  windowSize = Math.max(Math.min(maxSize, 500), Math.min(windowSize, INITIAL_LOAD)); // 安全上限
}

function tryLoadNext() {
  const end = windowStart + windowSize;
  if (end >= enSeg.length) return;
  windowSize = Math.min(windowSize + PAGE_LOAD, enSeg.length - windowStart);
  render();
}

function tryLoadPrev() {
  if (windowStart === 0) return;
  const add = Math.min(PAGE_LOAD, windowStart);
  windowStart -= add;
  windowSize += add;
  render(true); // 往前加載時，維持視覺位置
}

function onScroll(host) {
  // 近底／近頂再觸發（已有 wheel 補強）
  if (host.scrollHeight - host.clientHeight - host.scrollTop < 10) tryLoadNext();
  if (host.scrollTop === 0) tryLoadPrev();
}

/* ====== 渲染 ====== */
function render(preserveScrollTop=false) {
  const rangeInfo = document.getElementById('rangeInfo');
  rangeInfo.textContent = `${windowStart+1} ~ ${Math.min(windowStart+windowSize, enSeg.length)} / ${enSeg.length}`;

  const isDesktop = window.matchMedia('(min-width: 768px)').matches;
  if (isDesktop) renderTable(preserveScrollTop); else renderCards(preserveScrollTop);
}

function renderTable(preserve) {
  const host = document.getElementById('scrollHostTable');
  const tbody = document.getElementById('tbody');
  const prevTop = preserve ? host.scrollTop : 0;

  const rows = [];
  for (let i=0;i<windowSize;i++) {
    const idx = windowStart + i;
    rows.push(renderRowHTML(idx));
  }
  tbody.innerHTML = rows.join('');

  // 綁定編輯與焦點
  tbody.querySelectorAll('.segment-cell').forEach(bindEditableCell);
  tbody.querySelectorAll('.note-cell').forEach(bindNoteCell);
  updateFocusInfo();

  if (preserve) host.scrollTop = prevTop;
}

function renderCards(preserve) {
  const host = document.getElementById('scrollHostCard');
  const prevTop = preserve ? host.scrollTop : 0;

  const blocks = [];
  for (let i=0;i<windowSize;i++) {
    const idx = windowStart + i;
    blocks.push(renderCardHTML(idx));
  }
  host.innerHTML = blocks.join('');

  // 綁定
  host.querySelectorAll('.segment-cell').forEach(bindEditableCell);
  host.querySelectorAll('.note-cell').forEach(bindNoteCell);
  updateFocusInfo();

  if (preserve) host.scrollTop = prevTop;
}

function renderRowHTML(idx) {
  const en = enSeg[idx] || {tag:'p', html:''};
  const zh = zhSeg[idx] || {tag:'p', html:''};
  const note = notes[idx] || '';

  return `
    <tr class="row-hover" data-idx="${idx}">
      <td class="segment-cell display-text" data-idx="${idx}" data-lang="en">${toText(en.html)}</td>
      <td class="segment-cell display-text" data-idx="${idx}" data-lang="zh">${toText(zh.html)}</td>
      <td class="segment-cell note-cell display-text" data-idx="${idx}" data-lang="note">${toText(note)}</td>
    </tr>
  `;
}

function renderCardHTML(idx) {
  const en = enSeg[idx] || {tag:'p', html:''};
  const zh = zhSeg[idx] || {tag:'p', html:''};
  const note = notes[idx] || '';
  return `
    <div class="card seg-card" data-idx="${idx}">
      <div class="card-body">
        <div class="label">#${idx+1} English</div>
        <div class="segment-cell display-text" data-idx="${idx}" data-lang="en">${toText(en.html)}</div>

        <div class="label mt-3">中文</div>
        <div class="segment-cell display-text" data-idx="${idx}" data-lang="zh">${toText(zh.html)}</div>

        <div class="label mt-3">筆記</div>
        <div class="segment-cell note-cell display-text" data-idx="${idx}" data-lang="note">${toText(note)}</div>
      </div>
    </div>
  `;
}

function toText(html) {
  // 簡單轉純文字以供未聚焦顯示
  const t = document.createElement('div');
  t.innerHTML = html || '';
  return (t.textContent || '').replace(/\n{3,}/g, '\n\n');
}

/* ====== 編輯與 Enter 分段 ====== */
function bindEditableCell(el) {
  el.setAttribute('contenteditable', 'true');

  el.addEventListener('focus', (e) => {
    const idx = Number(el.dataset.idx);
    const lang = el.dataset.lang;
    lastFocused = { idx, lang };
    updateFocusInfo();

    // 進入 HTML 顯示模式
    el.classList.remove('display-text');
    const html = lang === 'en' ? enSeg[idx]?.html
               : lang === 'zh' ? zhSeg[idx]?.html
               : (notes[idx] || '');
    el.innerHTML = html || '';
  });

  el.addEventListener('blur', () => {
    // 退出時改成純文字呈現，但把 HTML 內容存回
    const idx = Number(el.dataset.idx);
    const lang = el.dataset.lang;
    const html = el.innerHTML;

    if (lang === 'en') enSeg[idx].html = html;
    else if (lang === 'zh') zhSeg[idx].html = html;
    else { notes[idx] = html; saveNotes(currentBook?.fileName, notes); }

    el.textContent = toText(html);
    el.classList.add('display-text');
  });

  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const idx = Number(el.dataset.idx);
      const lang = el.dataset.lang;
      handleEnterSplit(el, idx, lang);
    }
  });
}

function bindNoteCell(el) {
  // 只是為了更新 lastFocused
  el.addEventListener('focus', () => {
    lastFocused = { idx: Number(el.dataset.idx), lang: 'note' };
    updateFocusInfo();
  });
}

function updateFocusInfo() {
  const info = document.getElementById('focusInfo');
  if (lastFocused.idx >= 0) {
    info.textContent = `#${lastFocused.idx+1}・${lastFocused.lang || '-'}`;
  } else info.textContent = '-';
}

function handleEnterSplit(el, idx, lang) {
  // 以目前 caret 分割該欄位 HTML
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  // 建立從 caret 到結尾的 range
  const afterRange = range.cloneRange();
  afterRange.setEndAfter(el.lastChild || el);
  const afterFrag = afterRange.cloneContents();
  afterRange.deleteContents(); // 刪除 caret 後的內容 => 保留「前半」
  const beforeHTML = el.innerHTML;
  const container = document.createElement('div');
  container.appendChild(afterFrag);
  const afterHTML = container.innerHTML;

  // 更新目前儲存體
  if (lang === 'en') {
    enSeg[idx].html = beforeHTML;
    enSeg.splice(idx+1, 0, { tag: enSeg[idx].tag || 'p', html: afterHTML });
    // 中文整體順移一段（不改內容）
    //zhSeg.splice(idx+1, 0, { tag: zhSeg[idx]?.tag || 'p', html: '' });
  } else if (lang === 'zh') {
    zhSeg[idx].html = beforeHTML;
    zhSeg.splice(idx+1, 0, { tag: zhSeg[idx].tag || 'p', html: afterHTML });
    // 英文順移
    //enSeg.splice(idx+1, 0, { tag: enSeg[idx]?.tag || 'p', html: '' });
  } else {
    // 筆記：單純把筆記拆段（不影響英／中對齊）
    const b = notes[idx] || beforeHTML;
    notes[idx] = beforeHTML;
    shiftArrayNotes(idx+1);
    notes[idx+1] = afterHTML;
    saveNotes(currentBook?.fileName, notes);
  }

  // 筆記也跟著順移（確保對齊）
  //shiftArrayNotes(idx+1);

  // 視窗調整
  //windowSize += 1;
  render(true);

  // 把焦點移到下一列同欄位開頭
  setTimeout(() => {
    const next = queryCell(idx+1, lang);
    if (next) {
      next.focus();
      placeCaretAtStart(next);
    }
  }, 0);
}

function shiftArrayNotes(insertAt) {
  const newNotes = {};
  Object.keys(notes).map(n=>Number(n)).sort((a,b)=>a-b).forEach(k=>{
    newNotes[k >= insertAt ? k+1 : k] = notes[k];
  });
  notes = newNotes;
}

function queryCell(idx, lang) {
  return document.querySelector(`.segment-cell[data-idx="${idx}"][data-lang="${lang}"]`);
}

function placeCaretAtStart(el) {
  const r = document.createRange();
  r.setStart(el, 0);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function mergeHTML(a,b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return `${a}<br><br>${b}`;
}

/* ====== 儲存（更新 list.json 的 progress 與回寫 zh.html） ====== */
async function onSave() {
  if (!currentBook) return;

  const bottomIndex = windowStart + windowSize - 1; // 視窗底部
  const newProgress = Math.max(0, bottomIndex - 30);

  // 產生 en, zh.html 的 innerHTML（用原 tag 保留）
  const enInner = enSeg.map(seg => `<${seg.tag}>${seg.html}</${seg.tag}>`).join('\n');
  const zhInner = zhSeg.map(seg => `<${seg.tag}>${seg.html}</${seg.tag}>`).join('\n');

  // 更新 list.json 的 progress
  const newList = booksList.map(item => {
    if (item.fileName === currentBook.fileName) {
      return { ...item, progress: newProgress };
    }
    return item;
  });

  try {
    await updateContent('list.txt', newList.join('\n'));
    await updateContent(`${currentBook.fileName}/en.txt`,enInner);
    await updateContent(`${currentBook.fileName}/zh.txt`,zhInner);
    // await saveToGitHubJson(`books/list.json`, newList, `chore(read): update progress for ${currentBook.fileName} => ${newProgress}`);
    // await saveToGitHubRaw(`${currentBook.fileName}/en.html`, enInner);
    // await saveToGitHubRaw(`${currentBook.fileName}/zh.html`, zhInner);

    alert('已儲存進度與中文檔。');
    // 更新本地 booksList 與 currentBook
    booksList = newList;
    currentBook.progress = newProgress;
  } catch (err) {
    console.error(err);
    alert('儲存失敗：請檢查瀏覽器主控台與 token / 權限設定。');
  }
}

/* ====== GitHub API（可改成呼叫你的 proxy） ====== */
async function updateContent(path, content) {
  fetch(`${backendURL}/note/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({category:'book', path:path, content:content})
  }).then(res => {
      if (!res.ok) alert('❌ 上傳失敗');
  });
}

// async function saveToGitHubJson(path, obj) {
//   const content = new TextEncoder().encode(JSON.stringify(obj, null, 2));
//   const b64 = btoa(String.fromCharCode(...content));
//   return uploadContent(path, b64);
// }
// async function saveToGitHubRaw(path, raw) {
//   const b = new TextEncoder().encode(raw);
//   const b64 = btoa(String.fromCharCode(...b));
//   return uploadContent(path, b64);
// }
// async function uploadContent(path, base64Content) {
//   const url = `${backendURL}/read/replace`;
//   const body = {
//     path: path,
//     content: base64Content,
//     branch: CONFIG.BRANCH,
//     ...(sha ? { sha } : {})
//   };
//   const res = await fetch(url, {
//     method: 'PUT',
//     headers: {'Content-Type': 'application/json'},
//     body: JSON.stringify(body)
//   });
//   if (!res.ok) {
//     const t = await res.text();
//     throw new Error(`GitHub upload failed: ${res.status} ${t}`);
//   }
// }

/* ====== 筆記（localStorage） ====== */
const NOTE_KEY = (file) => `bireader-notes:${file}`;
function loadNotes(file) {
  try { return JSON.parse(localStorage.getItem(NOTE_KEY(file)) || '{}'); }
  catch { return {}; }
}
function saveNotes(file, obj) {
  localStorage.setItem(NOTE_KEY(file), JSON.stringify(obj));
}

/* ====== 手機 swipe 偵測（上/下滑補載） ====== */
function setupSwipe(host) {
  if (!host) return;
  let startY = null;
  host.addEventListener('touchstart', (e) => { startY = e.changedTouches[0].clientY; }, {passive:true});
  host.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const endY = e.changedTouches[0].clientY;
    const dy = endY - startY;
    // 向上 swipe（往下閱讀）
    if (dy < -40) tryLoadNext();
    // 向下 swipe（回到前面）
    if (dy > 40) tryLoadPrev();
    startY = null;
  }, {passive:true});
}
















// ========= 分段 =========
function splitParagraph(index, afterHTML, lang, range) {
  const row = document.querySelector(`[data-idx="${index}"]`);
  if (!row) return;

  // 複製當前 row
  const newRow = row.cloneNode(true);
  newRow.dataset.idx = parseFloat(index) + 0.1; // 臨時 index

  // 只在指定語言 cell 插入新內容
  newRow.querySelectorAll(".cell").forEach(cell => {
    if (cell.dataset.lang === lang) {
      cell.innerHTML = afterHTML;
    } else {
      cell.innerHTML = ""; // 其他語言清空
    }
  });

  // 清掉原本游標之後的內容
  range.deleteContents();

  row.insertAdjacentElement("afterend", newRow);
  reindexRows();
}

let activeCell = null;
// 點擊表格時設定 activeCell
tableView.addEventListener("click", e => {
  if (e.target.closest("td")) {
    tableView.querySelectorAll('td, th').forEach(r => r.classList.remove("active"));
    activeCell = e.target.closest("td");
    activeCell.classList.add("active");
  }
});


function mergeRow(index, lang) {
  const currCell = activeCell;
  const prevCell = activeCell.closest('tr').previousElementSibling.querySelector(`[data-lang="${activeCell.dataset.lang}"]`);
  if (currCell && prevCell) {
    prevCell.innerHTML += currCell.innerHTML;
    currCell.innerHTML = "";
  }
  cleanEmptyRow();
  reindexRows();
}


// ========= 刪除 =========
function deleteRow(index, lang) {
  if (activeCell) {activeCell.closest('tr').remove()};
  cleanEmptyRow();
  reindexRows();
}

function cleanEmptyRow() {
  tableView.querySelectorAll('#tableView tr').forEach(r=>{if (r.innerText.trim()===""){r.remove()}});
}

function reindexRows() {
  document.querySelectorAll("#tableView tr").forEach((row, i) => {
    row.dataset.idx = i + 1;
  });
}

function getCurrentCellInfo() {
  const node = activeCell;
  return {
    index: node.closest("[data-idx]").dataset.idx,
    lang: node.dataset.lang
  };
}