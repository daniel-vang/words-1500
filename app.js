const wordEl = document.getElementById("word");
const phoneticEl = document.getElementById("phonetic");
const statusEl = document.getElementById("status");
const meaningEl = document.getElementById("meaning");
const nextBtn = document.getElementById("nextBtn");
const repeatBtn = document.getElementById("repeatBtn");
const showMeaningBtn = document.getElementById("showMeaningBtn");
const micBtn = document.getElementById("micBtn");
const helpBtn = document.getElementById("helpBtn");
const overlayEl = document.getElementById("touch-overlay");
const statsEl = document.getElementById("stats");
const statsCurrentEl = document.getElementById("stats-current");
const statsTotalEl = document.getElementById("stats-total");
const statsToggleBtn = document.getElementById("statsToggle");
const wordListSelect = document.getElementById("wordListSelect");

let words = [];
let current = null;
let recognition = null;
let listening = false;
let started = false;
let micEnabled = false;
let currentFile = "words-1500.json";
let history = [];
let historyIndex = -1;
let helpActive = false;
let statsVisible = false;
let statsExpanded = false;
const learnedWords = new Set();
const learnedOrder = [];
const learnedIndex = new Map();
const meaningWords = new Set();
const longTermLearned = new Set();
const longTermMeaning = new Set();
const LONG_TERM_KEY = "words-longterm-v1";
const IDLE_LIMIT_MS = 6 * 1000;
const TIME_SAVE_EVERY_MS = 10 * 1000;
let sessionTimeMs = 0;
let longTermTimeMs = 0;
let lastTickAt = Date.now();
let lastActiveAt = Date.now();
let lastTimeSaveAt = 0;
let windowFocused = true;

const defaultSources = ["words-1500.json", "words.json", "Worlds.json", "worlds.json"];

function extractWords(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.words)) return data.words;
  return [];
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .trim();
}

function splitMeaning(text) {
  return (text || "")
    .split(/[/;；,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isCorrect(transcript, word) {
  const norm = normalize(transcript);
  if (!norm) return false;

  const accept = [];
  if (word.accept && Array.isArray(word.accept)) {
    accept.push(...word.accept);
  }
  accept.push(...splitMeaning(word.cn));

  return accept.some((item) => {
    const n = normalize(item);
    if (n.length < 2) return false;
    return norm.includes(n) || n.includes(norm);
  });
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.classList.toggle("hidden", !text);
  statusEl.classList.remove("ok", "bad");
  if (type) statusEl.classList.add(type);
}

function speakWord(word) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(word.en.replace(/^\*+/, ""));
  utter.lang = "en-US";
  utter.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

function wordKey(word) {
  if (!word) return "";
  return `${word.en}||${word.cn || ""}`;
}

function loadLongTermStats() {
  if (!window.localStorage) return;
  try {
    const raw = localStorage.getItem(LONG_TERM_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.learned)) {
      data.learned.forEach((key) => {
        if (typeof key === "string" && key) longTermLearned.add(key);
      });
    }
    if (data && Array.isArray(data.meaning)) {
      data.meaning.forEach((key) => {
        if (typeof key === "string" && key) longTermMeaning.add(key);
      });
    }
    if (data && typeof data.timeMs === "number" && Number.isFinite(data.timeMs)) {
      longTermTimeMs = Math.max(0, data.timeMs);
    }
  } catch (err) {
    // ignore invalid storage data
  }
}

function saveLongTermStats() {
  if (!window.localStorage) return;
  try {
    const payload = {
      learned: Array.from(longTermLearned),
      meaning: Array.from(longTermMeaning),
      timeMs: longTermTimeMs,
    };
    localStorage.setItem(LONG_TERM_KEY, JSON.stringify(payload));
  } catch (err) {
    // ignore storage failures
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateStatsToggleLabel() {
  if (!statsToggleBtn) return;
  statsToggleBtn.setAttribute("aria-expanded", statsExpanded ? "true" : "false");
  statsToggleBtn.setAttribute("aria-label", statsExpanded ? "收起总统计" : "展开总统计");
}

function updateStats() {
  if (!statsEl) return;
  statsEl.classList.toggle("expanded", statsExpanded);
  updateStatsToggleLabel();
  if (!statsVisible) {
    statsEl.classList.add("hidden");
    return;
  }
  statsEl.classList.remove("hidden");
  let currentIndex = 0;
  if (current) {
    const key = wordKey(current);
    const idx = learnedIndex.get(key);
    if (typeof idx === "number") currentIndex = idx + 1;
  }
  if (statsCurrentEl) {
    statsCurrentEl.textContent = `第 ${currentIndex}/${learnedWords.size} · 中文 ${meaningWords.size}`;
  }
  if (statsTotalEl) {
    statsTotalEl.textContent = `总计 ${longTermLearned.size} · 中文 ${longTermMeaning.size} · 用时 ${formatDuration(longTermTimeMs)} · 本次 ${formatDuration(sessionTimeMs)}`;
  }
}

function markLearned(word) {
  const key = wordKey(word);
  if (!key) return;
  if (!learnedWords.has(key)) {
    learnedWords.add(key);
    learnedIndex.set(key, learnedOrder.length);
    learnedOrder.push(key);
    if (!longTermLearned.has(key)) {
      longTermLearned.add(key);
      saveLongTermStats();
    }
    updateStats();
  }
}

function markMeaning(word) {
  const key = wordKey(word);
  if (!key) return;
  if (!meaningWords.has(key)) {
    meaningWords.add(key);
    if (!longTermMeaning.has(key)) {
      longTermMeaning.add(key);
      saveLongTermStats();
    }
    updateStats();
  }
}

function toggleStats() {
  statsVisible = !statsVisible;
  updateStats();
}

function toggleStatsExpanded() {
  statsExpanded = !statsExpanded;
  updateStats();
}

function markActive() {
  lastActiveAt = Date.now();
}

function shouldCountTime(now) {
  if (document.hidden) return false;
  if (!windowFocused) return false;
  if (now - lastActiveAt > IDLE_LIMIT_MS) return false;
  return true;
}

function tickTime() {
  const now = Date.now();
  const delta = now - lastTickAt;
  lastTickAt = now;
  if (delta <= 0) return;
  if (!shouldCountTime(now)) return;
  sessionTimeMs += delta;
  longTermTimeMs += delta;
  if (now - lastTimeSaveAt >= TIME_SAVE_EVERY_MS) {
    lastTimeSaveAt = now;
    saveLongTermStats();
  }
  updateStats();
}

function showMeaning() {
  if (!current) return;
  meaningEl.textContent = `${current.cn}`;
  markMeaning(current);
}

function renderWord(word) {
  current = word;
  wordEl.textContent = current.en;
  phoneticEl.textContent = current.phonetic || "";
  meaningEl.textContent = "";
  setStatus(micEnabled ? "请说出中文意思" : "", null);
  repeatBtn.disabled = false;
  nextBtn.disabled = false;
  showMeaningBtn.disabled = false;
  markLearned(current);
  updateStats();
  speakWord(current);
  if (micEnabled && recognition && started) {
    startListening();
  }
}

function nextWord() {
  if (!words.length) return;
  if (historyIndex < history.length - 1) {
    historyIndex += 1;
    renderWord(history[historyIndex]);
    return;
  }
  const pick = words[Math.floor(Math.random() * words.length)];
  history.push(pick);
  historyIndex = history.length - 1;
  renderWord(pick);
}

function prevWord() {
  if (!history.length) return;
  if (historyIndex <= 0) {
    setStatus("已经是第一个单词", null);
    return;
  }
  historyIndex -= 1;
  renderWord(history[historyIndex]);
}

function startListening() {
  if (!recognition) return;
  if (listening) return;
  listening = true;
  setStatus("正在听你说...", null);
  recognition.start();
}

function stopListening() {
  if (!recognition) return;
  if (!listening) return;
  recognition.stop();
}

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("当前浏览器不支持语音识别", "bad");
    return null;
  }
  const rec = new SpeechRecognition();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.maxAlternatives = 3;

  rec.onresult = (event) => {
    markActive();
    const transcript = Array.from(event.results)
      .map((r) => r[0].transcript)
      .join(" ");

    const ok = isCorrect(transcript, current);
    const wantsNext = /(?:下一个|继续|next)/i.test(transcript);
    const wantsPrev = /(?:上一个|上个|previous|prev|back)/i.test(transcript);
    const wantsRepeat = /(?:朗读|read|repeat)/i.test(transcript);
    const wantsChinese = /(?:中文|汉语|意思)/i.test(transcript);
    if (ok) {
      setStatus(`正确：${transcript}`, "ok");
    } else {
      setStatus(`不太对：${transcript}`, "bad");
    }
    showMeaning();

    listening = false;
    if (wantsNext) {
      nextWord();
      return;
    }
    if (wantsPrev) {
      prevWord();
      return;
    }
    if (wantsRepeat) {
      speakWord(current);
    }
    if (wantsChinese) {
      showMeaning();
    }
    if (ok) {
      setTimeout(() => {
        nextWord();
      }, 1000);
    }
  };

  rec.onerror = () => {
    listening = false;
    setStatus("识别失败，请再试一次", "bad");
  };

  rec.onend = () => {
    listening = false;
  };

  return rec;
}

function updateMicUI() {
  if (!micBtn) return;
  micBtn.textContent = "麦克";
  micBtn.classList.toggle("active", micEnabled);
  micBtn.setAttribute("aria-pressed", micEnabled ? "true" : "false");
  if (!micEnabled) stopListening();
}

function setHelp(active) {
  helpActive = active;
  if (overlayEl) overlayEl.classList.toggle("help-on", helpActive);
  if (helpBtn) {
    helpBtn.classList.toggle("active", helpActive);
    helpBtn.setAttribute("aria-pressed", helpActive ? "true" : "false");
  }
}

function getSources(file) {
  if (file === "words-1500.json") return [...defaultSources];
  return [file];
}

async function loadWords(file) {
  words = [];
  history = [];
  historyIndex = -1;
  learnedWords.clear();
  learnedOrder.length = 0;
  learnedIndex.clear();
  meaningWords.clear();
  sessionTimeMs = 0;
  lastTickAt = Date.now();
  lastActiveAt = Date.now();
  updateStats();
  const sources = getSources(file);
  for (const name of sources) {
    try {
      const res = await fetch(name);
      if (!res.ok) continue;
      const data = await res.json();
      const list = extractWords(data);
      if (list.length) {
        words = list;
        history = [];
        historyIndex = -1;
        return true;
      }
    } catch (err) {
      // ignore and try next source
    }
  }

  const tip = location.protocol === "file:"
    ? "当前通过本地文件打开，浏览器限制无法直接读取 JSON"
    : `词表加载失败，请检查 ${file}`;
  setStatus(tip, "bad");
  return false;
}

async function autoStart() {
  if (!started) {
    const ok = await loadWords(currentFile);
    if (!ok || !words.length) {
      if (!words.length) {
        setStatus("词表为空，请先填充 words-1500.json", "bad");
      }
      return;
    }
    started = true;
  }

  if (micEnabled && !recognition) {
    recognition = setupRecognition();
    if (!recognition) {
      setStatus("当前浏览器不支持语音识别", "bad");
      return;
    }
  }

  nextWord();
}

nextBtn.addEventListener("click", () => {
  nextWord();
});

repeatBtn.addEventListener("click", () => {
  if (current) speakWord(current);
});

showMeaningBtn.addEventListener("click", () => {
  showMeaning();
});

if (micBtn) {
  micBtn.addEventListener("click", async () => {
    micEnabled = !micEnabled;
    if (micEnabled) {
      if (!recognition) {
        recognition = setupRecognition();
        if (!recognition) {
          micEnabled = false;
          updateMicUI();
          return;
        }
      }
      if (!started) {
        await autoStart();
      } else if (current) {
        startListening();
      }
    }
    updateMicUI();
  });
}

if (helpBtn) {
  helpBtn.addEventListener("click", () => {
    setHelp(!helpActive);
  });
}

if (statsToggleBtn) {
  statsToggleBtn.addEventListener("click", (event) => {
    markActive();
    event.stopPropagation();
    toggleStatsExpanded();
  });
}

function fitSelectToSelectedOption(sel) {
  const selectedText = sel.options[sel.selectedIndex]?.text ?? '';
  const tmp = document.createElement('span');
  const cs = getComputedStyle(sel);
  tmp.style.font = cs.font;
  tmp.style.letterSpacing = cs.letterSpacing;
  tmp.style.visibility = 'hidden';
  tmp.style.position = 'fixed';
  tmp.style.whiteSpace = 'nowrap';
  tmp.textContent = selectedText;
  document.body.appendChild(tmp);
  const textWidth = tmp.offsetWidth;
  document.body.removeChild(tmp);
  sel.style.width = (textWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2) + 'px';
}

if (wordListSelect) {
  fitSelectToSelectedOption(wordListSelect);
  wordListSelect.addEventListener("change", async () => {
    fitSelectToSelectedOption(wordListSelect);
    const file = wordListSelect.value;
    if (!file) return;
    currentFile = file;
    stopListening();
    if (file.startsWith("custom:")) {
      const listName = file.slice(7);
      const customLists = loadCustomLists();
      const wordList = customLists[listName] ? customLists[listName].words : [];
      words = wordList;
      history = [];
      historyIndex = -1;
      learnedWords.clear();
      learnedOrder.length = 0;
      learnedIndex.clear();
      meaningWords.clear();
      sessionTimeMs = 0;
      lastTickAt = Date.now();
      lastActiveAt = Date.now();
      updateStats();
      if (!started) started = true;
      if (words.length) {
        nextWord();
      } else {
        setStatus("词库为空", "bad");
      }
    } else {
      const ok = await loadWords(currentFile);
      if (ok && words.length) {
        nextWord();
      }
    }
  });
}

loadLongTermStats();
document.addEventListener("pointerdown", markActive, { passive: true });
document.addEventListener("touchstart", markActive, { passive: true });
window.addEventListener("focus", () => {
  windowFocused = true;
  lastTickAt = Date.now();
  markActive();
});
window.addEventListener("blur", () => {
  windowFocused = false;
});
document.addEventListener("visibilitychange", () => {
  lastTickAt = Date.now();
  if (!document.hidden) {
    markActive();
  }
});
window.addEventListener("beforeunload", () => {
  saveLongTermStats();
});
setInterval(tickTime, 1000);
updateMicUI();
autoStart();

const pressedKeys = new Set();

document.addEventListener("keydown", async (event) => {
  markActive();
  const target = event.target;
  if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
    return;
  }
  if (target && target.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key || "";
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return;
  if (event.repeat) return;
  if (pressedKeys.has(key)) return;
  pressedKeys.add(key);

  if (!started) {
    await autoStart();
  }

  if (key.toLowerCase() === "r") {
    if (current) speakWord(current);
    return;
  }

  if (key.toLowerCase() === "c") {
    if (current) {
      const showing = meaningEl.textContent && meaningEl.textContent.trim().length > 0;
      if (showing) {
        meaningEl.textContent = "";
      } else {
        showMeaning();
      }
    }
    return;
  }

  if (key.toLowerCase() === "m") {
    if (micBtn) {
      micBtn.click();
    } else {
      micEnabled = !micEnabled;
      if (micEnabled) {
        if (!recognition) {
          recognition = setupRecognition();
          if (!recognition) {
            micEnabled = false;
            updateMicUI();
            return;
          }
        }
        if (!started) {
          await autoStart();
        } else if (current) {
          startListening();
        }
      }
      updateMicUI();
    }
    return;
  }

  stopListening();
  nextWord();
});

document.addEventListener("keyup", (event) => {
  const key = event.key || "";
  pressedKeys.delete(key);
});

// --- Touch overlay: create six absolute zones around `.app` and bind actions ---
(function () {
  const overlay = overlayEl;
  if (!overlay) return;
  const areas = Array.from(overlay.querySelectorAll(".touch-area"));
  const appEl = document.querySelector(".app");

  function forwardIfOverApp(x, y) {
    const list = document.elementsFromPoint(x, y);
    if (!list || !list.length) return false;
    for (const el of list) {
      if (!el) continue;
      if (overlay.contains(el)) continue;
      if (appEl && appEl.contains(el)) {
        const evt = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        });
        el.dispatchEvent(evt);
        return true;
      }
    }
    return false;
  }

  function handleEvent(e) {
    const p = e.touches ? e.touches[0] : e;
    const x = p.clientX;
    const y = p.clientY;
    if (forwardIfOverApp(x, y)) return;

    const zone = this.dataset.zone;
    if (zone === "tl" || zone === "tr") {
      prevWord();
      return;
    }
    if (zone === "tm") {
      toggleStats();
      return;
    }
    if (zone === "lm" || zone === "rm") {
      showMeaning();
      return;
    }
    if (zone === "bm") {
      if (repeatBtn) repeatBtn.click();
      return;
    }
    if (zone === "bl" || zone === "br") {
      if (nextBtn) nextBtn.click();
      return;
    }
  }

  function updateTouchAreas() {
    if (!appEl) return;
    const appRect = appEl.getBoundingClientRect();
    const vw = Math.max(window.innerWidth || 0, document.documentElement.clientWidth);
    const vh = Math.max(window.innerHeight || 0, document.documentElement.clientHeight);
    const col1 = vw / 3;
    const col2 = (vw * 2) / 3;

    areas.forEach((area) => {
      const zone = area.dataset.zone;
      let left = 0,
        top = 0,
        width = 0,
        height = 0;
      if (zone === "tl") {
        left = 0;
        top = 0;
        width = Math.max(0, col1);
        height = Math.max(0, appRect.top);
      } else if (zone === "tm") {
        left = Math.max(0, col1);
        top = 0;
        width = Math.max(0, col2 - col1);
        height = Math.max(0, appRect.top);
      } else if (zone === "lm") {
        left = 0;
        top = Math.max(0, appRect.top);
        width = Math.max(0, appRect.left);
        height = Math.max(0, appRect.height);
      } else if (zone === "rm") {
        left = Math.max(0, appRect.right);
        top = Math.max(0, appRect.top);
        width = Math.max(0, vw - appRect.right);
        height = Math.max(0, appRect.height);
      } else if (zone === "tr") {
        left = Math.max(0, col2);
        top = 0;
        width = Math.max(0, vw - col2);
        height = Math.max(0, appRect.top);
      } else if (zone === "bl") {
        left = 0;
        top = Math.max(0, appRect.bottom);
        width = Math.max(0, col1);
        height = Math.max(0, vh - appRect.bottom);
      } else if (zone === "bm") {
        left = Math.max(0, col1);
        top = Math.max(0, appRect.bottom);
        width = Math.max(0, col2 - col1);
        height = Math.max(0, vh - appRect.bottom);
      } else if (zone === "br") {
        left = Math.max(0, col2);
        top = Math.max(0, appRect.bottom);
        width = Math.max(0, vw - col2);
        height = Math.max(0, vh - appRect.bottom);
      }

      area.style.left = left + "px";
      area.style.top = top + "px";
      area.style.width = width + "px";
      area.style.height = height + "px";

      if (width > 0 && height > 0) {
        area.style.pointerEvents = "auto";
      } else {
        area.style.pointerEvents = "none";
      }
    });
  }

  window.addEventListener("resize", updateTouchAreas);
  window.addEventListener("scroll", updateTouchAreas, true);
  setTimeout(updateTouchAreas, 30);

  areas.forEach((a) => {
    if (window.PointerEvent) {
      a.addEventListener("pointerdown", function (ev) {
        // handle touch/pen on press
        if (ev.pointerType === "mouse") return;
        ev.preventDefault();
        handleEvent.call(this, ev);
      });

      a.addEventListener("pointerup", function (ev) {
        // handle mouse on release
        if (ev.pointerType === "mouse") {
          ev.preventDefault();
          handleEvent.call(this, ev);
        }
      });

      // block click events to avoid duplicate handling when pointer events are supported
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      });
    } else {
      // fallback for older browsers: touchstart for touch, click for mouse
      a.addEventListener(
        "touchstart",
        function (ev) {
          ev.preventDefault();
          handleEvent.call(this, ev);
        },
        { passive: false }
      );
      a.addEventListener("click", function (ev) {
        handleEvent.call(this, ev);
      });
    }
  });

  // initial calc
  updateTouchAreas();
})();

// --- Auto button: automatically click "next" every 3 seconds when enabled ---
const autoBtn = document.getElementById("autoBtn");
let autoIntervalId = null;
let autoEnabled = false;

function updateAutoUI() {
  if (!autoBtn) return;
  autoBtn.classList.toggle("active", autoEnabled);
  autoBtn.setAttribute("aria-pressed", autoEnabled ? "true" : "false");
}

function startAuto() {
  if (autoIntervalId) return;
  autoIntervalId = setInterval(() => {
    markActive();
    if (nextBtn) nextBtn.click();
  }, 3500);
}

function stopAuto() {
  if (!autoIntervalId) return;
  clearInterval(autoIntervalId);
  autoIntervalId = null;
}

if (autoBtn) {
  autoBtn.addEventListener("click", async () => {
    autoEnabled = !autoEnabled;
    if (autoEnabled) {
      if (!started) {
        const ok = await loadWords(currentFile);
        if (!ok) {
          autoEnabled = false;
          updateAutoUI();
          return;
        }
        started = true;
      }
      startAuto();
    } else {
      stopAuto();
    }
    updateAutoUI();
  });
}

updateAutoUI();

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch (err) {
    console.warn("Service Worker register failed:", err);
  }
}

registerServiceWorker();

// ============================================================
// CUSTOM WORD LIST IMPORT FEATURE
// ============================================================

const CUSTOM_LISTS_KEY = "words-custom-lists-v1";

function loadCustomLists() {
  try {
    const raw = localStorage.getItem(CUSTOM_LISTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCustomLists(lists) {
  try {
    localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(lists));
  } catch {
    // ignore
  }
}

// ---------- Word Text Parser ----------
// Strip trailing page-number references like "美丽的 42" → "美丽的"
function stripPageNum(cn) {
  return (cn || "").replace(/[\s""\u201c\u201d]+\d{1,3}$/, "").trim();
}

// Normalize Chinese meaning: remove spaces, convert half-width punctuation to full-width, strip trailing punctuation
function normalizeCn(cn) {
  if (!cn) return cn;
  return cn
    .replace(/\s+/g, "")           // remove all spaces
    .replace(/,/g, "，")            // , → ，
    .replace(/;/g, "；")            // ; → ；
    .replace(/:/g, "：")            // : → ：
    .replace(/\?/g, "？")           // ? → ？
    .replace(/!/g, "！")            // ! → ！
    .replace(/\(/g, "（")           // ( → （
    .replace(/\)/g, "）")           // ) → ）
    .replace(/[，；：？！、。…]+$/, ""); // strip trailing punctuation
}

function parseWordListText(text) {
  const lines = text.split(/\r?\n/);
  const results = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // skip pure separator or bullet-only lines
    if (/^[\s\d\-—=*·•◆◇○●]+$/.test(line)) continue;
    // remove leading list number: "1.", "1、", "(1)", "①"
    line = line.replace(/^[（(]?\d+[）)\.、]\s*/, "").trim();
    line = line.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, "").trim();
    if (!line) continue;

    // Format: word [TAB] meaning
    const tabIdx = line.indexOf("\t");
    if (tabIdx > 0) {
      const en = line.slice(0, tabIdx).trim();
      const rest = line.slice(tabIdx + 1).trim();
      if (/^\*?[a-zA-Z]/.test(en)) {
        const parsed = extractPhoneticAndPos(en, rest);
        results.push(parsed);
        continue;
      }
    }

    // Format: word /phonetic/ pos. meaning  OR  word [phonetic] pos. meaning
    // POS group handles compound forms like "vt. & vi." or "vt.&vi."
    const detailMatch = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s*[/\[]([^\]/\[]+)[/\]]\s*((?:[a-z]{1,6}\.(?:\s*[&和]\s*[a-z]{1,6}\.)*\s*))?(.*)$/
    );
    if (detailMatch) {
      const en = detailMatch[1].trim();
      const phonetic = detailMatch[2].trim();
      const pos = (detailMatch[3] || "").trim();
      const cn = (detailMatch[4] || "").trim();
      if (en) {
        results.push({ en, phonetic: phonetic || undefined, pos: pos || undefined, cn });
        continue;
      }
    }

    // Format: word: meaning  OR  word：meaning
    const colonMatch = line.match(/^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s*[：:]\s*(.+)$/);
    if (colonMatch) {
      results.push({
        en: colonMatch[1].trim(),
        cn: colonMatch[2].trim(),
      });
      continue;
    }

    // Format: word  Chinese (space + CJK characters)
    const cjkMatch = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s+([\u4e00-\u9fff\u3400-\u4dbf].*)$/
    );
    if (cjkMatch) {
      results.push({
        en: cjkMatch[1].trim(),
        cn: cjkMatch[2].trim(),
      });
      continue;
    }

    // Format: English word only (no Chinese)
    const engOnly = line.match(/^(\*?[a-zA-Z][a-zA-Z '\-]{0,39})$/);
    if (engOnly) {
      results.push({ en: engOnly[1].trim(), cn: "" });
      continue;
    }

    // Format: word pos. Chinese (space + part-of-speech like "n.", "v.")
    const posMatch = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s+([a-z]{1,5}\.\s*)(.+)$/
    );
    if (posMatch && /^\*?[a-zA-Z]/.test(posMatch[1])) {
      results.push({
        en: posMatch[1].trim(),
        pos: posMatch[2].trim(),
        cn: posMatch[3].trim(),
      });
      continue;
    }

    // Line starts with a POS marker (vt. vi. adj. adv. n. v. conj. prep. pron. …)
    // Supports combined forms like "vt. & vi." or "vt.&vi."
    // — treat as continuation of the previous word, filling pos and/or cn
    const POS_ATOM = "(?:vt|vi|adj|adv|conj|prep|pron|art|num|interj|n|v|aux|det|pl)\\.";
    const posOnlyMatch = line.match(
      new RegExp(`^((?:${POS_ATOM}\\s*(?:[&和]\\s*)?)*${POS_ATOM}\\s*)(.*)?$`, "i")
    );
    if (posOnlyMatch && results.length > 0) {
      const prev = results[results.length - 1];
      const pos = posOnlyMatch[1].trim();
      const rest = (posOnlyMatch[2] || "").trim();
      if (!prev.pos) prev.pos = pos;
      if (rest) {
        const sep = prev.cn && !/[，；,;]\s*$/.test(prev.cn) ? "；" : "";
        prev.cn = prev.cn ? prev.cn + sep + rest : rest;
      }
      continue;
    }

    // Line starts with Chinese — treat as continuation of the previous word's meaning.
    // Concatenate directly (no auto-separator): OCR often wraps mid-word, and the
    // original text already contains 、；， separators where needed.
    if (/^[\u4e00-\u9fff\u3400-\u4dbf]/.test(line) && results.length > 0) {
      const prev = results[results.length - 1];
      prev.cn = prev.cn ? prev.cn + line : line;
      continue;
    }

    // Format: word pos. — line ends with a POS marker, meaning follows on later lines
    const wordPosOnly = line.match(
      /^(\*?[a-zA-Z][a-zA-Z '\-]*?)\s+((?:[a-z]{1,6}\.(?:\s*[&和]\s*[a-z]{1,6}\.)*)\s*)$/i
    );
    if (wordPosOnly && /^\*?[a-zA-Z]/.test(wordPosOnly[1])) {
      results.push({ en: wordPosOnly[1].trim(), pos: wordPosOnly[2].trim(), cn: "" });
      continue;
    }

    // Fallback: extract a leading English word from lines that matched nothing above
    const fallbackMatch = line.match(/^(\*?[a-zA-Z][a-zA-Z'\-]{0,29})/);
    if (fallbackMatch) {
      results.push({ en: fallbackMatch[1].trim(), cn: "" });
      continue;
    }
  }

  results.forEach((w) => { if (w.cn) w.cn = normalizeCn(stripPageNum(w.cn)); });

  // Deduplicate by English word (case-insensitive); keep first occurrence
  const seen = new Map();
  results.forEach((w) => {
    const key = w.en.toLowerCase();
    if (!seen.has(key)) seen.set(key, w);
  });
  return Array.from(seen.values()).filter((w) => w.en && w.en.length > 0);
}

function extractPhoneticAndPos(en, rest) {
  // rest may start with phonetic in /.../ or [...]
  const phoneticMatch = rest.match(/^[/\[]([^\]/\[]+)[/\]]\s*([a-z]+\.\s*)?(.*)$/);
  if (phoneticMatch) {
    return {
      en,
      phonetic: phoneticMatch[1].trim(),
      pos: (phoneticMatch[2] || "").trim() || undefined,
      cn: (phoneticMatch[3] || "").trim(),
    };
  }
  return { en, cn: rest };
}

// ---------- Custom Word List Options ----------
function refreshCustomToggleBtns() {
  if (!wordListSelect) return;
  // remove existing custom optgroup if any
  const existing = wordListSelect.querySelector("optgroup[data-custom]");
  if (existing) existing.remove();
  const lists = loadCustomLists();
  const names = Object.keys(lists);
  if (names.length === 0) {
    buildWordListPopup();
    return;
  }
  const group = document.createElement("optgroup");
  group.label = "我的词库";
  group.dataset.custom = "1";
  names.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = "custom:" + name;
    opt.textContent = name;
    group.appendChild(opt);
  });
  wordListSelect.appendChild(group);
  buildWordListPopup();
}

// ---------- OCR ----------
let tesseractWorker = null;

function setOCRProgress(pct, text) {
  const fill = document.getElementById("ocrProgressFill");
  const label = document.getElementById("ocrProgressText");
  if (fill) fill.style.width = pct + "%";
  if (label) label.textContent = text || `正在识别… ${pct}%`;
}

// Preprocess image for better OCR: upscale small images, then adaptive binarization.
// Bradley-Roth adaptive thresholding handles uneven lighting (shadows from book spine)
// far better than global contrast boosting.
function preprocessImageForOCR(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 1 — Upscale so the longest edge is at least 1800px (Tesseract ~300 DPI sweet-spot)
      const MIN_DIM = 1800;
      const maxDim = Math.max(img.width, img.height);
      const scale = maxDim < MIN_DIM ? Math.min(3, MIN_DIM / maxDim) : 1;
      const width  = Math.round(img.width  * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // 2 — Bradley-Roth adaptive binarization
      const imgData = ctx.getImageData(0, 0, width, height);
      const rgba = imgData.data;

      // Grayscale (BT.601 integer coefficients)
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < gray.length; i++) {
        const p = i << 2;
        gray[i] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
      }

      // Integral image for O(1) rectangular mean queries
      const W1 = width + 1;
      const integral = new Int32Array((height + 1) * W1);
      for (let y = 1; y <= height; y++) {
        let row = 0;
        for (let x = 1; x <= width; x++) {
          row += gray[(y - 1) * width + (x - 1)];
          integral[y * W1 + x] = row + integral[(y - 1) * W1 + x];
        }
      }

      // Window half-size = 1/8 of shorter dimension (min 15px)
      const half = Math.max(15, Math.round(Math.min(width, height) / 8));
      const S = 0.15; // sensitivity

      for (let y = 0; y < height; y++) {
        const y1 = y > half ? y - half : 0;
        const y2 = y + half < height ? y + half : height - 1;
        for (let x = 0; x < width; x++) {
          const x1 = x > half ? x - half : 0;
          const x2 = x + half < width  ? x + half : width  - 1;
          const count = (x2 - x1 + 1) * (y2 - y1 + 1);
          const sum = integral[(y2 + 1) * W1 + (x2 + 1)]
                    - integral[y1       * W1 + (x2 + 1)]
                    - integral[(y2 + 1) * W1 + x1]
                    + integral[y1       * W1 + x1];
          const v = gray[y * width + x] < (sum / count) * (1 - S) ? 0 : 255;
          const p = (y * width + x) << 2;
          rgba[p] = rgba[p + 1] = rgba[p + 2] = v; rgba[p + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  });
}

async function runOCR(imageSource) {
  if (!window.Tesseract) {
    throw new Error("Tesseract.js 未加载");
  }
  if (!tesseractWorker) {
    setOCRProgress(0, "正在初始化识别引擎…");
    tesseractWorker = await Tesseract.createWorker(["eng", "chi_sim"], 1, {
      workerPath: "./tesseract.worker.min.js",
      langPath: "./tessdata",
      corePath: "./tesseract-core",
      logger: (m) => {
        if (m.status === "recognizing text") {
          setOCRProgress(Math.round(m.progress * 100), `正在识别… ${Math.round(m.progress * 100)}%`);
        } else if (m.status === "loading language traineddata") {
          setOCRProgress(10, "正在加载语言数据…");
        } else if (m.status === "initializing api") {
          setOCRProgress(20, "正在初始化…");
        }
      },
    });
    // PSM 3: auto page segmentation without orientation detection.
    // Better than AUTO_OSD for vocabulary-list pages; faster too.
    await tesseractWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: "1",
    });
  }
  setOCRProgress(30, "正在预处理图片…");
  const processedSource = typeof imageSource === "string" && imageSource.startsWith("data:")
    ? await preprocessImageForOCR(imageSource)
    : imageSource;
  setOCRProgress(50, "正在识别…");
  const result = await tesseractWorker.recognize(processedSource);
  return result.data.text;
}

// ---------- Import Modal UI ----------
const importModal = document.getElementById("importModal");
const importBtn = document.getElementById("importBtn");
const importCloseBtn = document.getElementById("importCloseBtn");
const importStep1 = document.getElementById("importStep1");
const importStep2 = document.getElementById("importStep2");
const importTextarea = document.getElementById("importTextarea");
const parseBtn = document.getElementById("parseBtn");
const backToStep1Btn = document.getElementById("backToStep1Btn");
const saveListBtn = document.getElementById("saveListBtn");
const addWordBtn = document.getElementById("addWordBtn");
const wordTableBody = document.getElementById("wordTableBody");
const parsedCountEl = document.getElementById("parsedCount");
const listNameInput = document.getElementById("listNameInput");
const savedListsSection = document.getElementById("savedListsSection");
const savedListsContainer = document.getElementById("savedListsContainer");
const photoInput = document.getElementById("photoInput");
const photoPreview = document.getElementById("photoPreview");
const photoPlaceholder = document.getElementById("photoPlaceholder");
const photoDropzone = document.getElementById("photoDropzone");
const changePhotoBtn = document.getElementById("changePhotoBtn");
const ocrBtn = document.getElementById("ocrBtn");
const ocrProgress = document.getElementById("ocrProgress");
const ocrHint = document.getElementById("ocrHint");

let editingWords = [];
let activePhotoDataUrl = null;
let activeImportTab = "text";
let editingListName = null; // null = new list, string = editing existing list

function openImportModal(editName) {
  if (!importModal) return;
  editingListName = editName || null;
  importModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  // Always reset photo state (OCR flow belongs to step 1 only)
  activePhotoDataUrl = null;
  if (photoInput) photoInput.value = "";
  if (photoPreview) { photoPreview.src = ""; photoPreview.classList.add("hidden"); }
  if (photoPlaceholder) photoPlaceholder.style.display = "";
  if (changePhotoBtn) changePhotoBtn.classList.add("hidden");
  if (ocrBtn) ocrBtn.classList.add("hidden");
  if (ocrHint) ocrHint.classList.add("hidden");

  if (editName) {
    const lists = loadCustomLists();
    const listData = lists[editName];
    if (listData) {
      buildWordTable(listData.words);
      if (listNameInput) listNameInput.value = editName;
      showImportStep(2);
    } else {
      // List not found — fall back to new import mode
      editingListName = null;
      if (importTextarea) importTextarea.value = "";
      if (listNameInput) listNameInput.value = "";
      editingWords = [];
      if (wordTableBody) wordTableBody.innerHTML = "";
      if (parsedCountEl) parsedCountEl.textContent = "识别出 0 个单词";
      switchImportTab("text");
      showImportStep(1);
    }
  } else {
    if (importTextarea) importTextarea.value = "";
    if (listNameInput) listNameInput.value = "";
    editingWords = [];
    if (wordTableBody) wordTableBody.innerHTML = "";
    if (parsedCountEl) parsedCountEl.textContent = "识别出 0 个单词";
    switchImportTab("text");
    showImportStep(1);
  }

  refreshSavedListsUI();
  if (!editingListName && importTextarea) importTextarea.focus();
}

function isImportStep2Visible() {
  return importStep2 && !importStep2.classList.contains("hidden");
}

// ---------- Custom confirm dialog ----------
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirmDialog");
    const msg = document.getElementById("confirmMsg");
    const okBtn = document.getElementById("confirmOkBtn");
    const cancelBtn = document.getElementById("confirmCancelBtn");
    if (!overlay || !msg || !okBtn || !cancelBtn) { resolve(window.confirm(message)); return; }
    msg.textContent = message;
    overlay.classList.remove("hidden");
    function done(result) {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      resolve(result);
    }
    function onOk() { done(true); }
    function onCancel() { done(false); }
    function onBackdrop(e) { if (e.target === overlay) done(false); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    cancelBtn.focus();
  });
}

async function closeImportModal(force) {
  if (!importModal) return;
  if (!force && isImportStep2Visible()) {
    if (!await showConfirm("未保存的更改将会丢失，确定关闭吗？")) return;
  }
  importModal.classList.add("hidden");
  document.body.style.overflow = "";
}

function showImportStep(step) {
  if (importStep1) importStep1.classList.toggle("hidden", step !== 1);
  if (importStep2) importStep2.classList.toggle("hidden", step !== 2);
  // scroll sheet back to top
  const body = importModal && importModal.querySelector(".import-modal-body");
  if (body) body.scrollTop = 0;
}

function switchImportTab(tab) {
  activeImportTab = tab;
  document.querySelectorAll(".import-tab").forEach((t) => {
    const isActive = t.dataset.tab === tab;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const textTab = document.getElementById("textTab");
  const photoTab = document.getElementById("photoTab");
  if (textTab) textTab.classList.toggle("hidden", tab !== "text");
  if (photoTab) photoTab.classList.toggle("hidden", tab !== "photo");
}

function buildWordTable(wordList) {
  editingWords = wordList.map((w) => ({ ...w }));
  renderWordTable();
  if (parsedCountEl) parsedCountEl.textContent = `识别出 ${editingWords.length} 个单词`;
}

function renderWordTable() {
  if (!wordTableBody) return;
  wordTableBody.innerHTML = "";
  editingWords.forEach((word, idx) => {
    const row = document.createElement("tr");

    const enTd = document.createElement("td");
    const enInput = document.createElement("input");
    enInput.type = "text";
    enInput.className = "word-cell-input";
    enInput.value = word.en || "";
    enInput.placeholder = "英文单词";
    enInput.setAttribute("aria-label", "英文");
    enInput.addEventListener("input", () => {
      editingWords[idx].en = enInput.value;
    });
    enTd.appendChild(enInput);

    const cnTd = document.createElement("td");
    const cnInput = document.createElement("input");
    cnInput.type = "text";
    cnInput.className = "word-cell-input";
    cnInput.value = word.cn || "";
    cnInput.placeholder = "中文含义";
    cnInput.setAttribute("aria-label", "中文");
    cnInput.addEventListener("input", () => {
      editingWords[idx].cn = cnInput.value;
    });
    cnTd.appendChild(cnInput);

    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "word-del-btn";
    delBtn.textContent = "×";
    delBtn.setAttribute("aria-label", "删除此行");
    delBtn.addEventListener("click", () => {
      editingWords.splice(idx, 1);
      renderWordTable();
      if (parsedCountEl) parsedCountEl.textContent = `识别出 ${editingWords.length} 个单词`;
    });
    delTd.appendChild(delBtn);

    row.appendChild(enTd);
    row.appendChild(cnTd);
    row.appendChild(delTd);
    wordTableBody.appendChild(row);
  });
}

function addEmptyWordRow() {
  editingWords.push({ en: "", cn: "" });
  renderWordTable();
  if (parsedCountEl) parsedCountEl.textContent = `识别出 ${editingWords.length} 个单词`;
  // focus last row's english input
  const rows = wordTableBody.querySelectorAll("tr");
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    const inp = lastRow.querySelector(".word-cell-input");
    if (inp) inp.focus();
  }
}

function refreshSavedListsUI() {
  if (!savedListsSection || !savedListsContainer) return;
  const lists = loadCustomLists();
  const names = Object.keys(lists);
  savedListsSection.classList.toggle("hidden", names.length === 0);
  savedListsContainer.innerHTML = "";
  names.forEach((name) => {
    const item = document.createElement("div");
    item.className = "saved-list-item";

    const nameEl = document.createElement("span");
    nameEl.className = "saved-list-name";
    nameEl.textContent = name;
    nameEl.title = `点击加载"${name}"`;
    nameEl.addEventListener("click", async () => {
      if (isImportStep2Visible() && !await showConfirm("未保存的更改将会丢失，确定关闭吗？")) return;
      closeImportModal(true);
      if (wordListSelect) {
        wordListSelect.value = "custom:" + name;
        wordListSelect.dispatchEvent(new Event("change"));
      }
    });

    const editEl = document.createElement("button");
    editEl.type = "button";
    editEl.className = "saved-list-edit";
    editEl.textContent = "编辑";
    editEl.setAttribute("aria-label", `编辑词库"${name}"`);
    editEl.addEventListener("click", () => openImportModal(name));

    const delEl = document.createElement("button");
    delEl.type = "button";
    delEl.className = "saved-list-del";
    delEl.textContent = "×";
    delEl.setAttribute("aria-label", `删除词库"${name}"`);
    delEl.addEventListener("click", async () => {
      if (!await showConfirm(`确定删除词库"${name}"吗？`)) return;
      const all = loadCustomLists();
      delete all[name];
      saveCustomLists(all);
      if (currentFile === "custom:" + name) {
        if (wordListSelect) {
          wordListSelect.value = "words-1500.json";
          wordListSelect.dispatchEvent(new Event("change"));
        }
      }
      refreshCustomToggleBtns();
      refreshSavedListsUI();
    });

    item.appendChild(nameEl);
    item.appendChild(editEl);
    item.appendChild(delEl);
    savedListsContainer.appendChild(item);
  });
}

// Photo handling
if (photoInput) {
  photoInput.addEventListener("change", () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      activePhotoDataUrl = e.target.result;
      if (photoPreview) {
        photoPreview.src = activePhotoDataUrl;
        photoPreview.classList.remove("hidden");
      }
      if (photoPlaceholder) photoPlaceholder.style.display = "none";
      if (changePhotoBtn) changePhotoBtn.classList.remove("hidden");
      if (ocrBtn) ocrBtn.classList.remove("hidden");
      if (ocrHint) ocrHint.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });
}

if (changePhotoBtn) {
  changePhotoBtn.addEventListener("click", () => {
    if (photoInput) photoInput.click();
  });
}

if (ocrBtn) {
  ocrBtn.addEventListener("click", async () => {
    if (!activePhotoDataUrl) return;
    ocrBtn.disabled = true;
    if (ocrProgress) ocrProgress.classList.remove("hidden");
    try {
      const text = await runOCR(activePhotoDataUrl);
      // copy OCR result into textarea and switch to text tab
      if (importTextarea) importTextarea.value = text;
      switchImportTab("text");
    } catch (err) {
      console.error("OCR failed:", err);
      alert("识别失败：" + (err.message || "请检查网络连接后重试"));
    } finally {
      ocrBtn.disabled = false;
      if (ocrProgress) ocrProgress.classList.add("hidden");
    }
  });
}

// Parse button
if (parseBtn) {
  parseBtn.addEventListener("click", async () => {
    const text = importTextarea ? importTextarea.value : "";
    const parsed = parseWordListText(text);
    if (parsed.length === 0) {
      alert("未能识别出有效单词。请检查格式，每行一个单词。");
      return;
    }
    if (editingWords.length > 0) {
      if (!await showConfirm("现存列表将被覆盖，确定重新解析吗？")) return;
    }
    buildWordTable(parsed);
    // suggest a default name with word count, avoiding duplicates
    if (listNameInput && !listNameInput.value) {
      const now = new Date();
      const base = `词库${now.getMonth() + 1}月${now.getDate()}日 (${parsed.length})`;
      const existing = loadCustomLists();
      let candidate = base;
      let suffix = 2;
      while (existing[candidate]) {
        candidate = `${base}-${suffix++}`;
      }
      listNameInput.value = candidate;
    }
    showImportStep(2);
  });
}

// Add word row button
if (addWordBtn) {
  addWordBtn.addEventListener("click", addEmptyWordRow);
}

// Back button
if (backToStep1Btn) {
  backToStep1Btn.addEventListener("click", async () => {
    if (editingListName) {
      // came directly from editing — close modal instead of going to step 1
      if (!await showConfirm("未保存的更改将会丢失，确定关闭吗？")) return;
      editingListName = null;
      closeImportModal(true);
    } else {
      showImportStep(1);
    }
  });
}

// Save button
if (saveListBtn) {
  saveListBtn.addEventListener("click", () => {
    const validWords = editingWords.filter((w) => w.en && w.en.trim());
    if (validWords.length === 0) {
      alert("词库为空，请至少添加一个单词。");
      return;
    }
    const rawName = (listNameInput ? listNameInput.value.trim() : "") || "我的词库";
    // sanitize name
    const name = rawName.replace(/[\\/:*?"<>|]/g, "_").substring(0, 20);
    const all = loadCustomLists();
    // If renaming, check new name doesn't conflict with another existing list
    if (editingListName && name !== editingListName && all[name]) {
      alert(`词库名称"${name}"已存在，请换一个名称。`);
      return;
    }
    const wordsToSave = validWords.map((w) => ({
      en: w.en.trim(),
      cn: (w.cn || "").trim(),
      ...(w.phonetic ? { phonetic: w.phonetic } : {}),
      ...(w.pos ? { pos: w.pos } : {}),
    }));
    // If editing and name changed, remove old entry
    if (editingListName && name !== editingListName) {
      delete all[editingListName];
      if (currentFile === "custom:" + editingListName) {
        currentFile = "custom:" + name;
      }
    }
    all[name] = { words: wordsToSave, created: all[name] ? all[name].created : Date.now() };
    saveCustomLists(all);
    editingListName = null;
    refreshCustomToggleBtns();
    closeImportModal(true);
    if (wordListSelect) {
      wordListSelect.value = "custom:" + name;
      wordListSelect.dispatchEvent(new Event("change"));
    }
  });
}

// Tab switching
document.querySelectorAll(".import-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchImportTab(tab.dataset.tab));
});

// Close button & backdrop click
if (importCloseBtn) {
  importCloseBtn.addEventListener("click", () => closeImportModal());
}
if (importModal) {
  importModal.addEventListener("click", (e) => {
    if (e.target !== importModal) return;
    const hasChanges = isImportStep2Visible() || (importTextarea && importTextarea.value.trim().length > 0) || !!activePhotoDataUrl;
    if (!hasChanges) closeImportModal(true);
  });
}

// Import button opens modal
if (importBtn) {
  importBtn.addEventListener("click", () => openImportModal());
}

// Keyboard close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && importModal && !importModal.classList.contains("hidden")) {
    closeImportModal(); // confirmation handled inside
  }
  if (e.key === "Escape") {
    closeWordListPopup();
  }
});

// Init: render any previously saved custom list buttons
refreshCustomToggleBtns();

// ---------- Custom Word List Dropdown ----------
function buildWordListPopup() {
  const popup = document.getElementById("wordListPopup");
  if (!popup || !wordListSelect) return;
  popup.innerHTML = "";
  Array.from(wordListSelect.querySelectorAll("optgroup")).forEach((group) => {
    const isCustomGroup = group.dataset.custom === "1";
    const groupEl = document.createElement("div");
    groupEl.className = "wl-popup-group";
    const labelEl = document.createElement("div");
    labelEl.className = "wl-popup-group-label";
    labelEl.textContent = group.label;
    groupEl.appendChild(labelEl);
    Array.from(group.querySelectorAll("option")).forEach((opt) => {
      const optEl = document.createElement("div");
      optEl.className = "wl-popup-option";
      if (opt.value === wordListSelect.value) optEl.classList.add("selected");
      optEl.dataset.value = opt.value;
      if (isCustomGroup) {
        optEl.classList.add("wl-popup-option-custom");
        const nameSpan = document.createElement("span");
        nameSpan.className = "wl-popup-option-text";
        nameSpan.textContent = opt.textContent;
        nameSpan.addEventListener("click", (e) => {
          e.stopPropagation();
          wordListSelect.value = optEl.dataset.value;
          wordListSelect.dispatchEvent(new Event("change"));
          closeWordListPopup();
        });
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "wl-popup-edit-btn";
        editBtn.textContent = "编辑";
        editBtn.setAttribute("aria-label", `编辑词库 ${opt.textContent}`);
        const listName = opt.value.slice(7); // remove "custom:"
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeWordListPopup();
          openImportModal(listName);
        });
        optEl.appendChild(nameSpan);
        optEl.appendChild(editBtn);
      } else {
        optEl.textContent = opt.textContent;
        optEl.addEventListener("click", (e) => {
          e.stopPropagation();
          wordListSelect.value = optEl.dataset.value;
          wordListSelect.dispatchEvent(new Event("change"));
          closeWordListPopup();
        });
      }
      groupEl.appendChild(optEl);
    });
    popup.appendChild(groupEl);
  });
  updateWordListBtnDisplay();
}

function updateWordListBtnDisplay() {
  const btn = document.getElementById("wordListBtn");
  const popup = document.getElementById("wordListPopup");
  if (!btn || !wordListSelect) return;
  const sel = wordListSelect.options[wordListSelect.selectedIndex];
  btn.textContent = sel ? sel.text : "";
  if (popup) {
    popup.querySelectorAll(".wl-popup-option").forEach((el) => {
      el.classList.toggle("selected", el.dataset.value === wordListSelect.value);
    });
  }
}

function closeWordListPopup() {
  const popup = document.getElementById("wordListPopup");
  const btn = document.getElementById("wordListBtn");
  if (popup) popup.classList.add("hidden");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

(function initWordListCustomSelect() {
  const btn = document.getElementById("wordListBtn");
  const popup = document.getElementById("wordListPopup");
  if (!btn || !popup) return;
  buildWordListPopup();
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!popup.classList.contains("hidden")) {
      closeWordListPopup();
    } else {
      popup.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
    }
  });
  popup.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeWordListPopup);
  if (wordListSelect) {
    wordListSelect.addEventListener("change", updateWordListBtnDisplay);
  }
})();
