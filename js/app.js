(() => {
  "use strict";

  const KEY = "rendement.app.v3";
  const OLD_KEY = "rendement.timer.v2";

  const PALETTE = ["#4da3ff", "#b07cff", "#ff9d42", "#2fd4b5", "#ff6b9d", "#ffd84d", "#6ee7a0", "#ff8360"];

  const DEFAULT_CATEGORIES = [
    { id: "cms", label: "TEMPS CMS", color: "#4da3ff", builtin: true },
    { id: "cf", label: "TEMPS CF", color: "#b07cff", builtin: true },
    { id: "rep", label: "TEMPS RÉPARATION", color: "#ff9d42", builtin: true },
  ];

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  const DEFAULT_BASE = 455;

  const DEFAULT_PRODUCTS = [
    { id: "poles", label: "Pôles" },
    { id: "poles80", label: "Pôles 80/100A" },
    { id: "s1", label: "S1" },
    { id: "liaisons", label: "Liaisons" },
    { id: "cages", label: "Cages" },
    { id: "mfv", label: "MFV" },
  ];

  // Le temps par pièce (unit) est mémorisé d'un jour à l'autre ; seules les quantités (qty) sont remises à zéro.
  function freshCalc() {
    return {
      base: DEFAULT_BASE,
      products: DEFAULT_PRODUCTS.map((p) => ({ ...p, unit: "", builtin: true })),
      qty: {},
    };
  }

  function normalizeCalc(calc) {
    if (!calc) return freshCalc();
    if (Array.isArray(calc.products)) return calc;
    // migration depuis la version à lignes libres (quantité × min/pièce sans nom de matière)
    const next = freshCalc();
    if (calc.base != null && calc.base !== "") next.base = calc.base;
    (calc.lines || [])
      .filter((l) => parseNum(l.qty) > 0 || parseNum(l.unit) > 0)
      .forEach((l, i) => {
        const id = uuid();
        next.products.push({ id, label: `Référence ${i + 1}`, unit: l.unit, builtin: false });
        next.qty[id] = l.qty;
      });
    return next;
  }

  function freshState() {
    return {
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      totals: {},
      active: null,
      history: [],
      calc: freshCalc(),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.categories)) {
          s.calc = normalizeCalc(s.calc);
          return s;
        }
      }
      // migration depuis la version précédente (3 catégories fixes, pas d'historique)
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const o = JSON.parse(old);
        const s = freshState();
        if (o && o.totals) s.totals = o.totals;
        if (o && o.active) s.active = o.active;
        localStorage.removeItem(OLD_KEY);
        return s;
      }
    } catch (e) { /* état corrompu -> repart de zéro */ }
    return freshState();
  }

  let state = load();

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  // ---------- formatting ----------
  function pad2(n) { return String(n).padStart(2, "0"); }

  // Tout est exprimé en minutes, jamais en heures (ex : 75 min, pas 1:15).
  function minutesOf(ms) { return Math.floor(ms / 60000); }

  function formatMinutes(ms) { return `${minutesOf(ms)} min`; }

  function formatMinSec(ms) {
    const totalSec = Math.floor(ms / 1000);
    return `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;
  }

  function formatNumber(n, decimals) {
    return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  function parseNum(str) {
    const n = parseFloat(String(str).replace(",", ".").replace(/\s/g, ""));
    return isFinite(n) ? n : 0;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    date: $("today-date"),
    status: $("hero-status"),
    statusText: $("hero-status-text"),
    timer: $("hero-timer"),
    hint: $("hero-hint"),
    catList: $("cat-list"),
    grandTotal: $("grand-total"),
    saveDay: $("btn-save-day"),
    reset: $("btn-reset"),
    manageCats: $("btn-manage-cats"),
    calcBase: $("calc-base"),
    calcMinuted: $("calc-minuted"),
    calcNet: $("calc-net"),
    calcProducts: $("calc-products"),
    calcAddProduct: $("btn-add-product"),
    calcProduced: $("calc-produced"),
    calcRendement: $("calc-rendement"),
    calcClear: $("btn-calc-clear"),
    historyList: $("history-list"),
    historyEmpty: $("history-empty"),
    modalCats: $("modal-cats"),
    newCatInput: $("new-cat-input"),
    addCat: $("btn-add-cat"),
    customCatSection: $("custom-cat-section"),
    customCatList: $("custom-cat-list"),
    modalCatsClose: $("modal-cats-close"),
    toast: $("toast"),
  };

  el.date.textContent = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });

  let toastTimeout = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.toast.classList.add("hidden"), 2200);
  }

  // ---------- timer logic ----------
  function totalOf(id) { return state.totals[id] || 0; }

  function activeElapsed() {
    return state.active ? Date.now() - state.active.startedAt : 0;
  }

  function stopActive() {
    if (!state.active) return;
    state.totals[state.active.id] = totalOf(state.active.id) + activeElapsed();
    state.active = null;
    persist();
  }

  function startCategory(id) {
    state.active = { id, startedAt: Date.now() };
    persist();
  }

  function liveTotalOf(id) {
    return totalOf(id) + (state.active && state.active.id === id ? activeElapsed() : 0);
  }

  // Somme des minutes affichées par catégorie, pour que le total colle toujours au détail.
  function minutedMinutes() {
    return state.categories.reduce((acc, c) => acc + minutesOf(liveTotalOf(c.id)), 0);
  }

  // ---------- category cards ----------
  function renderCats() {
    el.catList.innerHTML = "";
    state.categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat";
      btn.dataset.cat = cat.id;
      btn.style.setProperty("--c", cat.color);
      btn.innerHTML = `
        <span class="cat-left">
          <span class="cat-icon" aria-hidden="true"></span>
          <span class="cat-name"></span>
        </span>
        <span class="cat-right">
          <span class="cat-total">0 min</span>
          <span class="cat-action">▶</span>
        </span>`;
      btn.querySelector(".cat-name").textContent = cat.label;
      btn.addEventListener("click", () => {
        if (state.active && state.active.id === cat.id) {
          stopActive();
        } else {
          stopActive();
          startCategory(cat.id);
        }
        render();
      });
      el.catList.appendChild(btn);
    });
  }

  // ---------- main render ----------
  function render() {
    const activeId = state.active ? state.active.id : null;
    const activeCat = activeId ? state.categories.find((c) => c.id === activeId) : null;

    Array.from(el.catList.children).forEach((btn) => {
      const id = btn.dataset.cat;
      const isActive = id === activeId;
      btn.classList.toggle("active", isActive);
      btn.querySelector(".cat-action").textContent = isActive ? "■" : "▶";
      btn.querySelector(".cat-total").textContent = formatMinutes(liveTotalOf(id));
    });

    if (activeCat) {
      el.status.classList.add("running");
      el.status.style.setProperty("--active-color", activeCat.color);
      el.statusText.textContent = activeCat.label;
      el.timer.classList.add("running");
      el.timer.style.setProperty("--active-color", activeCat.color);
      el.timer.textContent = formatMinSec(activeElapsed());
      el.hint.textContent = "Appuie à nouveau pour arrêter";
    } else {
      el.status.classList.remove("running");
      el.statusText.textContent = "En attente";
      el.timer.classList.remove("running");
      el.timer.textContent = "00:00";
      el.hint.textContent = "Appuie sur une catégorie pour démarrer";
    }

    el.grandTotal.textContent = `${minutedMinutes()} min`;
    renderCalcResults();
  }

  // ---------- calculatrice de rendement ----------
  // Temps de production = base (455 min) − minutes passées aux postes minutés.
  // Rendement = minutes produites (Σ quantité × temps/pièce par matière) ÷ temps de production.
  function computeCalc() {
    const base = parseNum(state.calc.base);
    const minuted = minutedMinutes();
    const net = base - minuted;
    const items = state.calc.products
      .map((p) => {
        const qty = parseNum(state.calc.qty[p.id]);
        const unit = parseNum(p.unit);
        return { label: p.label, qty, unit, minutes: qty * unit };
      })
      .filter((i) => i.qty > 0);
    const produced = items.reduce((acc, i) => acc + i.minutes, 0);
    const rendement = net > 0 && produced > 0 ? (produced / net) * 100 : null;
    return { base, minuted, net, produced, rendement, items };
  }

  function rendementClass(pct) {
    if (pct == null) return "";
    if (pct >= 95) return "good";
    if (pct >= 80) return "mid";
    return "low";
  }

  function renderCalcResults() {
    const c = computeCalc();
    el.calcMinuted.textContent = `${c.minuted} min`;
    el.calcNet.textContent = `${formatNumber(c.net, 1)} min`;
    el.calcProduced.textContent = `${formatNumber(c.produced, 1)} min`;
    el.calcRendement.textContent = c.rendement == null ? "--" : `${formatNumber(c.rendement, 1)} %`;
    el.calcRendement.className = "calc-result-value " + rendementClass(c.rendement);
    state.calc.products.forEach((p) => {
      const row = el.calcProducts.querySelector(`[data-prod="${p.id}"]`);
      if (!row) return;
      const qty = parseNum(state.calc.qty[p.id]);
      const unit = parseNum(p.unit);
      const out = row.querySelector(".prod-total");
      const missingUnit = qty > 0 && unit <= 0;
      out.textContent = missingUnit ? "temps/pièce ?" : `= ${formatNumber(qty * unit, 1)} min`;
      out.classList.toggle("warn", missingUnit);
      row.classList.toggle("filled", qty > 0);
    });
  }

  function renderCalcProducts() {
    el.calcBase.value = state.calc.base;
    el.calcProducts.innerHTML = "";
    state.calc.products.forEach((p) => {
      const row = document.createElement("div");
      row.className = "prod";
      row.dataset.prod = p.id;
      row.innerHTML = `
        <div class="prod-info">
          <div class="prod-name-row">
            <span class="prod-name"></span>
            <button type="button" class="prod-delete" aria-label="Supprimer la matière">✕</button>
          </div>
          <label class="prod-unit">
            <input type="text" inputmode="decimal" class="prod-unit-input" placeholder="0,00" />
            <span>min / pièce</span>
          </label>
        </div>
        <div class="prod-qty">
          <input type="text" inputmode="numeric" class="prod-qty-input" placeholder="Qté" />
          <span class="prod-total">= 0 min</span>
        </div>`;
      row.querySelector(".prod-name").textContent = p.label;
      const unit = row.querySelector(".prod-unit-input");
      const qty = row.querySelector(".prod-qty-input");
      unit.value = p.unit;
      qty.value = state.calc.qty[p.id] || "";
      unit.addEventListener("input", () => { p.unit = unit.value; persist(); renderCalcResults(); });
      qty.addEventListener("input", () => { state.calc.qty[p.id] = qty.value; persist(); renderCalcResults(); });
      const del = row.querySelector(".prod-delete");
      if (p.builtin) {
        del.remove();
      } else {
        del.addEventListener("click", () => {
          if (!confirm(`Supprimer « ${p.label} » ?`)) return;
          state.calc.products = state.calc.products.filter((x) => x.id !== p.id);
          delete state.calc.qty[p.id];
          persist();
          renderCalcProducts();
          renderCalcResults();
        });
      }
      el.calcProducts.appendChild(row);
    });
  }

  // ---------- save day / reset ----------
  function resetTotals() {
    state.totals = {};
    state.active = null;
    persist();
  }

  el.saveDay.addEventListener("click", () => {
    stopActive();
    const items = state.categories
      .map((c) => ({ label: c.label, color: c.color, ms: totalOf(c.id) }))
      .filter((i) => minutesOf(i.ms) > 0);
    const totalMs = items.reduce((acc, i) => acc + minutesOf(i.ms) * 60000, 0);
    const calc = computeCalc();
    if (totalMs === 0 && calc.produced === 0) { toast("Rien à enregistrer"); return; }
    if (!confirm("Enregistrer la journée dans l'historique et remettre les compteurs à zéro ?")) return;
    const now = new Date();
    state.history.unshift({
      id: uuid(),
      savedAt: now.getTime(),
      dateLabel: now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      items,
      totalMs,
      calc: calc.produced > 0 ? calc : null,
    });
    state.calc.qty = {};
    resetTotals();
    renderCalcProducts();
    renderHistory();
    render();
    toast("Journée enregistrée ✓");
  });

  el.calcBase.addEventListener("input", () => {
    state.calc.base = el.calcBase.value;
    persist();
    renderCalcResults();
  });

  el.calcAddProduct.addEventListener("click", () => {
    const label = (prompt("Nom de la matière :") || "").trim();
    if (!label) return;
    if (state.calc.products.some((p) => p.label.toLowerCase() === label.toLowerCase())) {
      toast("Cette matière existe déjà");
      return;
    }
    state.calc.products.push({ id: uuid(), label, unit: "", builtin: false });
    persist();
    renderCalcProducts();
    renderCalcResults();
    toast(`« ${label} » ajoutée ✓`);
  });

  el.calcClear.addEventListener("click", () => {
    if (!confirm("Effacer les quantités ? (les temps par pièce sont conservés)")) return;
    state.calc.qty = {};
    persist();
    renderCalcProducts();
    renderCalcResults();
  });

  el.reset.addEventListener("click", () => {
    if (!confirm("Remettre tous les compteurs à zéro sans enregistrer ?")) return;
    resetTotals();
    render();
    toast("Compteurs remis à zéro");
  });

  // ---------- history ----------
  function renderHistory() {
    el.historyList.innerHTML = "";
    el.historyEmpty.classList.toggle("hidden", state.history.length > 0);
    state.history.forEach((entry) => {
      const card = document.createElement("div");
      card.className = "history-card";

      const head = document.createElement("div");
      head.className = "history-head";
      const dateSpan = document.createElement("span");
      dateSpan.className = "history-date";
      dateSpan.textContent = entry.dateLabel;
      const totalSpan = document.createElement("span");
      totalSpan.className = "history-total";
      if (entry.calc && entry.calc.rendement != null) {
        totalSpan.textContent = `${formatNumber(entry.calc.rendement, 1)} %`;
        totalSpan.classList.add(rendementClass(entry.calc.rendement));
      } else {
        totalSpan.textContent = formatMinutes(entry.totalMs);
      }
      head.appendChild(dateSpan);
      head.appendChild(totalSpan);
      card.appendChild(head);

      entry.items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "history-row";
        const left = document.createElement("span");
        left.className = "history-row-label";
        const dot = document.createElement("span");
        dot.className = "history-dot";
        dot.style.background = item.color || "#7d8a99";
        const label = document.createElement("span");
        label.textContent = item.label;
        left.appendChild(dot);
        left.appendChild(label);
        const time = document.createElement("span");
        time.className = "history-row-time";
        time.textContent = formatMinutes(item.ms);
        row.appendChild(left);
        row.appendChild(time);
        card.appendChild(row);
      });

      const summary = [["Total minuté", formatMinutes(entry.totalMs)]];
      if (entry.calc) {
        const c = entry.calc;
        summary.push(["Temps de production", `${formatNumber(c.base, 1)} − ${c.minuted} = ${formatNumber(c.net, 1)} min`]);
        (c.items || []).forEach((i) => {
          summary.push([`${i.label} : ${formatNumber(i.qty, 2)} × ${formatNumber(i.unit, 3)}`, `${formatNumber(i.minutes, 1)} min`]);
        });
        summary.push(
          ["Minutes produites", `${formatNumber(c.produced, 1)} min`],
          ["Rendement", c.rendement == null ? "--" : `${formatNumber(c.rendement, 1)} %`],
        );
      }
      summary.forEach(([k, v]) => {
        const row = document.createElement("div");
        row.className = "history-row history-summary";
        const left = document.createElement("span");
        left.className = "history-row-label";
        left.textContent = k;
        const right = document.createElement("span");
        right.className = "history-row-time";
        right.textContent = v;
        row.appendChild(left);
        row.appendChild(right);
        card.appendChild(row);
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "history-delete";
      del.textContent = "Supprimer";
      del.addEventListener("click", () => {
        if (!confirm("Supprimer cette journée de l'historique ?")) return;
        state.history = state.history.filter((e) => e.id !== entry.id);
        persist();
        renderHistory();
      });
      card.appendChild(del);

      el.historyList.appendChild(card);
    });
  }

  // ---------- tabs ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.view).classList.add("active");
    });
  });

  // ---------- category management ----------
  function nextColor() {
    const used = state.categories.map((c) => c.color);
    return PALETTE.find((c) => !used.includes(c)) || PALETTE[state.categories.length % PALETTE.length];
  }

  function renderCustomCats() {
    const customs = state.categories.filter((c) => !c.builtin);
    el.customCatSection.classList.toggle("hidden", customs.length === 0);
    el.customCatList.innerHTML = "";
    customs.forEach((cat) => {
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.className = "custom-cat-label";
      const dot = document.createElement("span");
      dot.className = "history-dot";
      dot.style.background = cat.color;
      const label = document.createElement("span");
      label.textContent = cat.label;
      left.appendChild(dot);
      left.appendChild(label);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "custom-cat-delete";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        const hasTime = totalOf(cat.id) > 0 || (state.active && state.active.id === cat.id);
        const msg = hasTime
          ? `Supprimer « ${cat.label} » ? Le temps compté aujourd'hui sur cette catégorie sera perdu.`
          : `Supprimer « ${cat.label} » ?`;
        if (!confirm(msg)) return;
        if (state.active && state.active.id === cat.id) state.active = null;
        delete state.totals[cat.id];
        state.categories = state.categories.filter((c) => c.id !== cat.id);
        persist();
        renderCats();
        render();
        renderCustomCats();
      });
      li.appendChild(left);
      li.appendChild(del);
      el.customCatList.appendChild(li);
    });
  }

  el.manageCats.addEventListener("click", () => {
    el.newCatInput.value = "";
    renderCustomCats();
    el.modalCats.classList.remove("hidden");
  });
  el.modalCatsClose.addEventListener("click", () => el.modalCats.classList.add("hidden"));
  el.modalCats.addEventListener("click", (e) => {
    if (e.target === el.modalCats) el.modalCats.classList.add("hidden");
  });

  el.addCat.addEventListener("click", () => {
    const label = el.newCatInput.value.trim().toUpperCase();
    if (!label) { toast("Écris un nom de catégorie"); return; }
    if (state.categories.some((c) => c.label === label)) { toast("Cette catégorie existe déjà"); return; }
    state.categories.push({ id: uuid(), label, color: nextColor(), builtin: false });
    persist();
    el.newCatInput.value = "";
    renderCats();
    render();
    renderCustomCats();
    toast(`« ${label} » ajoutée ✓`);
  });

  // ---------- live tick ----------
  setInterval(() => { if (state.active) render(); }, 500);

  // ---------- init ----------
  renderCats();
  renderCalcProducts();
  render();
  renderHistory();

  // ---------- bannière d'installation ----------
  const INSTALL_DISMISS_KEY = "rendement.installDismissed.v1";
  const installBanner = $("install-banner");
  const installIos = $("install-ios");
  const installAndroid = $("install-android");
  const installButton = $("install-button");
  const installDismiss = $("install-dismiss");
  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function maybeShowInstallBanner() {
    if (isStandalone()) return;
    if (localStorage.getItem(INSTALL_DISMISS_KEY)) return;
    if (isIos()) {
      installIos.classList.remove("hidden");
      installBanner.classList.remove("hidden");
    } else if (deferredInstallPrompt) {
      installAndroid.classList.remove("hidden");
      installBanner.classList.remove("hidden");
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    maybeShowInstallBanner();
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBanner.classList.add("hidden");
  });

  installDismiss.addEventListener("click", () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    installBanner.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => installBanner.classList.add("hidden"));

  maybeShowInstallBanner();

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
