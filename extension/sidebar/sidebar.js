"use strict";

/*
 * BetterVertTabs – vertikale Sidebar mit angehefteten Kacheln.
 *
 * Prinzip: Bei jedem Tab-/Gruppen-Event wird der Zustand des Fensters neu
 * abgefragt und die Sidebar komplett neu gerendert (gedrosselt auf einen
 * Frame). Das ist simpel, robust und für ein paar hundert Tabs schnell genug.
 */

const api = globalThis.browser;
const hasGroups = !!(api.tabGroups && api.tabs.group);

const $pinned = document.getElementById("pinned");
const $groups = document.getElementById("groups");
const $tabs = document.getElementById("tabs");
const $menu = document.getElementById("menu");

const GROUP_COLORS = {
  grey: "#9e9ea6", blue: "#4f8cff", red: "#ff5c5c", yellow: "#ffcc33",
  green: "#3ecf6e", pink: "#ff6fb0", purple: "#a77bff", cyan: "#3fd0e0",
  orange: "#ff9640",
};

let windowId = null;
let tabs = [];
let groups = new Map(); // groupId -> {id,title,color,collapsed}
let dragTabId = null;
let renameGroupId = null;
let lastClick = { id: null, at: 0 };
let groupClickTimer = null;
let linkDragDepth = 0; // > 0 während ein Link/Lesezeichen von außen gezogen wird

/*
 * Kachel-Zustand pro Tab. Wird über die sessions-API direkt am Tab
 * gespeichert und übersteht damit auch Firefox-Neustarts.
 *   tileUrl    – die Seite, die beim Anheften offen war
 *   tileClosed – Kachel wurde „geschlossen“ (entladen, wartet auf Reset)
 */
const tileInfo = new Map(); // tabId -> {url, closed}
const store = {
  get: (id, key) => api.sessions.getTabValue(id, key).catch(() => undefined),
  set: (id, key, val) => api.sessions.setTabValue(id, key, val).catch(console.error),
  del: (id, key) => api.sessions.removeTabValue(id, key).catch(() => {}),
};
const isRealUrl = (url) => !!url && !/^(about:(blank|newtab|home)|chrome:|resource:)/.test(url);

/* ---------------------------------------------------------------- state */

async function refresh() {
  const [allTabs, allGroups] = await Promise.all([
    api.tabs.query({ windowId }),
    hasGroups ? api.tabGroups.query({ windowId }) : Promise.resolve([]),
  ]);
  tabs = allTabs.filter((t) => !t.hidden).sort((a, b) => a.index - b.index);
  groups = new Map(allGroups.map((g) => [g.id, g]));
  await loadTileInfo();
  render();
}

async function loadTileInfo() {
  const pinned = tabs.filter((t) => t.pinned);
  await Promise.all(pinned.map(async (t) => {
    let [url, closed] = await Promise.all([store.get(t.id, "tileUrl"), store.get(t.id, "tileClosed")]);
    // Kachel ohne gespeicherte Seite (z. B. von Firefox selbst angeheftet): aktuelle Seite merken
    if (!url && isRealUrl(t.url)) { url = t.url; store.set(t.id, "tileUrl", url); }
    // Geschlossene Kachel wurde (per Klick, Tastatur, …) wieder aktiviert -> auf Originalseite zurücksetzen
    if (closed && t.active) {
      closed = false;
      store.del(t.id, "tileClosed");
      if (url && url !== t.url) api.tabs.update(t.id, { url });
    }
    tileInfo.set(t.id, { url, closed: !!closed });
  }));
  for (const id of tileInfo.keys()) if (!pinned.some((t) => t.id === id)) tileInfo.delete(id);
}

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    refresh().catch(console.error);
  });
}

function svg(markup) {
  const doc = new DOMParser().parseFromString(markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '), "image/svg+xml");
  return document.importNode(doc.documentElement, true);
}

const tabById = (id) => tabs.find((t) => t.id === id);
const inGroup = (t) => t.groupId !== undefined && t.groupId !== -1;

/* --------------------------------------------------------------- render */

function render() {
  const pinned = tabs.filter((t) => t.pinned);
  const loose = tabs.filter((t) => !t.pinned);

  // Kacheln
  const dropSlot = document.createElement("div");
  dropSlot.className = "tile-drop";
  dropSlot.textContent = pinned.length ? "+" : "Hierher ziehen zum Anheften";
  $pinned.replaceChildren(...pinned.map(renderTile), dropSlot);
  $pinned.classList.toggle("empty", pinned.length === 0);

  // Gruppen in Tab-Reihenfolge
  const order = [];
  const members = new Map();
  for (const t of loose) {
    if (!inGroup(t)) continue;
    if (!members.has(t.groupId)) { members.set(t.groupId, []); order.push(t.groupId); }
    members.get(t.groupId).push(t);
  }
  $groups.replaceChildren(...order.map((gid) => renderGroup(gid, members.get(gid))));

  // Lose Tabs
  $tabs.replaceChildren(...loose.filter((t) => !inGroup(t)).map(renderRow));

  if (renameGroupId !== null) startRename(renameGroupId);
}

function renderTile(tab) {
  const info = tileInfo.get(tab.id) || {};
  const el = document.createElement("div");
  el.setAttribute("role", "button");
  el.className = "tile";
  el.classList.toggle("active", tab.active);
  el.classList.toggle("closed", !!info.closed);
  el.classList.toggle("discarded", !!tab.discarded);
  // Seite weicht von der angehefteten ab -> kleiner Punkt als Hinweis
  el.classList.toggle("navigated", !info.closed && !!info.url && sameUrl(info.url, tab.url) === false);
  el.title = info.closed
    ? `${tab.title || tab.url}\n(geschlossen – Klick öffnet die Originalseite)`
    : `${tab.title || tab.url}\nDoppelklick: zurück zur Originalseite`;
  el.dataset.tabId = tab.id;
  el.draggable = true;
  el.append(favicon(tab, "tile-icon"));
  if (!info.closed && (tab.audible || tab.mutedInfo?.muted)) el.append(audioBadge(tab));

  if (!info.closed) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tile-close";
    close.title = "Kachel schließen";
    close.append(svg('<svg viewBox="0 0 16 16"><path d="M5 5l6 6m0-6l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'));
    close.addEventListener("click", (e) => { e.stopPropagation(); closeTile(tab.id); });
    el.append(close);
  }

  bindTabEvents(el, tab);
  return el;
}

function sameUrl(a, b) {
  const strip = (u) => (u || "").replace(/#.*$/, "").replace(/\/$/, "");
  return strip(a) === strip(b);
}

function renderRow(tab) {
  const el = document.createElement("div");
  el.className = "row tab";
  el.classList.toggle("active", tab.active);
  el.classList.toggle("discarded", !!tab.discarded);
  el.classList.toggle("loading", tab.status === "loading");
  el.dataset.tabId = tab.id;
  el.draggable = true;
  el.title = tab.title || tab.url;

  const title = document.createElement("span");
  title.className = "row-title";
  title.textContent = tab.title || tab.url;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "row-close";
  close.title = "Tab schließen";
  close.append(svg('<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'));
  close.addEventListener("click", (e) => { e.stopPropagation(); api.tabs.remove(tab.id); });

  el.append(favicon(tab, "row-icon"), title);
  if (tab.audible || tab.mutedInfo?.muted) el.append(audioBadge(tab));
  el.append(close);
  bindTabEvents(el, tab);
  return el;
}

function renderGroup(gid, members) {
  const g = groups.get(gid) || { id: gid, title: "", color: "grey", collapsed: false };
  const wrap = document.createElement("div");
  wrap.className = "group";
  wrap.classList.toggle("collapsed", !!g.collapsed);
  wrap.style.setProperty("--group-color", GROUP_COLORS[g.color] || GROUP_COLORS.grey);
  wrap.dataset.groupId = gid;

  const head = document.createElement("div");
  head.className = "group-head";
  head.dataset.groupId = gid;
  const dot = document.createElement("span");
  dot.className = "group-dot";
  head.append(svg('<svg class="chevron" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'), dot);
  const title = document.createElement("span");
  title.className = "group-title";
  title.textContent = g.title || "Unbenannte Gruppe";
  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = members.length;
  head.append(title, count);

  // Einfacher Klick klappt (kurz verzögert), Doppelklick benennt um
  head.addEventListener("click", () => {
    if (groupClickTimer) { clearTimeout(groupClickTimer); groupClickTimer = null; startRename(gid); return; }
    groupClickTimer = setTimeout(() => {
      groupClickTimer = null;
      api.tabGroups.update(gid, { collapsed: !g.collapsed });
    }, 250);
  });
  head.addEventListener("contextmenu", (e) => { e.preventDefault(); openGroupMenu(e, g, members); });
  bindDropTarget(head, { groupId: gid });

  const list = document.createElement("div");
  list.className = "group-tabs";
  // Eingeklappt: nur den aktiven Tab zeigen (wie Arc/Zen)
  const visible = g.collapsed ? members.filter((t) => t.active) : members;
  list.append(...visible.map(renderRow));

  wrap.append(head, list);
  return wrap;
}

function favicon(tab, cls) {
  const box = document.createElement("span");
  box.className = cls;
  const url = tab.favIconUrl;
  const usable = url && !url.startsWith("chrome://") && !url.startsWith("resource://");
  if (usable) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.decoding = "async";
    img.addEventListener("error", () => img.replaceWith(letterIcon(tab)));
    box.append(img);
  } else {
    box.append(letterIcon(tab));
  }
  return box;
}

function letterIcon(tab) {
  const span = document.createElement("span");
  span.className = "letter";
  let host = "";
  try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch {}
  span.textContent = (host || tab.title || "?").charAt(0).toUpperCase();
  return span;
}

function audioBadge(tab) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "audio";
  const muted = !!tab.mutedInfo?.muted;
  b.title = muted ? "Ton an" : "Stummschalten";
  b.append(svg(muted
    ? '<svg viewBox="0 0 16 16"><path d="M2.5 6h2l3-2.5v9L4.5 10h-2z" fill="currentColor"/><path d="M10.5 6l4 4m0-4l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 16 16"><path d="M2.5 6h2l3-2.5v9L4.5 10h-2z" fill="currentColor"/><path d="M10 5.5a3.5 3.5 0 0 1 0 5M11.8 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'));
  b.addEventListener("click", (e) => { e.stopPropagation(); api.tabs.update(tab.id, { muted: !muted }); });
  return b;
}

/* --------------------------------------------------------- interaktion */

function bindTabEvents(el, tab) {
  el.addEventListener("click", () => {
    // Doppelklick selbst erkennen: nach dem ersten Klick wird neu gerendert,
    // dadurch käme ein natives dblclick-Event nicht zuverlässig an.
    const now = Date.now();
    const isDouble = tab.pinned && lastClick.id === tab.id && now - lastClick.at < 400;
    lastClick = { id: tab.id, at: isDouble ? 0 : now };
    if (isDouble) resetTile(tab.id);
    else api.tabs.update(tab.id, { active: true });
  });
  el.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    if (tab.pinned) closeTile(tab.id);
    else api.tabs.remove(tab.id);
  });
  el.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); openTabMenu(e, tab); });

  el.addEventListener("dragstart", (e) => {
    dragTabId = tab.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-betterverttabs-tab", String(tab.id));
    if (tab.url) e.dataTransfer.setData("text/uri-list", tab.url);
    requestAnimationFrame(() => { el.classList.add("dragging"); document.body.classList.add("drag-active"); });
  });
  el.addEventListener("dragend", () => {
    dragTabId = null;
    clearDropMarkers();
    el.classList.remove("dragging");
    document.body.classList.remove("drag-active");
  });
  bindDropTarget(el, { tabId: tab.id, acceptLinks: tab.pinned });
}

/* --------------------------------------------------------------- kacheln */

async function setPinned(id, pinned) {
  const tab = tabById(id) || (await api.tabs.get(id));
  if (tab.pinned === pinned) return;
  await api.tabs.update(id, { pinned });
  if (pinned) {
    if (isRealUrl(tab.url)) await store.set(id, "tileUrl", tab.url);
  } else {
    await Promise.all([store.del(id, "tileUrl"), store.del(id, "tileClosed")]);
  }
}

// „Schließen“ wie bei Arc: Kachel bleibt, Tab wird entladen und beim
// nächsten Öffnen auf die Originalseite zurückgesetzt.
async function closeTile(id) {
  const tab = tabById(id);
  if (!tab) return;
  if (tab.active) {
    const others = tabs.filter((t) => t.id !== id && !tileInfo.get(t.id)?.closed);
    const next = others.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (next) await api.tabs.update(next.id, { active: true });
    else await api.tabs.create({ windowId, active: true });
  }
  await store.set(id, "tileClosed", true);
  await api.tabs.discard(id).catch(() => {});
  scheduleRefresh();
}

async function resetTile(id) {
  const url = tileInfo.get(id)?.url;
  if (!url) return;
  await api.tabs.update(id, { active: true, url });
}

async function setTileUrlToCurrent(id) {
  const tab = tabById(id);
  if (!tab || !isRealUrl(tab.url)) return;
  await store.set(id, "tileUrl", tab.url);
  scheduleRefresh();
}

async function createTile(url, index) {
  try {
    const tab = await api.tabs.create({ windowId, url, pinned: true, active: false });
    await store.set(tab.id, "tileUrl", url);
    if (index !== undefined) await api.tabs.move(tab.id, { index });
  } catch (err) {
    console.error("Kachel konnte nicht erstellt werden:", url, err);
  }
}

/* ---------------------------------------------------------- drag & drop */

function clearDropMarkers() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-into")
    .forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-into"));
}

function dropPosition(el, e) {
  const r = el.getBoundingClientRect();
  if (el.classList.contains("tile")) return e.clientX < r.left + r.width / 2 ? "before" : "after";
  return e.clientY < r.top + r.height / 2 ? "before" : "after";
}

const LINK_TYPES = ["text/x-moz-url", "text/uri-list"];
const isLinkDrag = (e) => dragTabId === null && LINK_TYPES.some((t) => e.dataTransfer?.types.includes(t));

function droppedUrl(dt) {
  const moz = dt.getData("text/x-moz-url").split("\n")[0].trim();
  if (moz) return moz;
  const list = dt.getData("text/uri-list").split(/\r?\n/).find((l) => l && !l.startsWith("#"));
  if (list) return list.trim();
  const text = dt.getData("text/plain").trim();
  return /^https?:\/\//.test(text) ? text : null;
}

function bindDropTarget(el, target) {
  const accepts = (e) => dragTabId !== null || (target.acceptLinks && isLinkDrag(e));
  el.addEventListener("dragover", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarkers();
    if (target.groupId !== undefined) el.classList.add("drop-into");
    else el.classList.add(dropPosition(el, e) === "before" ? "drop-before" : "drop-after");
  });
  el.addEventListener("drop", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = target.tabId !== undefined ? dropPosition(el, e) : null;
    clearDropMarkers();
    endLinkDrag();
    if (dragTabId === null) {
      // Link von außen auf eine Kachel -> neue Kachel daneben
      const url = droppedUrl(e.dataTransfer);
      const ref = tabById(target.tabId);
      if (url && ref) createTile(url, ref.index + (pos === "after" ? 1 : 0));
      return;
    }
    dropTab(dragTabId, target, pos).catch(console.error);
  });
}

// Leere Flächen: Kachel-Grid und lose Liste nehmen Drops „ans Ende“ an.
// Links/Lesezeichen von außen werden im Grid zur Kachel, in der Liste zum Tab.
for (const [zone, kind] of [[$pinned, "pinned"], [$tabs, "loose"], [document.getElementById("new-tab"), "loose"]]) {
  zone.addEventListener("dragover", (e) => {
    if (dragTabId === null && !isLinkDrag(e)) return;
    e.preventDefault();
    clearDropMarkers();
    zone.classList.add("drop-into");
  });
  zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drop-into"); });
  zone.addEventListener("drop", (e) => {
    if (dragTabId === null && !isLinkDrag(e)) return;
    e.preventDefault();
    clearDropMarkers();
    endLinkDrag();
    if (dragTabId === null) {
      const url = droppedUrl(e.dataTransfer);
      if (!url) return;
      if (kind === "pinned") createTile(url);
      else api.tabs.create({ windowId, url }).catch(console.error);
      return;
    }
    dropTab(dragTabId, { zone: kind }, null).catch(console.error);
  });
}

// Drop-Platz im Grid nur einblenden, solange ein Link von außen gezogen wird
function endLinkDrag() { linkDragDepth = 0; document.body.classList.remove("drag-active"); }
document.addEventListener("dragenter", (e) => {
  if (!isLinkDrag(e)) return;
  linkDragDepth++;
  document.body.classList.add("drag-active");
});
document.addEventListener("dragleave", (e) => {
  if (dragTabId !== null || linkDragDepth === 0) return;
  if (--linkDragDepth <= 0) endLinkDrag();
});
document.addEventListener("drop", endLinkDrag);

async function dropTab(id, target, pos) {
  const dragged = tabById(id);
  if (!dragged) return;

  // Auf Gruppenkopf -> in die Gruppe
  if (target.groupId !== undefined) {
    if (dragged.pinned) await setPinned(id, false);
    await api.tabs.group({ groupId: target.groupId, tabIds: [id] });
    return;
  }

  // Auf leere Zone
  if (target.zone === "pinned") {
    if (!dragged.pinned) await setPinned(id, true);
    const pinnedCount = tabs.filter((t) => t.pinned).length;
    await api.tabs.move(id, { index: dragged.pinned ? pinnedCount - 1 : pinnedCount });
    return;
  }
  if (target.zone === "loose") {
    if (dragged.pinned) await setPinned(id, false);
    if (hasGroups && inGroup(dragged)) await api.tabs.ungroup([id]);
    await api.tabs.move(id, { index: -1 });
    return;
  }

  // Auf einen anderen Tab
  if (target.tabId === id) return;
  let ref = tabById(target.tabId);
  if (!ref) return;

  if (ref.pinned !== dragged.pinned) await setPinned(id, ref.pinned);
  if (hasGroups && !ref.pinned) {
    const refGroup = inGroup(ref) ? ref.groupId : -1;
    const curGroup = inGroup(dragged) ? dragged.groupId : -1;
    if (refGroup !== curGroup) {
      if (refGroup === -1) await api.tabs.ungroup([id]);
      else await api.tabs.group({ groupId: refGroup, tabIds: [id] });
    }
  }

  // Indizes haben sich evtl. verschoben -> frisch holen
  const [cur, refNow] = await Promise.all([api.tabs.get(id), api.tabs.get(ref.id)]);
  let index = pos === "after" ? refNow.index + 1 : refNow.index;
  if (cur.index < index) index -= 1;
  if (index !== cur.index) await api.tabs.move(id, { index });
}

/* --------------------------------------------------------- kontextmenü */

function openMenu(e, items) {
  $menu.replaceChildren();
  for (const item of items) {
    if (item === "-") {
      const hr = document.createElement("div");
      hr.className = "menu-sep";
      $menu.append(hr);
      continue;
    }
    if (item.swatches) {
      const row = document.createElement("div");
      row.className = "menu-swatches";
      for (const [name, hex] of Object.entries(GROUP_COLORS)) {
        const s = document.createElement("button");
        s.type = "button";
        s.className = "swatch";
        s.style.background = hex;
        s.title = name;
        s.classList.toggle("current", name === item.current);
        s.addEventListener("click", () => { closeMenu(); item.swatches(name); });
        row.append(s);
      }
      $menu.append(row);
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item";
    if (item.danger) b.classList.add("danger");
    b.textContent = item.label;
    b.addEventListener("click", () => { closeMenu(); item.run(); });
    $menu.append(b);
  }
  $menu.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  const r = $menu.getBoundingClientRect();
  $menu.style.left = Math.max(4, Math.min(e.clientX, w - r.width - 4)) + "px";
  $menu.style.top = Math.max(4, Math.min(e.clientY, h - r.height - 4)) + "px";
}

function closeMenu() { $menu.hidden = true; }
document.addEventListener("mousedown", (e) => { if (!$menu.contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("blur", closeMenu);

function openTabMenu(e, tab) {
  if (tab.pinned) return openTileMenu(e, tab);
  const muted = !!tab.mutedInfo?.muted;
  const items = [
    { label: "Als Kachel anheften", run: () => setPinned(tab.id, true) },
    { label: "Neu laden", run: () => api.tabs.reload(tab.id) },
    { label: "Duplizieren", run: () => api.tabs.duplicate(tab.id) },
    { label: muted ? "Ton an" : "Stummschalten", run: () => api.tabs.update(tab.id, { muted: !muted }) },
  ];
  if (!tab.active && !tab.discarded) items.push({ label: "Entladen (Speicher sparen)", run: () => api.tabs.discard(tab.id) });

  if (hasGroups) {
    items.push("-");
    for (const g of groups.values()) {
      if (g.id === tab.groupId) continue;
      items.push({ label: `In „${g.title || "Unbenannte Gruppe"}“ verschieben`, run: () => api.tabs.group({ groupId: g.id, tabIds: [tab.id] }) });
    }
    items.push({ label: "Neue Gruppe mit diesem Tab", run: () => newGroup([tab.id]) });
    if (inGroup(tab)) items.push({ label: "Aus Gruppe entfernen", run: () => api.tabs.ungroup([tab.id]) });
  }

  items.push("-");
  const below = tabs.filter((t) => t.index > tab.index && !t.pinned).map((t) => t.id);
  if (below.length) items.push({ label: `Tabs darunter schließen (${below.length})`, run: () => api.tabs.remove(below) });
  items.push({ label: "Schließen", danger: true, run: () => api.tabs.remove(tab.id) });
  openMenu(e, items);
}

function openTileMenu(e, tab) {
  const info = tileInfo.get(tab.id) || {};
  const muted = !!tab.mutedInfo?.muted;
  let host = "";
  try { host = new URL(info.url).hostname.replace(/^www\./, ""); } catch {}
  const items = [];
  if (info.url) items.push({ label: `Zur Originalseite (${host || "Start"})`, run: () => resetTile(tab.id) });
  if (!info.closed && isRealUrl(tab.url) && !sameUrl(info.url, tab.url)) {
    items.push({ label: "Aktuelle Seite als Originalseite merken", run: () => setTileUrlToCurrent(tab.id) });
  }
  if (!info.closed) {
    items.push(
      { label: "Neu laden", run: () => api.tabs.reload(tab.id) },
      { label: muted ? "Ton an" : "Stummschalten", run: () => api.tabs.update(tab.id, { muted: !muted }) },
    );
  }
  items.push(
    { label: "Duplizieren als normaler Tab", run: () => api.tabs.create({ windowId, url: tab.url }) },
    "-",
    { label: "Lösen (zurück in die Liste)", run: () => setPinned(tab.id, false) },
  );
  if (!info.closed) items.push({ label: "Kachel schließen", run: () => closeTile(tab.id) });
  items.push({ label: "Kachel entfernen", danger: true, run: () => api.tabs.remove(tab.id) });
  openMenu(e, items);
}

function openGroupMenu(e, g, members) {
  openMenu(e, [
    { label: "Umbenennen", run: () => startRename(g.id) },
    { swatches: (color) => api.tabGroups.update(g.id, { color }), current: g.color },
    { label: "Neuer Tab in Gruppe", run: async () => {
      const t = await api.tabs.create({ windowId });
      await api.tabs.group({ groupId: g.id, tabIds: [t.id] });
    } },
    "-",
    { label: "Gruppe auflösen", run: () => api.tabs.ungroup(members.map((t) => t.id)) },
    { label: `Gruppe schließen (${members.length} Tabs)`, danger: true, run: () => api.tabs.remove(members.map((t) => t.id)) },
  ]);
}

/* --------------------------------------------------------------- gruppen */

async function newGroup(tabIds) {
  const groupId = await api.tabs.group({ tabIds, createProperties: { windowId } });
  await api.tabGroups.update(groupId, { title: "Neue Gruppe" });
  renameGroupId = groupId;
  scheduleRefresh();
}

function startRename(gid) {
  renameGroupId = null;
  const head = $groups.querySelector(`.group-head[data-group-id="${gid}"]`);
  const title = head?.querySelector(".group-title");
  if (!title) return;
  title.contentEditable = "plaintext-only";
  title.focus();
  document.getSelection().selectAllChildren(title);
  const finish = (save) => {
    title.contentEditable = "false";
    title.removeEventListener("keydown", onKey);
    title.removeEventListener("blur", onBlur);
    if (save) api.tabGroups.update(gid, { title: title.textContent.trim() });
    else scheduleRefresh();
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  title.addEventListener("keydown", onKey);
  title.addEventListener("blur", onBlur);
  title.addEventListener("click", (e) => e.stopPropagation());
}

/* --------------------------------------------------------------- buttons */

const newTab = () => api.tabs.create({ windowId });
document.getElementById("new-tab").addEventListener("click", newTab);
document.getElementById("btn-new-tab").addEventListener("click", newTab);
document.getElementById("btn-new-group").addEventListener("click", async () => {
  if (!hasGroups) return;
  const active = tabs.find((t) => t.active);
  const id = active && !active.pinned ? active.id : (await api.tabs.create({ windowId })).id;
  newGroup([id]);
});
if (!hasGroups) document.getElementById("btn-new-group").hidden = true;

/* ------------------------------------------------------------------ init */

(async function init() {
  windowId = (await api.windows.getCurrent()).id;
  const filter = { windowId };
  api.tabs.onUpdated.addListener(scheduleRefresh, filter);
  for (const ev of ["onCreated", "onRemoved", "onActivated", "onMoved", "onAttached", "onDetached"]) {
    api.tabs[ev].addListener(scheduleRefresh);
  }
  if (hasGroups) {
    for (const ev of ["onCreated", "onUpdated", "onRemoved", "onMoved"]) api.tabGroups[ev]?.addListener(scheduleRefresh);
  }
  await refresh();
  document.querySelector(".tab.active, .tile.active")?.scrollIntoView({ block: "nearest" });
})();
