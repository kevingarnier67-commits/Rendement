(() => {
  "use strict";

  const KEYS = {
    settings: "rendement.settings.v1",
    entries: "rendement.entries.v1",
    draft: "rendement.draft.v1",
    activeTimer: "rendement.activeTimer.v1",
  };

  const DEFAULT_CATEGORIES = [
    { id: "changement", label: "Changement de série / format" },
    { id: "panne", label: "Panne / maintenance" },
    { id: "reunion", label: "Réunion / formation" },
    { id: "entraide", label: "Entraide autre poste" },
    { id: "qualite", label: "Qualité / contrôle" },
    { id: "autre", label: "Autre" },
  ];

  const DEFAULT_SETTINGS = {
    cadence: null,
    categories: DEFAULT_CATEGORIES,
    theme: "auto",
  };

  // ---------- storage helpers ----------
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // ---------- time helpers ----------
  function pad2(n) { return String(n).padStart(2, "0"); }
  function nowHHMM() {
    const d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function formatDateFR(iso) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  function shiftMinutes(start, end) {
    if (!start || !end) return null;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;
    if (endMin <= startMin) endMin += 24 * 60;
    return endMin - startMin;
  }
  function formatMinutes(min) {
    if (min == null || isNaN(min)) return "--";
    const total = Math.round(min);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h <= 0) return `${m} min`;
    return `${h} h ${pad2(m)}`;
  }
  function formatHMS(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }

  // ---------- state ----------
  let settings = load(KEYS.settings, null) || structuredCloneSafe(DEFAULT_SETTINGS);
  if (!settings.categories || !settings.categories.length) settings.categories = DEFAULT_CATEGORIES;

  function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }

  function freshDraft() {
    return {
      date: todayISO(),
      poste: "",
      heureDebut: nowHHMM(),
      heureFin: "",
      quantite: null,
      cadence: null,
      nonProdSessions: [],
      note: "",
    };
  }

  let draft = load(KEYS.draft, null) || freshDraft();
  let activeTimer = load(KEYS.activeTimer, null);
  let entries = load(KEYS.entries, []);

  let pendingModalCategoryId = null; // selection state for "start timer" modal
  let pendingManualCategoryId = null; // selection state for "manual add" modal

  function persistSettings() { save(KEYS.settings, settings); }
  function persistDraft() { save(KEYS.draft, draft); }
  function persistActiveTimer() { save(KEYS.activeTimer, activeTimer); }
  function persistEntries() { save(KEYS.entries, entries); }

  // ---------- computation ----------
  function sumNonProdMs(sessions) {
    return sessions.reduce((acc, s) => acc + s.durationMs, 0);
  }

  function computeResult(d) {
    const ouvertureMin = shiftMinutes(d.heureDebut, d.heureFin);
    const nonProdMin = sumNonProdMs(d.nonProdSessions) / 60000;
    const netMin = ouvertureMin != null ? ouvertureMin - nonProdMin : null;
    const cadence = d.cadence || settings.cadence;
    let rendement = null;
    if (netMin != null && netMin > 0 && cadence && cadence > 0 && d.quantite != null && d.quantite !== "") {
      const tempsTheoriqueMin = (Number(d.quantite) / Number(cadence)) * 60;
      rendement = (tempsTheoriqueMin / netMin) * 100;
    }
    return { ouvertureMin, nonProdMin, netMin, rendement };
  }

  function rendementClass(pct) {
    if (pct == null) return "";
    if (pct >= 95) return "good";
    if (pct >= 80) return "mid";
    return "low";
  }

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);

  const el = {
    todayDate: $("today-date"),
    poste: $("input-poste"),
    heureDebut: $("input-heure-debut"),
    heureFin: $("input-heure-fin"),
    btnFinMaintenant: $("btn-fin-maintenant"),
    nonProdTotal: $("non-prod-total"),
    timerIdle: $("timer-idle"),
    timerRunning: $("timer-running"),
    btnStartTimer: $("btn-start-timer"),
    btnAddManual: $("btn-add-manual"),
    btnStopTimer: $("btn-stop-timer"),
    timerCategoryLabel: $("timer-category-label"),
    timerElapsed: $("timer-elapsed"),
    nonProdList: $("non-prod-list"),
    quantite: $("input-quantite"),
    cadence: $("input-cadence"),
    resultOuverture: $("result-ouverture"),
    resultNonProd: $("result-non-prod"),
    resultNet: $("result-net"),
    rendementValue: $("rendement-value"),
    note: $("input-note"),
    btnSaveEntry: $("btn-save-entry"),
    btnResetDraft: $("btn-reset-draft"),

    historyList: $("history-list"),
    historyEmpty: $("history-empty"),
    btnExportCsv: $("btn-export-csv"),

    settingsCadence: $("settings-cadence"),
    categoryList: $("category-list"),
    newCategoryInput: $("new-category-input"),
    btnAddCategory: $("btn-add-category"),
    themeToggle: $("theme-toggle"),
    btnResetAll: $("btn-reset-all"),

    modalCategory: $("modal-category"),
    modalCategoryList: $("modal-category-list"),
    modalCategoryNote: $("modal-category-note"),
    modalCategoryCancel: $("modal-category-cancel"),
    modalCategoryConfirm: $("modal-category-confirm"),

    modalManual: $("modal-manual"),
    modalManualCategoryList: $("modal-manual-category-list"),
    modalManualDuration: $("modal-manual-duration"),
    modalManualNote: $("modal-manual-note"),
    modalManualCancel: $("modal-manual-cancel"),
    modalManualConfirm: $("modal-manual-confirm"),

    modalDetail: $("modal-detail"),
    modalDetailTitle: $("modal-detail-title"),
    modalDetailBody: $("modal-detail-body"),
    modalDetailDelete: $("modal-detail-delete"),
    modalDetailClose: $("modal-detail-close"),

    toast: $("toast"),
  };

  // ---------- rendering ----------
  function renderTodayHeader() {
    const d = new Date();
    el.todayDate.textContent = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }

  function renderDraftFields() {
    el.poste.value = draft.poste || "";
    el.heureDebut.value = draft.heureDebut || "";
    el.heureFin.value = draft.heureFin || "";
    el.quantite.value = draft.quantite == null ? "" : draft.quantite;
    el.cadence.value = draft.cadence == null ? "" : draft.cadence;
    el.note.value = draft.note || "";
  }

  function categoryLabel(categoryId, fallbackLabel) {
    const cat = settings.categories.find((c) => c.id === categoryId);
    return cat ? cat.label : (fallbackLabel || "Autre");
  }

  function renderNonProdList() {
    el.nonProdList.innerHTML = "";
    draft.nonProdSessions.forEach((s) => {
      const li = document.createElement("li");
      const main = document.createElement("div");
      main.className = "session-item-main";
      const cat = document.createElement("span");
      cat.className = "session-item-cat";
      cat.textContent = categoryLabel(s.categoryId, s.label);
      main.appendChild(cat);
      if (s.note) {
        const note = document.createElement("span");
        note.className = "session-item-note";
        note.textContent = s.note;
        main.appendChild(note);
      }
      const right = document.createElement("div");
      right.className = "session-item-right";
      const dur = document.createElement("span");
      dur.className = "session-item-duration";
      dur.textContent = formatMinutes(s.durationMs / 60000);
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        draft.nonProdSessions = draft.nonProdSessions.filter((x) => x.id !== s.id);
        persistDraft();
        renderAll();
      });
      right.appendChild(dur);
      right.appendChild(del);
      li.appendChild(main);
      li.appendChild(right);
      el.nonProdList.appendChild(li);
    });
  }

  function renderTimerBlock() {
    if (activeTimer) {
      el.timerIdle.classList.add("hidden");
      el.timerRunning.classList.remove("hidden");
      el.timerCategoryLabel.textContent = categoryLabel(activeTimer.categoryId, activeTimer.label) + (activeTimer.note ? ` — ${activeTimer.note}` : "");
    } else {
      el.timerIdle.classList.remove("hidden");
      el.timerRunning.classList.add("hidden");
    }
  }

  function renderResults() {
    const liveSessions = draft.nonProdSessions.slice();
    if (activeTimer) {
      liveSessions.push({ durationMs: Date.now() - activeTimer.startedAt });
    }
    const r = computeResult({ ...draft, nonProdSessions: liveSessions });
    el.resultOuverture.textContent = formatMinutes(r.ouvertureMin);
    el.resultNonProd.textContent = formatMinutes(r.nonProdMin);
    el.resultNet.textContent = formatMinutes(r.netMin);
    if (r.rendement == null) {
      el.rendementValue.textContent = "--";
      el.rendementValue.className = "rendement-value";
    } else {
      el.rendementValue.textContent = Math.round(r.rendement) + " %";
      el.rendementValue.className = "rendement-value " + rendementClass(r.rendement);
    }
    el.nonProdTotal.textContent = formatMinutes(r.nonProdMin);
  }

  function renderToday() {
    renderTodayHeader();
    renderDraftFields();
    renderNonProdList();
    renderTimerBlock();
    renderResults();
  }

  function renderHistory() {
    el.historyList.innerHTML = "";
    const sorted = entries.slice().sort((a, b) => (a.date < b.date ? 1 : -1) || (b.createdAt - a.createdAt));
    el.historyEmpty.classList.toggle("hidden", sorted.length > 0);
    sorted.forEach((entry) => {
      const li = document.createElement("li");
      const top = document.createElement("div");
      top.className = "history-row-top";
      const left = document.createElement("span");
      left.textContent = formatDateFR(entry.date) + (entry.poste ? ` · ${entry.poste}` : "");
      const rend = document.createElement("span");
      rend.className = "history-rendement " + rendementClass(entry.result.rendement);
      rend.textContent = entry.result.rendement != null ? Math.round(entry.result.rendement) + " %" : "--";
      top.appendChild(left);
      top.appendChild(rend);
      const bottom = document.createElement("div");
      bottom.className = "history-row-bottom";
      bottom.innerHTML = `<span>Non-productif : ${formatMinutes(entry.result.nonProdMin)}</span><span>Qté : ${entry.quantite ?? "--"}</span>`;
      li.appendChild(top);
      li.appendChild(bottom);
      li.addEventListener("click", () => openDetailModal(entry));
      el.historyList.appendChild(li);
    });
  }

  function renderSettingsView() {
    el.settingsCadence.value = settings.cadence == null ? "" : settings.cadence;
    el.categoryList.innerHTML = "";
    settings.categories.forEach((cat) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = cat.label;
      li.appendChild(span);
      if (cat.id !== "autre") {
        const del = document.createElement("button");
        del.className = "icon-btn";
        del.textContent = "✕";
        del.addEventListener("click", () => {
          settings.categories = settings.categories.filter((c) => c.id !== cat.id);
          persistSettings();
          renderSettingsView();
        });
        li.appendChild(del);
      }
      el.categoryList.appendChild(li);
    });
    Array.from(el.themeToggle.children).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === settings.theme);
    });
  }

  function renderAll() {
    renderToday();
    renderHistory();
    renderSettingsView();
  }

  // ---------- toast ----------
  let toastTimeout = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.toast.classList.add("hidden"), 2200);
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

  // ---------- draft field bindings ----------
  el.poste.addEventListener("input", () => { draft.poste = el.poste.value; persistDraft(); });
  el.heureDebut.addEventListener("change", () => { draft.heureDebut = el.heureDebut.value; persistDraft(); renderResults(); });
  el.heureFin.addEventListener("change", () => { draft.heureFin = el.heureFin.value; persistDraft(); renderResults(); });
  el.btnFinMaintenant.addEventListener("click", () => {
    draft.heureFin = nowHHMM();
    el.heureFin.value = draft.heureFin;
    persistDraft();
    renderResults();
  });
  el.quantite.addEventListener("input", () => {
    draft.quantite = el.quantite.value === "" ? null : Number(el.quantite.value);
    persistDraft();
    renderResults();
  });
  el.cadence.addEventListener("input", () => {
    draft.cadence = el.cadence.value === "" ? null : Number(el.cadence.value);
    persistDraft();
    renderResults();
  });
  el.note.addEventListener("input", () => { draft.note = el.note.value; persistDraft(); });

  el.btnResetDraft.addEventListener("click", () => {
    if (!confirm("Réinitialiser le brouillon du jour ? Les données non enregistrées seront perdues.")) return;
    draft = freshDraft();
    activeTimer = null;
    persistDraft();
    persistActiveTimer();
    renderAll();
    toast("Brouillon réinitialisé");
  });

  // ---------- timer: start ----------
  function openCategoryModal() {
    pendingModalCategoryId = null;
    el.modalCategoryNote.value = "";
    el.modalCategoryList.innerHTML = "";
    settings.categories.forEach((cat) => {
      const li = document.createElement("li");
      li.textContent = cat.label;
      li.addEventListener("click", () => {
        pendingModalCategoryId = cat.id;
        Array.from(el.modalCategoryList.children).forEach((c) => c.classList.remove("selected"));
        li.classList.add("selected");
      });
      el.modalCategoryList.appendChild(li);
    });
    el.modalCategory.classList.remove("hidden");
  }
  el.btnStartTimer.addEventListener("click", openCategoryModal);
  el.modalCategoryCancel.addEventListener("click", () => el.modalCategory.classList.add("hidden"));
  el.modalCategoryConfirm.addEventListener("click", () => {
    if (!pendingModalCategoryId) { toast("Choisis un motif"); return; }
    activeTimer = {
      startedAt: Date.now(),
      categoryId: pendingModalCategoryId,
      note: el.modalCategoryNote.value.trim(),
    };
    persistActiveTimer();
    el.modalCategory.classList.add("hidden");
    renderTimerBlock();
    renderResults();
  });

  el.btnStopTimer.addEventListener("click", () => {
    if (!activeTimer) return;
    const durationMs = Date.now() - activeTimer.startedAt;
    draft.nonProdSessions.push({
      id: uuid(),
      categoryId: activeTimer.categoryId,
      note: activeTimer.note,
      durationMs,
    });
    activeTimer = null;
    persistDraft();
    persistActiveTimer();
    renderAll();
  });

  // ---------- manual add ----------
  function openManualModal() {
    pendingManualCategoryId = null;
    el.modalManualDuration.value = "";
    el.modalManualNote.value = "";
    el.modalManualCategoryList.innerHTML = "";
    settings.categories.forEach((cat) => {
      const li = document.createElement("li");
      li.textContent = cat.label;
      li.addEventListener("click", () => {
        pendingManualCategoryId = cat.id;
        Array.from(el.modalManualCategoryList.children).forEach((c) => c.classList.remove("selected"));
        li.classList.add("selected");
      });
      el.modalManualCategoryList.appendChild(li);
    });
    el.modalManual.classList.remove("hidden");
  }
  el.btnAddManual.addEventListener("click", openManualModal);
  el.modalManualCancel.addEventListener("click", () => el.modalManual.classList.add("hidden"));
  el.modalManualConfirm.addEventListener("click", () => {
    const minutes = Number(el.modalManualDuration.value);
    if (!pendingManualCategoryId) { toast("Choisis un motif"); return; }
    if (!minutes || minutes <= 0) { toast("Indique une durée valide"); return; }
    draft.nonProdSessions.push({
      id: uuid(),
      categoryId: pendingManualCategoryId,
      note: el.modalManualNote.value.trim(),
      durationMs: minutes * 60000,
    });
    persistDraft();
    el.modalManual.classList.add("hidden");
    renderAll();
  });

  // ---------- save entry to history ----------
  el.btnSaveEntry.addEventListener("click", () => {
    if (!draft.heureFin) { toast("Renseigne l'heure de fin"); return; }
    if (activeTimer) { toast("Arrête d'abord la pause en cours"); return; }
    const result = computeResult(draft);
    const entry = {
      id: uuid(),
      date: draft.date,
      poste: draft.poste,
      heureDebut: draft.heureDebut,
      heureFin: draft.heureFin,
      quantite: draft.quantite,
      cadence: draft.cadence || settings.cadence,
      nonProdSessions: draft.nonProdSessions,
      note: draft.note,
      result,
      createdAt: Date.now(),
    };
    entries.push(entry);
    persistEntries();
    draft = freshDraft();
    persistDraft();
    renderAll();
    toast("Journée enregistrée");
    document.querySelector('.tab-btn[data-view="view-today"]').click();
  });

  // ---------- history detail modal ----------
  let detailEntryId = null;
  function openDetailModal(entry) {
    detailEntryId = entry.id;
    el.modalDetailTitle.textContent = formatDateFR(entry.date) + (entry.poste ? ` · ${entry.poste}` : "");
    const rows = [
      ["Horaires", `${entry.heureDebut || "--"} → ${entry.heureFin || "--"}`],
      ["Quantité produite", entry.quantite ?? "--"],
      ["Cadence théorique", entry.cadence ? entry.cadence + " pièces/h" : "--"],
      ["Temps d'ouverture", formatMinutes(entry.result.ouvertureMin)],
      ["Temps non-productif", formatMinutes(entry.result.nonProdMin)],
      ["Temps net", formatMinutes(entry.result.netMin)],
      ["Rendement", entry.result.rendement != null ? Math.round(entry.result.rendement) + " %" : "--"],
    ];
    let html = rows.map(([k, v]) => `<div class="detail-row"><span>${k}</span><span>${v}</span></div>`).join("");
    if (entry.nonProdSessions.length) {
      html += `<div class="detail-row"><span>Pauses</span><span></span></div>`;
      entry.nonProdSessions.forEach((s) => {
        html += `<div class="detail-row"><span>${categoryLabel(s.categoryId, s.label)}${s.note ? " - " + escapeHtml(s.note) : ""}</span><span>${formatMinutes(s.durationMs / 60000)}</span></div>`;
      });
    }
    if (entry.note) html += `<div class="detail-note">${escapeHtml(entry.note)}</div>`;
    el.modalDetailBody.innerHTML = html;
    el.modalDetail.classList.remove("hidden");
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  el.modalDetailClose.addEventListener("click", () => el.modalDetail.classList.add("hidden"));
  el.modalDetailDelete.addEventListener("click", () => {
    if (!confirm("Supprimer cette journée de l'historique ?")) return;
    entries = entries.filter((e) => e.id !== detailEntryId);
    persistEntries();
    el.modalDetail.classList.add("hidden");
    renderHistory();
    toast("Supprimé");
  });

  // ---------- CSV export ----------
  el.btnExportCsv.addEventListener("click", () => {
    if (!entries.length) { toast("Aucune donnée à exporter"); return; }
    const header = ["Date", "Poste", "Debut", "Fin", "Quantite", "Cadence", "Ouverture(min)", "NonProductif(min)", "Net(min)", "Rendement(%)", "Note"];
    const rows = entries.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => [
      e.date,
      e.poste || "",
      e.heureDebut || "",
      e.heureFin || "",
      e.quantite ?? "",
      e.cadence ?? "",
      e.result.ouvertureMin != null ? Math.round(e.result.ouvertureMin) : "",
      Math.round(e.result.nonProdMin),
      e.result.netMin != null ? Math.round(e.result.netMin) : "",
      e.result.rendement != null ? Math.round(e.result.rendement) : "",
      (e.note || "").replace(/\n/g, " "),
    ]);
    const csvLines = [header, ...rows].map((r) =>
      r.map((cell) => {
        const s = String(cell);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";")
    );
    const blob = new Blob(["﻿" + csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rendement-export-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  // ---------- settings ----------
  el.settingsCadence.addEventListener("input", () => {
    settings.cadence = el.settingsCadence.value === "" ? null : Number(el.settingsCadence.value);
    persistSettings();
    renderResults();
  });
  el.btnAddCategory.addEventListener("click", () => {
    const label = el.newCategoryInput.value.trim();
    if (!label) return;
    settings.categories.splice(settings.categories.length - 1, 0, { id: uuid(), label });
    el.newCategoryInput.value = "";
    persistSettings();
    renderSettingsView();
  });
  Array.from(el.themeToggle.children).forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.theme = btn.dataset.theme;
      persistSettings();
      applyTheme();
      renderSettingsView();
    });
  });
  function applyTheme() {
    if (settings.theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", settings.theme);
    }
  }

  el.btnResetAll.addEventListener("click", () => {
    if (!confirm("Supprimer TOUTES les données (historique, réglages, brouillon) ? Cette action est irréversible.")) return;
    localStorage.removeItem(KEYS.settings);
    localStorage.removeItem(KEYS.entries);
    localStorage.removeItem(KEYS.draft);
    localStorage.removeItem(KEYS.activeTimer);
    settings = structuredCloneSafe(DEFAULT_SETTINGS);
    entries = [];
    draft = freshDraft();
    activeTimer = null;
    applyTheme();
    renderAll();
    toast("Données réinitialisées");
  });

  // ---------- live timer tick ----------
  setInterval(() => {
    if (activeTimer) {
      el.timerElapsed.textContent = formatHMS(Date.now() - activeTimer.startedAt);
      renderResults();
    }
  }, 1000);

  // ---------- init ----------
  applyTheme();
  renderAll();
  if (activeTimer) el.timerElapsed.textContent = formatHMS(Date.now() - activeTimer.startedAt);

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
