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

  function freshState() {
    return {
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      totals: {},
      active: null,
      history: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.categories)) return s;
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

  function formatHMS(ms) {
    const totalSec = Math.floor(ms / 1000);
    return `${pad2(Math.floor(totalSec / 3600))}:${pad2(Math.floor((totalSec % 3600) / 60))}:${pad2(totalSec % 60)}`;
  }

  function formatTotal(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
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

  function grandTotalMs() {
    return state.categories.reduce((acc, c) => acc + totalOf(c.id), 0) + activeElapsed();
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
          <span class="cat-total">00:00</span>
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
      btn.querySelector(".cat-total").textContent = formatTotal(totalOf(id) + (isActive ? activeElapsed() : 0));
    });

    if (activeCat) {
      el.status.classList.add("running");
      el.status.style.setProperty("--active-color", activeCat.color);
      el.statusText.textContent = activeCat.label;
      el.timer.classList.add("running");
      el.timer.style.setProperty("--active-color", activeCat.color);
      el.timer.textContent = formatHMS(activeElapsed());
      el.hint.textContent = "Appuie à nouveau pour arrêter";
    } else {
      el.status.classList.remove("running");
      el.statusText.textContent = "En attente";
      el.timer.classList.remove("running");
      el.timer.textContent = "00:00:00";
      el.hint.textContent = "Appuie sur une catégorie pour démarrer";
    }

    el.grandTotal.textContent = formatTotal(grandTotalMs());
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
      .filter((i) => i.ms > 0);
    const totalMs = items.reduce((acc, i) => acc + i.ms, 0);
    if (totalMs === 0) { toast("Aucun temps à enregistrer"); return; }
    if (!confirm("Enregistrer la journée dans l'historique et remettre les compteurs à zéro ?")) return;
    const now = new Date();
    state.history.unshift({
      id: uuid(),
      savedAt: now.getTime(),
      dateLabel: now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      items,
      totalMs,
    });
    resetTotals();
    renderHistory();
    render();
    toast("Journée enregistrée ✓");
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
      totalSpan.textContent = formatTotal(entry.totalMs);
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
        time.textContent = formatTotal(item.ms);
        row.appendChild(left);
        row.appendChild(time);
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
  render();
  renderHistory();

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
