// Фирменные подсказки вместо системных title (жёлтая коробочка браузера
// «дешевит»). Любой элемент с title получает ту же подсказку, что метки
// кошельков (.wb): тёмная карточка с лаймовой кромкой, появляется мгновенно,
// над элементом, а у края экрана — под ним. Ничего в разметке менять не
// надо: при первом наведении title переезжает в data-tip, чтобы браузер
// не показывал свою.
const SKIP = new Set(["wb"]); // у этих классов своя CSS-подсказка

let box = null, current = null, hideT = 0;

function ensureBox() {
  if (box) return box;
  box = document.createElement("div");
  box.className = "hood-tip";
  box.setAttribute("role", "tooltip");
  document.body.appendChild(box);
  return box;
}

function tipOf(el) {
  // свежий title важнее сохранённого: React переписывает его при смене языка
  const t = el.getAttribute("title");
  if (t) { el.dataset.tip = t; el.removeAttribute("title"); return t; } // системную подсказку глушим
  return el.dataset.tip || "";
}

function place(el) {
  const b = ensureBox();
  const r = el.getBoundingClientRect();
  const w = b.offsetWidth, h = b.offsetHeight;
  const vw = window.innerWidth, gap = 9;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(vw - w - 8, x));
  let y = r.top - h - gap, below = false;
  if (y < 6) { y = r.bottom + gap; below = true; }
  b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + window.scrollY)}px)`;
  b.classList.toggle("below", below);
  // стрелка — под серединой элемента
  const ax = r.left + r.width / 2 - x;
  b.style.setProperty("--ax", `${Math.round(Math.max(10, Math.min(w - 10, ax)))}px`);
}

function show(el) {
  const text = tipOf(el);
  if (!text) return;
  clearTimeout(hideT);
  current = el;
  const b = ensureBox();
  b.textContent = text;
  b.classList.add("on");
  place(el);
}

function hide() {
  current = null;
  hideT = setTimeout(() => { if (box && !current) box.classList.remove("on"); }, 40);
}

function target(e) {
  let el = e.target;
  while (el && el !== document.body) {
    if (el.classList && [...el.classList].some((c) => SKIP.has(c))) return null;
    if (el.hasAttribute && (el.hasAttribute("title") || el.dataset?.tip)) return el;
    el = el.parentElement;
  }
  return null;
}

export function installTooltips() {
  if (typeof document === "undefined" || window.__hoodTips) return;
  window.__hoodTips = true;
  document.addEventListener("mouseover", (e) => {
    const el = target(e);
    if (!el) { if (current) hide(); return; }
    if (el !== current) show(el);
  });
  document.addEventListener("mouseout", (e) => {
    const el = target(e);
    if (el && el === current && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => { const el = target(e); if (el) show(el); });
  document.addEventListener("focusout", () => hide());
  document.addEventListener("click", () => hide(), true);
  window.addEventListener("scroll", () => { if (current) place(current); }, { passive: true });
  // на тач-экранах подсказок нет — там нет наведения
}
