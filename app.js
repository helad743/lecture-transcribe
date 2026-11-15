// 휴대폰 화면. 전사 로직은 core.js에 있고, 여기서는 파일 고르기·대기열·결과 보관(IndexedDB)·화면 표시만 한다.
import * as core from "./core.js";

const $ = (id) => document.getElementById(id);
const settings = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 등 */ } },
};

// ---------- 결과 보관(IndexedDB): 구간별 결과까지 저장해 중간에 멈춰도 이어서 한다 ----------

const db = (() => {
  let opened;
  const open = () => opened || (opened = new Promise((resolve, reject) => {
    const req = indexedDB.open("gemini-lecture", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("lectures");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const store = (await open()).transaction("lectures", mode).objectStore("lectures");
    return new Promise((resolve, reject) => {
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    put: (k, v) => run("readwrite", (s) => s.put(v, k)),
    del: (k) => run("readwrite", (s) => s.delete(k)),
    all: () => run("readonly", (s) => s.getAll()),
  };
})();

// ---------- 로그 ----------

function log(message) {
  const el = $("log");
  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  el.textContent += `[${time}] ${message}\n`;
  el.scrollTop = el.scrollHeight;
}

// ---------- 결과 저장/공유 ----------

const textFile = (name, text) => new File([text], name, { type: "text/plain;charset=utf-8" });

function saveText(name, text) {
  const url = URL.createObjectURL(textFile(name, text));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const canShareFiles = () => {
  try { return !!navigator.canShare && navigator.canShare({ files: [textFile("a.txt", "a")] }); } catch { return false; }
};

async function shareText(name, text) {
  try {
    await navigator.share({ files: [textFile(name, text)], title: name });
  } catch (e) {
    if (e.name !== "AbortError") { log(`공유하지 못해 파일로 저장합니다. (${e.message})`); saveText(name, text); }
  }
}

let viewing = null;
function openViewer(name, text) {
  viewing = { name, text };
  $("viewerTitle").textContent = name;
  $("viewerText").textContent = text;
  $("viewerShare").classList.toggle("hidden", !canShareFiles());
  $("viewer").showModal();
  $("viewer").querySelector(".dlg-body").scrollTop = 0;
}
$("viewerClose").onclick = () => $("viewer").close();
$("viewerSave").onclick = () => saveText(viewing.name, viewing.text);
$("viewerShare").onclick = () => shareText(viewing.name, viewing.text);
$("viewerCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(viewing.text); $("viewerCopy").textContent = "복사됨"; }
  catch { $("viewerCopy").textContent = "복사 안 됨"; }
  setTimeout(() => { $("viewerCopy").textContent = "복사"; }, 1500);
};

function resultButtons(record) {
  const row = document.createElement("div");
  row.className = "row";
  const add = (label, fn, cls = "") => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: label, className: cls });
    b.onclick = fn;
    row.append(b);
    return b;
  };
  add("보기", () => openViewer(record.name, record.merged));
  add("저장", () => saveText(record.name, record.merged));
  if (canShareFiles()) add("공유", () => shareText(record.name, record.merged));
  if (record.notes) add("복습 노트", () => openViewer(record.notesName, record.notes));
  return { row, add };
}

// ---------- 대기열 ----------

const queue = []; // {id, file, pdf, status: pending|running|done|error|stopped, message, done, total, record}
let running = false, stopRequested = false, nextId = 1;

function addFiles(files) {
  for (const file of files) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) continue;
    if (queue.some((q) => q.file.name === file.name && q.file.size === file.size && q.status !== "done")) {
      log(`이미 목록에 있습니다: ${file.name}`);
      continue;
    }
    queue.push({ id: nextId++, file, pdf: null, status: "pending", message: "대기 중", done: 0, total: 0 });
  }
  renderQueue();
  if (running) log("대기열에 추가했습니다. 지금 파일이 끝나면 차례로 전사합니다.");
}

function statusText(item) {
  if (item.status === "running") return item.total ? `전사 중 · 구간 ${item.done}/${item.total}` : item.message;
  return item.message;
}

function renderQueue() {
  const ul = $("queue");
  ul.replaceChildren();
  for (const item of queue) {
    const li = document.createElement("li");
    li.className = "item";
    const name = Object.assign(document.createElement("div"), { className: "name", textContent: item.file.name });
    const meta = Object.assign(document.createElement("div"), {
      className: "muted small", textContent: `${(item.file.size / 1024 / 1024).toFixed(1)} MB` + (item.pdf ? ` · PDF: ${item.pdf.name}` : ""),
    });
    const status = Object.assign(document.createElement("div"), {
      className: "status " + ({ done: "ok", error: "err", stopped: "warn" }[item.status] || ""), textContent: statusText(item),
    });
    li.append(name, meta, status);
    if (item.status === "running") {
      const bar = document.createElement("progress");
      bar.max = Math.max(item.total, 1);
      bar.value = item.done;
      li.append(bar);
    }
    if (item.status === "done" && item.record) {
      li.append(resultButtons(item.record).row);
    } else if (item.status !== "running") {
      const row = document.createElement("div");
      row.className = "row";
      const pdfInput = Object.assign(document.createElement("input"), { type: "file", accept: "application/pdf,.pdf", className: "hidden" });
      pdfInput.onchange = () => { item.pdf = pdfInput.files[0] || null; renderQueue(); };
      const pdfBtn = Object.assign(document.createElement("button"), { type: "button", textContent: item.pdf ? "PDF 바꾸기" : "강의 PDF 추가 (선택)" });
      pdfBtn.onclick = () => pdfInput.click();
      row.append(pdfInput, pdfBtn);
      if (item.pdf) {
        const clear = Object.assign(document.createElement("button"), { type: "button", textContent: "PDF 빼기" });
        clear.onclick = () => { item.pdf = null; renderQueue(); };
        row.append(clear);
      }
      const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "빼기", className: "danger" });
      remove.onclick = () => { queue.splice(queue.indexOf(item), 1); renderQueue(); };
      row.append(remove);
      li.append(row);
    }
    ul.append(li);
  }
  $("queueEmpty").classList.toggle("hidden", queue.length > 0);
  const waiting = queue.some((q) => ["pending", "error", "stopped"].includes(q.status));
  $("startBtn").disabled = running || !waiting;
  $("startBtn").textContent = running ? "전사 중..." : "전사 시작";
  $("stopBtn").classList.toggle("hidden", !running);
  $("stopBtn").disabled = stopRequested;
  $("stopBtn").textContent = stopRequested ? "중지하는 중..." : "중지";
  $("runNotice").classList.toggle("hidden", !running);
}

$("audioInput").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };

// ---------- 화면 꺼짐 방지 ----------

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* 지원하지 않는 브라우저 */ }
}
document.addEventListener("visibilitychange", () => {
  if (running && document.visibilityState === "visible") keepAwake(true);
});
window.addEventListener("beforeunload", (e) => { if (running) { e.preventDefault(); e.returnValue = ""; } });

// 경계 근처 오디오를 디코딩해 말이 멈춘 지점을 찾는 데 쓴다(실패하면 core가 25분 간격 그대로 자른다)
async function decode(bytes) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error("이 브라우저는 오디오 디코딩을 지원하지 않습니다");
  const ctx = new Ctx(1, 22050, 22050);
  const buffer = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
  const samples = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > Math.abs(samples[i])) samples[i] = data[i];
  }
  return { sampleRate: buffer.sampleRate, samples };
}

// ---------- 실행 ----------

async function start() {
  const apiKey = settings.get("apiKey", "");
  if (!apiKey) { showSetup(true); $("keyInput").focus(); return; }
  for (const q of queue) if (q.status === "error" || q.status === "stopped") Object.assign(q, { status: "pending", message: "대기 중" });
  running = true;
  stopRequested = false;
  renderQueue();
  keepAwake(true);
  const gemini = new core.Gemini(apiKey);
  let item;
  while (!stopRequested && (item = queue.find((q) => q.status === "pending"))) {
    Object.assign(item, { status: "running", message: "준비 중...", done: 0, total: 0 });
    renderQueue();
    log(`=== 시작: ${item.file.name} ===`);
    log(item.pdf ? `강의 PDF: ${item.pdf.name}` : "강의 PDF: 없음");
    try {
      item.record = await core.transcribeLecture({
        file: item.file, pdf: item.pdf, gemini, model: $("model").value, makeNotes: $("notes").checked,
        store: db, decode, log: (m) => { log(m); if (item.status === "running") { item.message = m.trim(); renderQueue(); } },
        progress: (done, total) => { Object.assign(item, { done, total }); renderQueue(); },
        shouldStop: () => stopRequested,
      });
      const warnings = [item.record.incomplete && `덜 전사된 구간 ${item.record.incomplete}개`, item.record.blocked && `막힌 대목 ${item.record.blocked}곳`].filter(Boolean);
      Object.assign(item, { status: "done", message: "완료" + (warnings.length ? ` (주의: ${warnings.join(", ")} — 결과에 표시됨)` : "") });
      log(`완료: ${item.record.name}`);
    } catch (e) {
      if (e instanceof core.Cancelled) {
        Object.assign(item, { status: "stopped", message: "중지됨 — 다시 시작하면 끝난 구간은 건너뛰고 이어서 합니다" });
        log("중지했습니다.");
      } else {
        Object.assign(item, { status: "error", message: `오류: ${e.message} — 다시 시작하면 끝난 구간은 건너뜁니다` });
        log(`오류: ${e.message}`);
        if (e instanceof core.GeminiError) {
          // 크레딧 소진·잘못된 키처럼 다음 파일도 어차피 실패할 오류: 대기 중인 파일은 그대로 두고 멈춘다
          log("이 오류는 다른 파일도 똑같이 실패하므로, 나머지는 대기 상태로 두고 멈춥니다. 해결한 뒤 '전사 시작'을 누르세요.");
          renderQueue();
          renderHistory();
          break;
        }
      }
    }
    renderQueue();
    renderHistory();
  }
  running = false;
  stopRequested = false;
  keepAwake(false);
  renderQueue();
}

$("startBtn").onclick = start;
$("stopBtn").onclick = () => {
  stopRequested = true;
  log("중지 요청: 지금 전사 중인 구간이 끝나면 멈춥니다(몇 분 걸릴 수 있습니다).");
  renderQueue();
};

// ---------- 저장된 결과 ----------

async function renderHistory() {
  let records = [];
  try { records = (await db.all()).filter((r) => r.merged).sort((a, b) => b.updatedAt - a.updatedAt); }
  catch (e) { log(`저장된 결과를 읽지 못했습니다: ${e.message}`); }
  const ul = $("history");
  ul.replaceChildren();
  for (const record of records) {
    const li = document.createElement("li");
    li.className = "item";
    li.append(
      Object.assign(document.createElement("div"), { className: "name", textContent: record.topic || record.fileName }),
      Object.assign(document.createElement("div"), {
        className: "muted small", textContent: `${record.fileName} · ${new Date(record.updatedAt).toLocaleString("ko-KR")}`,
      }),
    );
    const last = (record.usageLog || []).at(-1);
    if (last) {
      // 마지막으로 처리할 때 쓴 토큰(어디에 많이 쓰는지 볼 수 있게)
      li.append(Object.assign(document.createElement("div"), {
        className: "muted small", textContent: `마지막 처리 토큰(${last.model}): ${core.describeUsage(last)}`,
      }));
    }
    const { row, add } = resultButtons(record);
    add("삭제", async () => {
      if (!confirm(`"${record.name}" 결과를 이 휴대폰에서 지울까요? (되돌릴 수 없습니다)`)) return;
      await db.del(record.key);
      renderHistory();
    }, "danger");
    li.append(row);
    ul.append(li);
  }
  $("historyEmpty").classList.toggle("hidden", records.length > 0);
}

// ---------- 설정 ----------

function showSetup(show) { $("setupCard").classList.toggle("hidden", !show); }
$("keyBtn").onclick = () => { showSetup($("setupCard").classList.contains("hidden")); $("keyInput").value = ""; };
$("keySave").onclick = () => {
  const key = $("keyInput").value.trim();
  if (!key) return;
  settings.set("apiKey", key);
  $("keyInput").value = "";
  showSetup(false);
  log("API 키를 저장했습니다.");
};

for (const m of core.MODELS) $("model").append(new Option(m, m));
$("model").value = settings.get("model", core.DEFAULT_MODEL);
if (!$("model").value) $("model").value = core.DEFAULT_MODEL;
$("model").onchange = () => settings.set("model", $("model").value);
$("notes").checked = settings.get("makeNotes", "0") === "1";
$("notes").onchange = () => settings.set("makeNotes", $("notes").checked ? "1" : "0");

showSetup(!settings.get("apiKey", ""));
renderQueue();
renderHistory();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
