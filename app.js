const wordEl = document.getElementById("word");
const phoneticEl = document.getElementById("phonetic");
const statusEl = document.getElementById("status");
const meaningEl = document.getElementById("meaning");
const nextBtn = document.getElementById("nextBtn");
const repeatBtn = document.getElementById("repeatBtn");
const showMeaningBtn = document.getElementById("showMeaningBtn");
const toggleBtns = Array.from(document.querySelectorAll(".toggle-btn"));

let words = [];
let current = null;
let recognition = null;
let listening = false;
let started = false;
let currentFile = "words-1500.json";

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
  statusEl.classList.remove("ok", "bad");
  if (type) statusEl.classList.add(type);
}

function speakWord(word) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(word.en);
  utter.lang = "en-US";
  utter.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

function nextWord() {
  if (!words.length) return;
  current = words[Math.floor(Math.random() * words.length)];
  wordEl.textContent = current.en;
  phoneticEl.textContent = current.phonetic || "";
  meaningEl.textContent = "";
  setStatus("请说出中文意思", null);
  repeatBtn.disabled = false;
  nextBtn.disabled = false;
  showMeaningBtn.disabled = false;
  speakWord(current);
  if (recognition && started) {
    startListening();
  }
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
    const transcript = Array.from(event.results)
      .map((r) => r[0].transcript)
      .join(" ");

    const ok = isCorrect(transcript, current);
    const wantsNext = /(?:下一个|继续|next)/i.test(transcript);
    const wantsRepeat = /(?:朗读|read|repeat)/i.test(transcript);
    const wantsChinese = /(?:中文|汉语|意思)/i.test(transcript);
    if (ok) {
      setStatus(`正确：${transcript}`, "ok");
    } else {
      setStatus(`不太对：${transcript}`, "bad");
    }
    meaningEl.textContent = `${current.cn}`;

    listening = false;
    if (wantsNext) {
      nextWord();
      return;
    }
    if (wantsRepeat) {
      speakWord(current);
    }
    if (wantsChinese) {
      meaningEl.textContent = `${current.cn}`;
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

function getSources(file) {
  if (file === "words-1500.json") return [...defaultSources];
  return [file];
}

function loadWordsFromInline(file) {
  if (!window.WORD_LISTS) return false;
  const list = window.WORD_LISTS[file];
  if (Array.isArray(list) && list.length) {
    words = list;
    return true;
  }
  return false;
}

async function loadWords(file) {
  words = [];
  if (loadWordsFromInline(file)) return true;
  const sources = getSources(file);
  for (const name of sources) {
    try {
      const res = await fetch(name);
      if (!res.ok) continue;
      const data = await res.json();
      const list = extractWords(data);
      if (list.length) {
        words = list;
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
    recognition = setupRecognition();
    started = true;
  }

  if (!recognition) {
    setStatus("当前浏览器不支持语音识别", "bad");
    return;
  }

  nextWord();
}

nextBtn.addEventListener("click", () => {
  stopListening();
  nextWord();
});

repeatBtn.addEventListener("click", () => {
  if (current) speakWord(current);
});

showMeaningBtn.addEventListener("click", () => {
  if (current) {
    meaningEl.textContent = `${current.cn}`;
  }
});

toggleBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const file = btn.dataset.file;
    if (!file) return;
    currentFile = file;
    toggleBtns.forEach((b) => b.classList.toggle("active", b === btn));
    stopListening();
    const ok = await loadWords(currentFile);
    if (ok && words.length) {
      nextWord();
    }
  });
});

autoStart();
