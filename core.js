// 휴대폰 전사 웹앱의 로직(화면 없음). gemini_transcribe.py와 m4a_split.py를 브라우저용으로 옮긴 것이다.
// 화면(app.js)과 Node 테스트(test_core.mjs)가 함께 쓴다. 규칙·프롬프트를 바꿀 때는 파이썬 쪽과 같이 바꿀 것.
//
// 전송되는 데이터: 녹음 조각(과 고른 강의 PDF)을 Google Gemini API로 직접 보낸다. 그 밖의 서버는 거치지 않는다.

export const DEFAULT_MODEL = "gemini-flash-latest";
export const MODELS = [DEFAULT_MODEL, "gemini-pro-latest", "gemini-4-argon", "gemini-4-hydrogen"];
export const DEFAULT_CHUNK_MINUTES = 25;
export const MAX_ATTEMPTS = 5;
export const SILENCE_SEARCH_SECONDS = 30;
export const END_TOLERANCE_SECONDS = 90;
export const MAX_CONTINUATIONS = 2;
export const EMPTY_RESPONSE_ATTEMPTS = 2;
export const SUBDIVIDE_SECONDS = [300, 60];
export const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_CIVIC_INTEGRITY",
];
// 테스트에서 기다리는 시간을 없애려고 바꿀 수 있게 객체로 둔다
export const timing = {
  retryBaseSeconds: 15, // 재시도 간격: 15초, 30초, 60초, 120초
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs: 2000,
};

export const PROMPT =
  "첨부한 음성은 한국어·영어 혼용 의학 강의의 일부 구간입니다. " +
  "이 음성을 처음부터 끝까지 요약 없이 전사해 주세요.\n\n" +
  "한국어 설명은 한국어로, 영어 의학용어는 영어 철자로 기록하세요. " +
  "{pdf_rule}음성에 없는 내용을 추가하지 마세요.\n\n" +
  "약물명·수치·단위·부정 표현을 정확하게 보존하고, 안 들리는 부분은 추측하지 말고 " +
  "[청취 불명확]으로 표시하세요. 구간의 시작이나 끝에서 문장이 잘려 있으면 들리는 부분만 그대로 적으세요.\n\n" +
  "문단마다 맨 앞에 이 음성 파일 기준의 대략적인 시작 시간을 [MM:SS] 형식으로 표시하세요. " +
  "마지막 줄에는 '마지막 전사 위치: [MM:SS]' 형식으로 마지막으로 전사한 위치를 적어 주세요. " +
  "전사문 외의 인사말이나 설명은 쓰지 마세요.";
export const PDF_RULE = "강의 PDF는 용어 철자 확인에만 참고하고, ";
// 강의 PDF를 구간마다 통째로 보내는 대신, 처음 한 번만 보내 용어 목록을 뽑고 그 목록(텍스트)만 구간마다 보낸다
export const GLOSSARY_RULE = "아래 '강의 용어 목록'은 강의 PDF에서 뽑은 것으로 용어 철자 확인에만 참고하고, ";
export const GLOSSARY_BLOCK = "\n\n--- 강의 용어 목록 ---\n{glossary}\n--- 끝 ---";
export const GLOSSARY_PROMPT =
  "첨부한 강의 PDF에 나오는 영어 의학용어, 약물명, 약어, 질환·검사·사람 이름 같은 고유명사를 철자 그대로 뽑아 주세요.\n" +
  "- 한 줄에 하나씩, 중복 없이, 번호나 설명 없이 목록만 출력하세요.\n" +
  "- 일반적인 영어 단어는 빼고 강의 내용과 관련된 전문 용어만 넣으세요.";
export const GLOSSARY_MAX_CHARS = 6000;
// 받아 적기에는 깊은 추론이 필요 없다. 생각(thinking) 토큰은 출력 요금이라 '낮음'으로 요청한다(거절하는 모델은 설정 없이)
export const THINKING_LEVEL = "low";
export const TAIL_OVERLAP_SECONDS = 10;
export const TAIL_EXCERPT_CHARS = 400;
export const NO_MORE_SPEECH = "[이후 음성 없음]";
export const TOPIC_PROMPT =
  "다음은 한국어·영어 혼용 의학 강의의 전사문입니다. 이 강의의 주제를 짧은 제목 하나로 정해 주세요.\n" +
  "- 한국어로 20자 안팎, 영어 의학용어는 영어 철자 그대로\n" +
  "- 제목 한 줄만 출력하고, 따옴표·마침표·'주제:' 같은 머리말이나 설명은 쓰지 마세요\n\n" +
  "--- 전사문 ---\n{transcript}\n--- 끝 ---";
export const TOPIC_TRANSCRIPT_CHARS = 12000;
export const NOTES_PROMPT =
  "다음은 한국어·영어 혼용 의학 강의의 전사문입니다. 이 전사문으로 의대생 복습용 노트를 만들어 주세요.\n\n" +
  "규칙:\n" +
  "- 전사문에 있는 내용만 쓰세요. 전사문에 없는 지식·수치·설명을 덧붙이지 마세요.\n" +
  "- 약물명·수치·단위·부정 표현은 전사문 그대로 옮기세요. 영어 의학용어는 영어 철자로 쓰세요.\n" +
  "- [청취 불명확]이나 전사되지 못한 부분을 추측해 채우지 마세요.\n" +
  "- 각 항목 끝에 근거가 된 전사문의 시간을 [MM:SS] (1시간 넘으면 [H:MM:SS]) 형식으로 붙이세요.\n\n" +
  "아래 순서와 제목으로, 간단한 마크다운(#, -)만 써서 작성하세요:\n" +
  "# 한눈에 보기\n강의 핵심을 5~10줄로.\n" +
  "# 주제별 정리\n강의 흐름대로 소제목(##)을 나누고 글머리표로 정리.\n" +
  "# 시험 포인트\n교수가 강조한 내용('중요', '시험', '꼭', '외우세요' 등)과 자주 반복한 내용. " +
  "강조 표현이 없으면 그렇게 적으세요.\n" +
  "# 용어 정리\n강의에 나온 주요 영어 의학용어 — 강의에서 설명한 뜻.\n" +
  "# 확인이 필요한 부분\n[청취 불명확] 등 원본 녹음으로 확인해야 할 곳의 시간. 없으면 '없음'.\n\n" +
  "노트 외의 인사말이나 설명은 쓰지 마세요.\n\n" +
  "--- 전사문 ---\n{transcript}\n--- 끝 ---";
export const CONTINUE_PROMPT =
  "\n\n이 음성은 [{position}] 지점까지 이미 전사했습니다. [{position}] 이후부터 끝까지만 같은 규칙으로 이어서 " +
  "전사하고, 그 이전 내용은 다시 쓰지 마세요. [{position}] 이후에 말소리가 전혀 없으면 " +
  NO_MORE_SPEECH + " 한 줄만 출력하세요.";
// 끊긴 지점 근처부터 잘라 낸 뒷부분 음성만 보낼 때(구간 전체를 다시 보내지 않아 토큰 절약)
export const CONTINUE_TAIL_PROMPT =
  "\n\n이 음성은 이미 전사한 부분에 이어지는 뒷부분입니다. 맨 앞 몇 초는 이미 전사한 내용과 겹치니, " +
  "아래 '이미 전사한 마지막 부분' 다음 내용부터 같은 규칙으로 이어서 전사하세요. 시간은 이 음성 파일 기준으로 " +
  "표시하세요. 이어서 전사할 말소리가 전혀 없으면 " + NO_MORE_SPEECH + " 한 줄만 출력하세요.\n" +
  "--- 이미 전사한 마지막 부분 ---\n{excerpt}\n--- 끝 ---";

const TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]/g;
const LAST_POSITION_LINE_RE = /^.*마지막 전사 위치.*$\n?/gm;
const FILENAME_UNSAFE_RE = /[\\/:*?"<>|\r\n\t]+/g;

export class Cancelled extends Error {
  constructor() { super("중지했습니다."); this.name = "Cancelled"; }
}

export class BlockedResponse extends Error {
  constructor(reason) {
    super(`Gemini가 본문 없는 응답만 돌려줬습니다. (${reason})`);
    this.reason = reason;
  }
}

export class UnsupportedAudio extends Error {}

export class ApiError extends Error {
  constructor(code, status, message) {
    super(`Gemini API 오류 ${code || "(네트워크)"} ${status || ""}: ${message}`.trim());
    this.code = code; // HTTP 상태 코드. 네트워크 오류(연결 끊김 등)는 0
    this.status = status;
  }
}

// ---------- 시간 표시 ----------

const pad = (n) => String(n).padStart(2, "0");

export function formatTimestamp(totalSeconds) {
  const s = Math.trunc(totalSeconds);
  const hours = Math.floor(s / 3600), minutes = Math.floor((s % 3600) / 60), seconds = s % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function toSeconds(first, second, third) {
  return third === undefined ? +first * 60 + +second : +first * 3600 + +second * 60 + +third;
}

// 조각 기준 [MM:SS]에 조각 시작 시각을 더해 전체 강의 기준으로 옮긴다(덧셈을 모델에게 시키지 않는다)
export function shiftTimestamps(text, offsetSeconds) {
  return text.replace(TIMESTAMP_RE, (m, a, b, c) => `[${formatTimestamp(toSeconds(a, b, c) + offsetSeconds)}]`);
}

export function lastPosition(text) {
  const matches = [...text.matchAll(TIMESTAMP_RE)];
  if (!matches.length) return null;
  const m = matches[matches.length - 1];
  return toSeconds(m[1], m[2], m[3]);
}

export const stripLastPositionLines = (text) => text.replace(LAST_POSITION_LINE_RE, "");

export function buildPrompt(hasPdf, continueFrom = null, glossary = null, continueExcerpt = null) {
  const rule = glossary ? GLOSSARY_RULE : hasPdf ? PDF_RULE : "";
  let prompt = PROMPT.replace("{pdf_rule}", rule);
  if (continueExcerpt !== null) prompt += CONTINUE_TAIL_PROMPT.replace("{excerpt}", () => continueExcerpt);
  else if (continueFrom !== null) prompt += CONTINUE_PROMPT.replaceAll("{position}", formatTimestamp(continueFrom));
  if (glossary) prompt += GLOSSARY_BLOCK.replace("{glossary}", () => glossary);
  return prompt;
}

// 모델이 뽑은 용어 목록에서 글머리표·번호를 떼고 중복을 없애, 한 줄에 하나씩 maxChars 안으로 자른다
export function cleanGlossary(text, maxChars = GLOSSARY_MAX_CHARS) {
  const terms = [], seen = new Set();
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^[-=_*\s]*$/.test(line)) continue; // 빈 줄, '---' 같은 구분선
    const term = line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim().replace(/^[`*]+|[`*]+$/g, "");
    if (!term || seen.has(term.toLowerCase())) continue;
    if (total + term.length + 1 > maxChars) break;
    seen.add(term.toLowerCase());
    terms.push(term);
    total += term.length + 1;
  }
  return terms.join("\n");
}

export const chunkHeader = (start, end) => `===== ${formatTimestamp(start)} ~ ${formatTimestamp(end)} =====`;

export function cleanTopic(text, maxLength = 40) {
  let line = (text.split(/\r?\n/).map((l) => l.trim()).find((l) => l) || "");
  line = line.replace(/^(주제|제목|topic|title)\s*[:：]\s*/i, "");
  line = line.replace(/^[ "'“”‘’「」『』#*]+|[ "'“”‘’「」『』#*]+$/g, "");
  line = line.replace(FILENAME_UNSAFE_RE, " ").replace(/\s+/g, " ").trim();
  line = Array.from(line).slice(0, maxLength).join("").trim();
  return line.replace(/[. ]+$/, ""); // Windows는 끝이 점이나 공백인 파일 이름을 허용하지 않는다
}

// ---------- 오디오(m4a/aac) 분할: m4a_split.py를 옮긴 것 ----------

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const ascii = (b, s, e) => String.fromCharCode(...b.subarray(s, e));
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

// 파일 전체를 메모리에 올리지 않도록, 필요한 부분만 잘라 읽는다(휴대폰 메모리 절약)
export function blobSource(blob) {
  return {
    size: blob.size,
    read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()),
  };
}

async function readMoov(source) {
  let pos = 0;
  while (pos + 8 <= source.size) {
    const h = await source.read(pos, Math.min(pos + 16, source.size));
    const dv = view(h);
    let size = dv.getUint32(0), header = 8;
    const type = ascii(h, 4, 8);
    if (size === 1) {
      if (h.length < 16) break;
      size = Number(dv.getBigUint64(8));
      header = 16;
    } else if (size === 0) size = source.size - pos;
    if (size < header) break;
    if (type === "moov") return source.read(pos + header, pos + size);
    pos += size;
  }
  throw new UnsupportedAudio("m4a 파일 구조(moov)를 찾을 수 없습니다.");
}

function children(data) {
  const boxes = [], dv = view(data);
  let pos = 0;
  while (pos + 8 <= data.length) {
    let size = dv.getUint32(pos), header = 8;
    const type = ascii(data, pos + 4, pos + 8);
    if (size === 1) { size = Number(dv.getBigUint64(pos + 8)); header = 16; } else if (size === 0) size = data.length - pos;
    if (size < header) break;
    boxes.push([type, data.subarray(pos + header, pos + size)]);
    pos += size;
  }
  return boxes;
}

function find(data, ...path) {
  for (const name of path) {
    const hit = children(data).find(([type]) => type === name);
    if (!hit) return null;
    data = hit[1];
  }
  return data;
}

function descriptor(data, pos) {
  const tag = data[pos++];
  let length = 0;
  for (let i = 0; i < 4; i++) {
    const byte = data[pos++];
    length = (length << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return [tag, pos, length];
}

function indexOfBytes(data, text) {
  outer: for (let i = 0; i + text.length <= data.length; i++) {
    for (let j = 0; j < text.length; j++) if (data[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

function audioConfig(stsd) {
  if (ascii(stsd, 12, 16) !== "mp4a") throw new UnsupportedAudio(`AAC가 아닌 오디오 형식입니다(${ascii(stsd, 12, 16)}).`);
  const marker = indexOfBytes(stsd, "esds");
  if (marker < 0) throw new UnsupportedAudio("AAC 설정 정보(esds)를 찾을 수 없습니다.");
  let pos = marker + 8, tag, length;
  [tag, pos] = descriptor(stsd, pos);
  if (tag !== 0x03) throw new UnsupportedAudio("AAC 설정 정보를 해석할 수 없습니다.");
  const flags = stsd[pos + 2];
  pos += 3;
  if (flags & 0x80) pos += 2;
  if (flags & 0x40) pos += 1 + stsd[pos];
  if (flags & 0x20) pos += 2;
  [tag, pos] = descriptor(stsd, pos);
  if (tag !== 0x04) throw new UnsupportedAudio("AAC 설정 정보를 해석할 수 없습니다.");
  pos += 13;
  [tag, pos, length] = descriptor(stsd, pos);
  if (tag !== 0x05 || length < 2) throw new UnsupportedAudio("AAC 설정 정보를 해석할 수 없습니다.");
  const bits = view(stsd).getUint16(pos);
  const objectType = bits >> 11, rateIndex = (bits >> 7) & 0x0f, channels = (bits >> 3) & 0x0f;
  if (objectType !== 2) throw new UnsupportedAudio(`AAC-LC가 아닌 AAC 형식입니다(object type ${objectType}).`);
  if (rateIndex >= SAMPLE_RATES.length || channels < 1 || channels > 7) {
    throw new UnsupportedAudio("지원하지 않는 샘플레이트/채널 구성입니다.");
  }
  return { objectType, rateIndex, channels };
}

function sampleTable(stbl) {
  const stsz = find(stbl, "stsz"), stsc = find(stbl, "stsc"), stts = find(stbl, "stts");
  const stco = find(stbl, "stco"), co64 = find(stbl, "co64");
  if (!(stsz && stsc && stts && (stco || co64))) throw new UnsupportedAudio("샘플 테이블을 찾을 수 없습니다.");
  const sz = view(stsz);
  const uniform = sz.getUint32(4), count = sz.getUint32(8);
  if (count === 0) throw new UnsupportedAudio("조각난(fragmented) mp4는 지원하지 않습니다.");
  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i++) sizes[i] = uniform || sz.getUint32(12 + 4 * i);

  const chunkOffsets = [];
  if (stco) {
    const dv = view(stco), n = dv.getUint32(4);
    for (let i = 0; i < n; i++) chunkOffsets.push(dv.getUint32(8 + 4 * i));
  } else {
    const dv = view(co64), n = dv.getUint32(4);
    for (let i = 0; i < n; i++) chunkOffsets.push(Number(dv.getBigUint64(8 + 8 * i)));
  }

  const sc = view(stsc), entryCount = sc.getUint32(4);
  const entries = [];
  for (let i = 0; i < entryCount; i++) entries.push([sc.getUint32(8 + 12 * i), sc.getUint32(12 + 12 * i)]);
  const offsets = new Float64Array(count);
  let sample = 0;
  for (let i = 0; i < entries.length; i++) {
    const [firstChunk, perChunk] = entries[i];
    const lastChunk = i + 1 < entries.length ? entries[i + 1][0] - 1 : chunkOffsets.length;
    for (let chunk = firstChunk; chunk <= lastChunk; chunk++) {
      let position = chunkOffsets[chunk - 1];
      for (let k = 0; k < perChunk && sample < count; k++) {
        offsets[sample] = position;
        position += sizes[sample];
        sample++;
      }
    }
  }
  if (sample !== count) throw new UnsupportedAudio("샘플 테이블이 일관되지 않습니다.");

  const ts = view(stts), sttsCount = ts.getUint32(4);
  const elapsed = new Float64Array(count + 1); // 각 프레임의 시작 시각(타임스케일 단위), 마지막은 전체 길이
  let index = 0;
  for (let i = 0; i < sttsCount; i++) {
    const n = ts.getUint32(8 + 8 * i), delta = ts.getUint32(12 + 8 * i);
    if (index + n > count) throw new UnsupportedAudio("샘플 길이 정보가 일관되지 않습니다.");
    for (let k = 0; k < n; k++, index++) elapsed[index + 1] = elapsed[index] + delta;
  }
  if (index !== count) throw new UnsupportedAudio("샘플 길이 정보가 일관되지 않습니다.");
  return { offsets, sizes, elapsed };
}

function adtsHeader(c, frameSize) {
  const length = frameSize + 7;
  return [
    0xff, 0xf1,
    ((c.objectType - 1) << 6) | (c.rateIndex << 2) | (c.channels >> 2),
    ((c.channels & 3) << 6) | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc,
  ];
}

async function m4aTrack(source) {
  const moov = await readMoov(source);
  let mdia = null;
  for (const [type, trak] of children(moov)) {
    if (type !== "trak") continue;
    const hdlr = find(trak, "mdia", "hdlr");
    if (hdlr && ascii(hdlr, 8, 12) === "soun") { mdia = find(trak, "mdia"); break; }
  }
  if (!mdia) throw new UnsupportedAudio("오디오 트랙을 찾을 수 없습니다.");
  const mdhd = find(mdia, "mdhd"), stbl = find(mdia, "minf", "stbl");
  const stsd = stbl ? find(stbl, "stsd") : null;
  if (!(mdhd && stsd)) throw new UnsupportedAudio("오디오 트랙 정보를 읽을 수 없습니다.");
  const timescale = view(mdhd).getUint32(mdhd[0] === 1 ? 20 : 12);
  return { adts: false, timescale, config: audioConfig(stsd), ...sampleTable(stbl) };
}

async function adtsTrack(source) {
  const data = await source.read(0, source.size);
  const offsets = [], sizes = [];
  let pos = 0, rate = 0;
  while (pos + 7 <= data.length && data[pos] === 0xff && (data[pos + 1] & 0xf0) === 0xf0) {
    rate = SAMPLE_RATES[(data[pos + 2] >> 2) & 0x0f];
    const length = ((data[pos + 3] & 3) << 11) | (data[pos + 4] << 3) | (data[pos + 5] >> 5);
    if (length < 7) break;
    offsets.push(pos);
    sizes.push(length);
    pos += length;
  }
  if (!offsets.length || !rate) throw new UnsupportedAudio("AAC(ADTS) 파일을 읽을 수 없습니다.");
  const elapsed = new Float64Array(offsets.length + 1);
  for (let i = 0; i < offsets.length; i++) elapsed[i + 1] = elapsed[i] + 1024;
  return { adts: true, timescale: rate, config: null, offsets: Float64Array.from(offsets), sizes: Uint32Array.from(sizes), elapsed };
}

// 녹음 파일의 오디오 프레임 목록을 읽는다(AAC-LC m4a, 또는 ADTS .aac)
export async function loadTrack(source) {
  const head = await source.read(0, Math.min(2, source.size));
  const track = head[0] === 0xff && (head[1] & 0xf0) === 0xf0 ? await adtsTrack(source) : await m4aTrack(source);
  track.count = track.sizes.length;
  track.duration = track.elapsed[track.count] / track.timescale;
  return track;
}

// seconds 시각 이후 첫 프레임 번호
export function frameAt(track, seconds) {
  const target = seconds * track.timescale;
  let lo = 0, hi = track.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track.elapsed[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// 프레임 [startFrame, endFrame)을 재인코딩 없이 ADTS(.aac) 바이트로 만든다(음질 손실 없음)
export async function buildAdts(track, source, startFrame, endFrame) {
  let lo = Infinity, hi = 0, total = 0;
  for (let i = startFrame; i < endFrame; i++) {
    lo = Math.min(lo, track.offsets[i]);
    hi = Math.max(hi, track.offsets[i] + track.sizes[i]);
    total += track.sizes[i] + (track.adts ? 0 : 7);
  }
  if (endFrame <= startFrame) return new Uint8Array(0);
  const raw = await source.read(lo, hi);
  const out = new Uint8Array(total);
  let pos = 0;
  for (let i = startFrame; i < endFrame; i++) {
    const at = track.offsets[i] - lo, size = track.sizes[i];
    if (!track.adts) { out.set(adtsHeader(track.config, size), pos); pos += 7; }
    out.set(raw.subarray(at, at + size), pos);
    pos += size;
  }
  return out;
}

export const frameTime = (track, frame) => track.elapsed[frame] / track.timescale;

// 자를 시각(초)들로 조각 목록을 만든다. start는 전체 기준 시작(초, 반올림), duration은 실제 길이
export function planChunks(track, cutTimes, fromFrame = 0, toFrame = track.count, origin = 0) {
  const bounds = [fromFrame];
  for (const t of cutTimes) {
    const f = Math.min(Math.max(frameAt(track, t), fromFrame), toFrame);
    if (f > bounds[bounds.length - 1] && f < toFrame) bounds.push(f);
  }
  bounds.push(toFrame);
  const chunks = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const startTime = frameTime(track, bounds[i]);
    chunks.push({
      startFrame: bounds[i], endFrame: bounds[i + 1],
      start: Math.round(startTime - origin),
      duration: frameTime(track, bounds[i + 1]) - startTime,
    });
  }
  return chunks;
}

export function chooseCutPoints(silences, duration, chunkSeconds, searchSeconds = SILENCE_SEARCH_SECONDS) {
  const midpoints = silences.map(([s, e]) => (s + e) / 2);
  const cuts = [];
  for (let target = chunkSeconds; target < duration - searchSeconds; target += chunkSeconds) {
    const nearby = midpoints.filter((m) => Math.abs(m - target) <= searchSeconds);
    cuts.push(nearby.length ? nearby.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : target);
  }
  return cuts;
}

// ffmpeg silencedetect(noise=-30dB, d=0.4)과 같은 방식: 진폭이 기준 아래로 0.4초 넘게 머문 구간
export function findSilences(samples, sampleRate, noiseDb = -30, minSeconds = 0.4) {
  const threshold = 10 ** (noiseDb / 20), minSamples = Math.ceil(minSeconds * sampleRate);
  const silences = [];
  let runStart = -1;
  for (let i = 0; i <= samples.length; i++) {
    const quiet = i < samples.length && Math.abs(samples[i]) < threshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      if (i - runStart >= minSamples) silences.push([runStart / sampleRate, i / sampleRate]);
      runStart = -1;
    }
  }
  return silences;
}

// 25분 경계마다 앞뒤 30초만 디코딩해 말이 멈춘 지점을 찾는다(문장 중간에서 잘리는 것을 줄인다).
// decode(adtsBytes) → {sampleRate, samples}. 디코딩을 못 하면 경계에서 그대로 자른다.
export async function findCutTimes(track, source, chunkSeconds, decode, log = () => {}) {
  const targets = chooseCutPoints([], track.duration, chunkSeconds);
  if (!decode || !targets.length) return targets;
  const silences = [];
  for (const target of targets) {
    const from = frameAt(track, Math.max(0, target - SILENCE_SEARCH_SECONDS - 1));
    const to = frameAt(track, target + SILENCE_SEARCH_SECONDS + 1);
    try {
      const { sampleRate, samples } = await decode(await buildAdts(track, source, from, to));
      const offset = frameTime(track, from);
      for (const [s, e] of findSilences(samples, sampleRate)) silences.push([s + offset, e + offset]);
    } catch (e) {
      log(`말이 멈춘 지점을 찾지 못해 ${chunkSeconds / 60}분 간격 그대로 자릅니다. (${e.message || e})`);
      return targets;
    }
  }
  return chooseCutPoints(silences, track.duration, chunkSeconds);
}

// ---------- Gemini API (REST, 브라우저에서 직접 호출) ----------

const API = "https://generativelanguage.googleapis.com";

export class Gemini {
  constructor(apiKey, fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async _request(url, options = {}) {
    let res;
    try {
      res = await this.fetch(url, { ...options, headers: { "x-goog-api-key": this.apiKey, ...(options.headers || {}) } });
    } catch (e) {
      throw new ApiError(0, "NETWORK", `인터넷 연결 문제로 요청이 실패했습니다 (${e.message || e})`);
    }
    if (!res.ok) {
      let status = "", message = res.statusText || "";
      try {
        const body = await res.json();
        status = body.error?.status || "";
        message = body.error?.message || message;
      } catch { /* 본문이 JSON이 아님 */ }
      throw new ApiError(res.status, status, message);
    }
    return res;
  }

  // Files API 업로드(재개 가능 업로드 프로토콜: 시작 요청 → 받은 주소로 본문 전송)
  async upload(data, mimeType, displayName) {
    const size = data.byteLength ?? data.size;
    const start = await this._request(`${API}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(size),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new ApiError(0, "UPLOAD", "업로드 주소를 받지 못했습니다.");
    const res = await this._request(uploadUrl, {
      method: "POST",
      headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
      body: data,
    });
    let file = (await res.json()).file;
    while (file.state === "PROCESSING") {
      await timing.sleep(timing.pollMs);
      file = await (await this._request(`${API}/v1beta/${file.name}`)).json();
    }
    if (file.state === "FAILED") throw new Error("Gemini가 파일 처리에 실패했습니다.");
    return file;
  }

  async deleteFile(name) {
    try { await this._request(`${API}/v1beta/${name}`, { method: "DELETE" }); } catch { /* 48시간 뒤 자동 삭제됨 */ }
  }

  async generate(model, parts, log = () => {}) {
    const body = {
      contents: [{ role: "user", parts }],
      // 의학 강의는 질병·약물 이야기가 많아 기본 안전 필터에 잘못 걸릴 수 있어, 조절 가능한 필터는 끈다
      safetySettings: SAFETY_CATEGORIES.map((category) => ({ category, threshold: "BLOCK_NONE" })),
    };
    if (!noThinkingConfig.has(model)) body.generationConfig = { thinkingConfig: { thinkingLevel: THINKING_LEVEL } };
    try {
      const res = await this._request(`${API}/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return res.json();
    } catch (e) {
      if (e instanceof ApiError && e.code === 400 && /thinking/i.test(e.message) && body.generationConfig) {
        // 생각 수준 설정을 모르는 모델: 그 모델에는 설정 없이 다시 보낸다
        noThinkingConfig.add(model);
        log(`  ${model} 모델은 생각 줄이기 설정을 받지 않아, 기본 설정으로 다시 보냅니다.`);
        return this.generate(model, parts, log);
      }
      throw e;
    }
  }
}

export const noThinkingConfig = new Set(); // 생각 수준 설정을 거절한 모델들

export class GeminiError extends Error {} // 사용자가 직접 해결해야 하는 오류(크레딧 소진, 잘못된 키 등)

// API 오류를 사용자가 알아듣기 쉬운 한국어 오류로 바꾼다. 해당하지 않으면 그대로 돌려준다
export function friendlyApiError(e) {
  if (!(e instanceof ApiError)) return e;
  const text = e.message;
  if (e.code === 402 || /prepayment credits/i.test(text)) {
    return new GeminiError("Gemini API 선불 크레딧이 다 떨어졌습니다. Google AI Studio의 결제(Billing)에서 충전한 뒤 " +
      "다시 시도하세요. 끝난 구간은 저장돼 있어 이어서 진행합니다.");
  }
  if (e.code === 400 && /api key/i.test(text)) return new GeminiError("Gemini API 키가 올바르지 않습니다. 오른쪽 위 'API 키'로 다시 넣어 주세요.");
  if (e.code === 403) return new GeminiError(`이 API 키로는 이 요청을 할 권한이 없습니다(모델 이름이나 키의 프로젝트를 확인하세요). (${text})`);
  if (e.code === 404) return new GeminiError(`모델을 찾을 수 없습니다. 모델 이름을 확인하세요. (${text})`);
  if (e.code === 429) return new GeminiError(`요청 한도(할당량)를 넘었습니다. 잠시 뒤 다시 시도하세요. (${text})`);
  return e;
}

const filepart = (file) => ({ file_data: { mime_type: file.mimeType, file_uri: file.uri } });

function checkStop(shouldStop) {
  if (shouldStop && shouldStop()) throw new Cancelled();
}

// 서버 과부하(5xx)·요청 한도(429)·연결 끊김처럼 일시적인 오류일 때만 간격을 늘려 가며 다시 시도한다
async function withRetry(fn, log, shouldStop) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const transient = e instanceof ApiError && (e.code === 0 || e.code === 429 || e.code >= 500);
      if (!transient || attempt === MAX_ATTEMPTS) throw friendlyApiError(e);
      const wait = timing.retryBaseSeconds * 2 ** (attempt - 1);
      log(`  일시적 오류(${e.code || "연결"} ${e.status}), ${wait}초 뒤 재시도합니다. (${attempt}/${MAX_ATTEMPTS - 1})`);
      for (let i = 0; i < wait; i++) { checkStop(shouldStop); await timing.sleep(1000); }
    }
  }
}

export const newUsage = () => ({ input: 0, output: 0, audio: 0, thoughts: 0, requests: 0 });

function addUsage(usage, response) {
  const meta = response.usageMetadata;
  if (!meta) return;
  const thoughts = meta.thoughtsTokenCount || 0;
  usage.input += meta.promptTokenCount || 0;
  usage.output += (meta.candidatesTokenCount || 0) + thoughts;
  usage.thoughts += thoughts;
  usage.requests += 1;
  for (const d of meta.promptTokensDetails || []) if (/AUDIO$/i.test(d.modality || "")) usage.audio += d.tokenCount || 0;
}

// '입력 X / 출력 Y (음성 a, 생각 b, 요청 n번)' 형태의 한 줄 요약
export function describeUsage(u) {
  const details = [];
  if (u.audio) details.push(`음성 ${u.audio.toLocaleString()}`);
  if (u.thoughts) details.push(`생각 ${u.thoughts.toLocaleString()}`);
  if (u.requests) details.push(`요청 ${u.requests}번`);
  return `입력 ${u.input.toLocaleString()} / 출력 ${u.output.toLocaleString()}` + (details.length ? ` (${details.join(", ")})` : "");
}

export function responseText(response) {
  const candidate = (response.candidates || [])[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  return [text, candidate?.finishReason === "MAX_TOKENS"];
}

export function describeEmptyResponse(response) {
  const details = [];
  const finish = (response.candidates || [])[0]?.finishReason;
  details.push(finish ? `종료 사유 ${finish}` : "종료 사유 없음(후보 응답 없음)");
  const block = response.promptFeedback?.blockReason;
  if (block) details.push(`입력 차단 사유 ${block}`);
  const meta = response.usageMetadata;
  if (meta) {
    details.push(`생각 토큰 ${(meta.thoughtsTokenCount || 0).toLocaleString()}, ` +
      `본문 토큰 ${(meta.candidatesTokenCount || 0).toLocaleString()}`);
  }
  if (finish === "RECITATION") details.push("→ 기존 저작물과 겹친다고 판단해 출력을 막은 경우입니다");
  else if (block === "OTHER") details.push("→ Gemini가 구체적인 사유를 밝히지 않고 요청을 막은 경우입니다");
  else if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finish) || block) {
    details.push("→ 안전 필터가 출력을 막은 경우입니다");
  } else if (finish === "MAX_TOKENS") details.push("→ 출력 한도를 본문을 쓰기 전에 다 쓴 경우입니다");
  return details.join(", ");
}

// ---------- 구간 전사 ----------

// ctx: {gemini, model, log, shouldStop, usage, track, source}
const uploadAudio = (ctx, bytes) => withRetry(
  () => ctx.gemini.upload(new Blob([bytes], { type: "audio/aac" }), "audio/aac", "chunk.aac"), ctx.log, ctx.shouldStop);

// ctx.glossary가 있으면 PDF 대신 그 용어 목록을 철자 참고용으로 붙인다
export async function transcribeChunk(ctx, chunk, pdfFile) {
  const { gemini, model, log, shouldStop, usage } = ctx;
  const glossary = ctx.glossary || null;
  const bytes = await buildAdts(ctx.track, ctx.source, chunk.startFrame, chunk.endFrame);
  log(`  오디오 업로드 중... (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
  const audio = await uploadAudio(ctx, bytes);
  try {
    const extra = pdfFile ? [pdfFile] : [];
    // 재시도할 때 오디오를 다시 올리지 않도록, 업로드는 한 번만 하고 전사 요청만 반복한다
    const request = async (audioFile = audio, continueFrom = null, continueExcerpt = null) => {
      const prompt = buildPrompt(!!pdfFile, continueFrom, glossary, continueExcerpt);
      const response = await withRetry(
        () => gemini.generate(model, [...[audioFile, ...extra].map(filepart), { text: prompt }], log), log, shouldStop);
      addUsage(usage, response);
      return [...responseText(response), response];
    };
    // 끊긴 지점 조금 앞부터의 뒷부분만 보내 이어서 전사한다(구간 전체를 다시 보내지 않아 토큰 절약)
    const requestTail = async (position, textSoFar) => {
      const start = position - TAIL_OVERLAP_SECONDS;
      if (start <= 0) return null;
      const origin = frameTime(ctx.track, chunk.startFrame);
      const from = Math.max(frameAt(ctx.track, origin + start), chunk.startFrame);
      if (from >= chunk.endFrame) return null;
      const offset = frameTime(ctx.track, from) - origin;
      const tailBytes = await buildAdts(ctx.track, ctx.source, from, chunk.endFrame);
      log(`  ${formatTimestamp(offset)}부터 뒷부분 음성만 보냅니다. (${(tailBytes.length / 1024 / 1024).toFixed(1)} MB)`);
      const tailFile = await uploadAudio(ctx, tailBytes);
      try {
        const excerpt = stripLastPositionLines(textSoFar).trimEnd().slice(-TAIL_EXCERPT_CHARS);
        return [...(await request(tailFile, null, excerpt)), Math.round(offset)];
      } finally {
        await gemini.deleteFile(tailFile.name);
      }
    };

    log("  전사 요청 중... (구간당 몇 분 걸릴 수 있습니다)");
    let text, truncated, response;
    for (let attempt = 1; attempt <= EMPTY_RESPONSE_ATTEMPTS; attempt++) {
      [text, truncated, response] = await request();
      if (text) break;
      const reason = describeEmptyResponse(response);
      if (attempt === EMPTY_RESPONSE_ATTEMPTS) throw new BlockedResponse(reason);
      log(`  본문 없는 응답을 받아 다시 요청합니다. (${reason})`);
      checkStop(shouldStop);
    }

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
      const position = lastPosition(text);
      if (position === null || chunk.duration == null) {
        if (truncated) {
          log("  경고: 출력 길이 제한으로 전사가 중간에 끊겼는데, 어디까지 됐는지 알 수 없습니다.");
          return [text, false];
        }
        if (chunk.duration != null) log("  경고: 시간 표시가 없어 구간 끝까지 전사됐는지 확인하지 못했습니다.");
        return [text, true];
      }
      if (!truncated && position >= chunk.duration - END_TOLERANCE_SECONDS) return [text, true];
      if (attempt === MAX_CONTINUATIONS) break;

      log(`  ${formatTimestamp(position)}까지만 전사되어(구간 길이 ${formatTimestamp(chunk.duration)}) 그 뒤를 이어서 요청합니다.`);
      let more, offset = 0;
      try {
        checkStop(shouldStop);
        const tail = await requestTail(position, text);
        if (tail) [more, truncated, response, offset] = tail;
        else [more, truncated, response] = await request(audio, position);
      } catch (e) {
        if (e instanceof Cancelled) break; // 받은 앞부분은 '덜 끝난 구간'으로 저장되게 한다
        throw e;
      }
      if (!more) { log(`  이어서 요청했지만 본문 없는 응답을 받았습니다. (${describeEmptyResponse(response)})`); break; }
      if (more.includes(NO_MORE_SPEECH)) return [text, true];
      if (offset) more = shiftTimestamps(more, offset); // 잘라 낸 뒷부분 기준 시간을 조각 기준으로 옮긴다
      const newPosition = lastPosition(more);
      if (newPosition === null || newPosition <= position) break; // 진전이 없으면 비용만 든다
      text = stripLastPositionLines(text).trimEnd() + "\n\n" + more;
    }
    return [text, false];
  } finally {
    await gemini.deleteFile(audio.name);
  }
}

// transcribeChunk과 같되, Gemini가 조각을 통째로 막으면 5분 → 1분 단위로 나눠 나머지를 살린다
export async function transcribeChunkResilient(ctx, chunk, pdfFile, blocked, depth = 0) {
  try {
    return await transcribeChunk(ctx, chunk, pdfFile);
  } catch (e) {
    if (!(e instanceof BlockedResponse) || chunk.duration == null) throw e;
    const sub = depth < SUBDIVIDE_SECONDS.length ? SUBDIVIDE_SECONDS[depth] : null;
    if (sub === null || chunk.duration <= sub * 1.5) {
      blocked.push(e.reason);
      ctx.log(`  경고: 이 대목(약 ${Math.round(chunk.duration)}초)은 Gemini가 막아 전사하지 못했습니다. (${e.reason})`);
      return [`[00:00] ※ 여기부터 [${formatTimestamp(Math.round(chunk.duration))}]까지는 Gemini가 차단해 전사하지 못했습니다.`, true];
    }
    ctx.log(`  이 구간을 Gemini가 막아 ${sub / 60}분 단위로 나눠 다시 시도합니다. (${e.reason})`);
    const origin = frameTime(ctx.track, chunk.startFrame);
    const cuts = [];
    for (let t = sub; t < chunk.duration; t += sub) cuts.push(origin + t);
    const subs = planChunks(ctx.track, cuts, chunk.startFrame, chunk.endFrame, origin);
    const texts = [];
    let complete = true;
    for (let i = 0; i < subs.length; i++) {
      checkStop(ctx.shouldStop);
      ctx.log(`  [${sub / 60}분 조각 ${i + 1}/${subs.length}]`);
      const [text, ok] = await transcribeChunkResilient(ctx, subs[i], pdfFile, blocked, depth + 1);
      complete = complete && ok;
      texts.push(shiftTimestamps(text, subs[i].start));
    }
    return [[...texts.slice(0, -1).map((t) => stripLastPositionLines(t).trimEnd()), ...texts.slice(-1)].join("\n\n"), complete];
  }
}

// ---------- 이어하기 / 전체 강의 ----------

export async function sha256Hex(text) {
  const data = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 같은 파일인지 알아보는 값: 이름·크기·앞뒤 1MB의 해시(휴대폰은 파일 수정 시각을 믿기 어렵다)
export async function fileSignature(blob) {
  const MB = 1024 * 1024;
  const head = new Uint8Array(await blob.slice(0, MB).arrayBuffer());
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - MB)).arrayBuffer());
  const both = new Uint8Array(head.length + tail.length);
  both.set(head); both.set(tail, head.length);
  return `${blob.name || ""}|${blob.size}|${(await sha256Hex(both)).slice(0, 16)}`;
}

export function stemOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// 강의 PDF는 처음 한 번만 보내 용어 목록을 뽑고, 구간마다는 그 목록만 보낸다(목록은 record에 저장해 다시 씀).
// 목록을 못 뽑으면 예전처럼 PDF를 구간마다 붙인다 — 그때는 올린 PDF 파일을 돌려준다
async function preparePdf(ctx, pdf, record) {
  if (record.glossary) {
    ctx.log(`강의 용어 목록: 저장해 둔 목록을 씁니다(${record.glossary.split("\n").length}개).`);
    return null;
  }
  ctx.log("강의 PDF에서 용어 목록을 뽑는 중... (PDF는 이번 한 번만 보냅니다)");
  const pdfFile = await withRetry(() => ctx.gemini.upload(pdf, "application/pdf", "lecture.pdf"), ctx.log, ctx.shouldStop);
  let glossary = "";
  try {
    const response = await withRetry(
      () => ctx.gemini.generate(ctx.model, [filepart(pdfFile), { text: GLOSSARY_PROMPT }], ctx.log), ctx.log, ctx.shouldStop);
    addUsage(ctx.usage, response);
    glossary = cleanGlossary(responseText(response)[0]);
    if (!glossary) ctx.log(`경고: 강의 PDF에서 용어 목록을 받지 못해 PDF를 구간마다 그대로 보냅니다. (${describeEmptyResponse(response)})`);
  } catch (e) {
    if (e instanceof Cancelled || e instanceof GeminiError) { await ctx.gemini.deleteFile(pdfFile.name); throw e; }
    ctx.log(`경고: 강의 PDF에서 용어 목록을 뽑지 못해 PDF를 구간마다 그대로 보냅니다. (${e.message})`);
  }
  if (!glossary) return pdfFile;
  record.glossary = glossary;
  ctx.log(`강의 용어 목록: ${glossary.split("\n").length}개를 뽑았습니다. 구간마다 PDF 대신 이 목록을 보냅니다.`);
  await ctx.gemini.deleteFile(pdfFile.name);
  return null;
}

async function suggestTopic(ctx, transcript) {
  try {
    const response = await withRetry(
      () => ctx.gemini.generate(ctx.model, [{ text: TOPIC_PROMPT.replace("{transcript}", () => transcript.slice(0, TOPIC_TRANSCRIPT_CHARS)) }], ctx.log),
      ctx.log, ctx.shouldStop);
    addUsage(ctx.usage, response);
    const topic = cleanTopic(responseText(response)[0]);
    if (!topic) ctx.log(`경고: 강의 주제를 받지 못해 파일 이름에 넣지 않습니다. (${describeEmptyResponse(response)})`);
    return topic;
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    ctx.log(`경고: 강의 주제를 정하지 못해 파일 이름에 넣지 않습니다. (${e.message})`);
    return "";
  }
}

async function makeNotes(ctx, record) {
  const key = await sha256Hex(`${ctx.model}\n${NOTES_PROMPT}\n${record.merged}`);
  let body = record.notesKey === key ? record.notesBody : null;
  if (body) {
    ctx.log("복습 노트: 전사문이 그대로라 저장해 둔 노트를 씁니다.");
  } else {
    checkStop(ctx.shouldStop);
    ctx.log("복습 노트를 만드는 중... (전사문 텍스트만 보냅니다)");
    let response;
    try {
      response = await withRetry(
        () => ctx.gemini.generate(ctx.model, [{ text: NOTES_PROMPT.replace("{transcript}", () => record.merged) }], ctx.log),
        ctx.log, ctx.shouldStop);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      ctx.log(`경고: 복습 노트를 만들지 못했습니다. 전사 결과는 그대로입니다. (${e.message})`);
      return;
    }
    addUsage(ctx.usage, response);
    const [text, truncated] = responseText(response);
    if (!text) {
      ctx.log(`경고: 복습 노트를 받지 못했습니다. 전사 결과는 그대로입니다. (${describeEmptyResponse(response)})`);
      return;
    }
    body = text + (truncated ? "\n\n※ 노트가 길어 중간에 잘렸습니다." : "") + "\n";
    record.notesKey = key;
    record.notesBody = body;
  }
  record.notesName = record.name.replace(/_gemini\.txt$/, "") + "_복습노트.txt";
  record.notes = `※ 전사문(${record.name})을 바탕으로 Gemini가 만든 복습 노트입니다. ` +
    "중요한 내용은 전사문·원본 녹음으로 확인하세요.\n\n" + body;
  ctx.log(`복습 노트: ${record.notesName}`);
}

/**
 * 강의 하나를 25분 안팎으로 나눠 전사한다. 구간마다 store에 저장하므로, 중간에 멈춰도 다시 실행하면 이어서 한다.
 * opts: {file, pdf, gemini, model, chunkMinutes, makeNotes, store: {get, put}, decode, log, progress, shouldStop}
 * 반환값: 저장된 기록 {key, name, merged, topic, notes?, notesName?, ...}
 */
export async function transcribeLecture(opts) {
  const log = opts.log || (() => {});
  const model = opts.model || DEFAULT_MODEL;
  const chunkSeconds = (opts.chunkMinutes || DEFAULT_CHUNK_MINUTES) * 60;
  const source = blobSource(opts.file);
  const usage = newUsage();
  const blocked = [], incomplete = [];

  log("오디오를 구간으로 나누는 중...");
  let track;
  try {
    track = await loadTrack(source);
  } catch (e) {
    if (e instanceof UnsupportedAudio) {
      throw new Error(`${e.message} 휴대폰 버전은 일반 AAC m4a(또는 .aac) 녹음만 처리할 수 있습니다.`);
    }
    throw e;
  }
  const cuts = await findCutTimes(track, source, chunkSeconds, opts.decode, log);
  const chunks = planChunks(track, cuts);
  log(`${chunks.length}개 구간(${chunkSeconds / 60}분 안팎)으로 나눴습니다. (전체 ${formatTimestamp(track.duration)})`);

  const key = await fileSignature(opts.file);
  const fingerprint = JSON.stringify({
    pdf: opts.pdf ? await fileSignature(opts.pdf) : null,
    model, starts: chunks.map((c) => c.start),
    prompt: (await sha256Hex(PROMPT + CONTINUE_PROMPT)).slice(0, 16),
  });
  let record = await opts.store.get(key);
  if (!record || record.fingerprint !== fingerprint) {
    if (record && Object.keys(record.parts || {}).length) {
      log("PDF·모델·구간 설정 중 달라진 것이 있어, 저장된 구간 결과를 버리고 처음부터 다시 전사합니다.");
    }
    record = { ...(record || {}), key, fingerprint, parts: {}, partial: {}, topic: undefined, glossary: undefined };
  }
  record.fileName = opts.file.name;
  record.updatedAt = Date.now();
  const save = () => opts.store.put(key, record);
  await save();

  const ctx = { gemini: opts.gemini, model, log, shouldStop: opts.shouldStop, usage, track, source };
  Object.defineProperty(ctx, "glossary", { get: () => record.glossary || null });
  if (opts.progress) opts.progress(0, chunks.length);
  let pdfFile = null, pdfReady = false;
  const parts = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      checkStop(opts.shouldStop);
      const chunk = chunks[i];
      const end = chunk.start + chunk.duration;
      const label = chunkHeader(chunk.start, end);
      if (record.parts[i] !== undefined) {
        log(`[${i + 1}/${chunks.length}] ${label} 이미 전사됨, 건너뜀`);
        parts.push(record.parts[i]);
      } else {
        if (opts.pdf && !pdfReady) {
          pdfReady = true;
          pdfFile = await preparePdf(ctx, opts.pdf, record);
          await save();
        }
        log(`[${i + 1}/${chunks.length}] ${label} 전사 중...`);
        const before = { ...usage };
        const [raw, complete] = await transcribeChunkResilient(ctx, chunk, pdfFile, blocked);
        log(`  토큰: ${describeUsage(Object.fromEntries(Object.keys(usage).map((k) => [k, usage[k] - before[k]])))}`);
        let part = `${label}\n\n${shiftTimestamps(raw, chunk.start)}\n`;
        if (complete) {
          record.parts[i] = part;
          delete record.partial[i];
        } else {
          const reached = chunk.start + (lastPosition(raw) || 0);
          part = `${label}\n\n※ 주의: 이 구간은 ${formatTimestamp(reached)} 부근까지만 전사되었습니다. ` +
            `그 뒤부터 ${formatTimestamp(end)}까지가 누락됐을 수 있습니다.\n\n${shiftTimestamps(raw, chunk.start)}\n`;
          record.partial[i] = part; // 다음 실행 때 건너뛰지 않고 다시 시도한다
          incomplete.push(label);
          log("  경고: 이 구간은 끝까지 전사되지 못했습니다. 결과에 표시해 두었고, 다시 실행하면 이 구간만 다시 시도합니다.");
        }
        parts.push(part);
        await save();
      }
      if (opts.progress) opts.progress(i + 1, chunks.length);
    }
  } finally {
    if (pdfFile) await opts.gemini.deleteFile(pdfFile.name);
  }

  // 강의 주제: 한 번만 정해 저장해 두고, 다시 실행할 때는 그대로 쓴다
  if (!record.topic) {
    log("강의 주제를 정하는 중...");
    const topic = await suggestTopic(ctx, parts.join("\n"));
    if (topic) record.topic = topic;
  }
  if (record.topic) log(`강의 주제: ${record.topic}`);
  const stem = stemOf(opts.file.name);
  record.name = record.topic ? `${stem}_${record.topic}_gemini.txt` : `${stem}_gemini.txt`;
  record.merged = (record.topic ? `주제: ${record.topic}\n\n` : "") + parts.join("\n");
  record.incomplete = incomplete.length;
  record.blocked = blocked.length;
  if (opts.makeNotes) await makeNotes(ctx, record);
  record.updatedAt = Date.now();
  await save();

  if (usage.requests) {
    log(`토큰 합계: ${describeUsage(usage)}`);
    // 강의마다 쓴 토큰 기록(최근 20번). '저장된 결과'에 마지막 기록을 보여 준다
    record.usageLog = [...(record.usageLog || []), { at: Date.now(), model, ...usage }].slice(-20);
    await save();
  }
  if (incomplete.length) log(`경고: 끝까지 전사되지 못한 구간이 ${incomplete.length}개 있습니다: ${incomplete.join(", ")}`);
  if (blocked.length) log(`경고: Gemini가 막아 전사하지 못한 대목이 ${blocked.length}곳 있습니다. 결과에서 '※ 여기부터'를 찾아보세요.`);
  return record;
}
