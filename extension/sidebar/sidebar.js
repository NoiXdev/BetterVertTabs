"use strict";

/*
 * BetterVertTabs – vertical tab sidebar with pinned tiles.
 *
 * Approach: on every tab/group event the window state is queried again and
 * the whole sidebar is re-rendered (throttled to one frame). Simple, robust
 * and fast enough for a few hundred tabs.
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
let linkDragDepth = 0; // > 0 while a link/bookmark is dragged in from outside

/*
 * Tile state per tab. Stored on the tab itself via the sessions API, so it
 * survives Firefox restarts.
 *   tileUrl    – the page that was open when the tab was pinned
 *   tileClosed – the tile was "closed" (unloaded, waiting for a reset)
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
    // Tile without a stored page (e.g. pinned by Firefox itself): remember the current page
    if (!url && isRealUrl(t.url)) { url = t.url; store.set(t.id, "tileUrl", url); }
    // A closed tile was activated again (click, keyboard, …) -> reset it to its original page
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
// Firefox's native split view (read-only for extensions, Firefox 160+)
const NO_SPLIT = api.tabs.SPLIT_VIEW_ID_NONE ?? -1;
const inSplit = (t) => t.splitViewId !== undefined && t.splitViewId !== NO_SPLIT;
const splitMates = (t) => (inSplit(t) ? tabs.filter((x) => x.splitViewId === t.splitViewId) : [t]);

/* --------------------------------------------------------------- render */

function render() {
  const pinned = tabs.filter((t) => t.pinned);
  const loose = tabs.filter((t) => !t.pinned);

  // Tiles
  const dropSlot = document.createElement("div");
  dropSlot.className = "tile-drop";
  dropSlot.textContent = pinned.length ? "+" : "Drop here to pin";
  $pinned.replaceChildren(...pinned.map(renderTile), dropSlot);
  $pinned.classList.toggle("empty", pinned.length === 0);

  // Groups in tab order
  const order = [];
  const members = new Map();
  for (const t of loose) {
    if (!inGroup(t)) continue;
    if (!members.has(t.groupId)) { members.set(t.groupId, []); order.push(t.groupId); }
    members.get(t.groupId).push(t);
  }
  $groups.replaceChildren(...order.map((gid) => renderGroup(gid, members.get(gid))));

  // Ungrouped tabs
  $tabs.replaceChildren(...renderRows(loose.filter((t) => !inGroup(t))));

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
  // Page differs from the pinned one -> show a small dot
  el.classList.toggle("navigated", !info.closed && !!info.url && sameUrl(info.url, tab.url) === false);
  el.title = info.closed
    ? `${tab.title || tab.url}\n(closed – click to open the original page)`
    : `${tab.title || tab.url}\nDouble-click: back to the original page`;
  el.dataset.tabId = tab.id;
  el.draggable = true;
  el.append(favicon(tab, "tile-icon"));
  if (!info.closed && (tab.audible || tab.mutedInfo?.muted)) el.append(audioBadge(tab));

  if (!info.closed) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tile-close";
    close.title = "Close tile";
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

// Tabs of a split view sit next to each other -> render them as one paired row
function renderRows(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const members = [list[i]];
    if (inSplit(list[i])) while (list[i + 1]?.splitViewId === list[i].splitViewId) members.push(list[++i]);
    out.push(members.length > 1 ? renderSplit(members) : renderRow(members[0]));
  }
  return out;
}

function renderSplit(members) {
  const el = document.createElement("div");
  el.className = "split";
  el.classList.toggle("active", members.some((t) => t.active));
  el.append(...members.map(renderRow));
  return el;
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
  close.title = "Close tab";
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
  title.textContent = g.title || "Unnamed group";
  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = members.length;
  head.append(title, count);

  // Single click toggles collapse (slightly delayed), double-click renames
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
  // Collapsed: only show the active tab (like Arc/Zen), with its split partner
  const visible = g.collapsed ? members.filter((t) => splitMates(t).some((m) => m.active)) : members;
  list.append(...renderRows(visible));

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
  b.title = muted ? "Unmute" : "Mute";
  b.append(svg(muted
    ? '<svg viewBox="0 0 16 16"><path d="M2.5 6h2l3-2.5v9L4.5 10h-2z" fill="currentColor"/><path d="M10.5 6l4 4m0-4l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 16 16"><path d="M2.5 6h2l3-2.5v9L4.5 10h-2z" fill="currentColor"/><path d="M10 5.5a3.5 3.5 0 0 1 0 5M11.8 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'));
  b.addEventListener("click", (e) => { e.stopPropagation(); api.tabs.update(tab.id, { muted: !muted }); });
  return b;
}

/* --------------------------------------------------------- interaction */

function bindTabEvents(el, tab) {
  el.addEventListener("click", () => {
    // Detect double-clicks manually: the first click triggers a re-render,
    // so a native dblclick event would not arrive reliably.
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

/* ----------------------------------------------------------------- tiles */

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

// "Close" like Arc: the tile stays, its tab is unloaded and reset to the
// original page the next time it is opened.
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
    console.error("Could not create tile:", url, err);
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
      // Link from outside dropped on a tile -> new tile next to it
      const url = droppedUrl(e.dataTransfer);
      const ref = tabById(target.tabId);
      if (url && ref) createTile(url, ref.index + (pos === "after" ? 1 : 0));
      return;
    }
    dropTab(dragTabId, target, pos).catch(console.error);
  });
}

// Empty areas: the tile grid and the tab list accept drops "at the end".
// Links/bookmarks from outside become a tile in the grid and a tab in the list.
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

// Only show the grid drop slot while a link is dragged in from outside
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

  // Onto a group header -> into that group
  if (target.groupId !== undefined) {
    if (dragged.pinned) await setPinned(id, false);
    await api.tabs.group({ groupId: target.groupId, tabIds: [id] });
    return;
  }

  // Onto an empty area
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

  // Onto another tab
  if (target.tabId === id) return;
  let ref = tabById(target.tabId);
  if (!ref) return;
  // Never drop a tab between the two halves of a split view
  if (inSplit(ref) && ref.splitViewId !== dragged.splitViewId) {
    const pair = splitMates(ref);
    ref = pos === "after" ? pair.at(-1) : pair[0];
  }

  if (ref.pinned !== dragged.pinned) await setPinned(id, ref.pinned);
  if (hasGroups && !ref.pinned) {
    const refGroup = inGroup(ref) ? ref.groupId : -1;
    const curGroup = inGroup(dragged) ? dragged.groupId : -1;
    if (refGroup !== curGroup) {
      if (refGroup === -1) await api.tabs.ungroup([id]);
      else await api.tabs.group({ groupId: refGroup, tabIds: [id] });
    }
  }

  // Indexes may have shifted -> fetch them again
  const [cur, refNow] = await Promise.all([api.tabs.get(id), api.tabs.get(ref.id)]);
  let index = pos === "after" ? refNow.index + 1 : refNow.index;
  if (cur.index < index) index -= 1;
  if (index !== cur.index) await api.tabs.move(id, { index });
}

/* ---------------------------------------------------------- context menu */

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
    { label: "Pin as tile", run: () => setPinned(tab.id, true) },
    { label: "Reload", run: () => api.tabs.reload(tab.id) },
    { label: "Duplicate", run: () => api.tabs.duplicate(tab.id) },
    { label: muted ? "Unmute" : "Mute", run: () => api.tabs.update(tab.id, { muted: !muted }) },
  ];
  if (!tab.active && !tab.discarded) items.push({ label: "Unload (save memory)", run: () => api.tabs.discard(tab.id) });

  if (hasGroups) {
    items.push("-");
    for (const g of groups.values()) {
      if (g.id === tab.groupId) continue;
      items.push({ label: `Move to "${g.title || "Unnamed group"}"`, run: () => api.tabs.group({ groupId: g.id, tabIds: [tab.id] }) });
    }
    items.push({ label: "New group with this tab", run: () => newGroup([tab.id]) });
    if (inGroup(tab)) items.push({ label: "Remove from group", run: () => api.tabs.ungroup([tab.id]) });
  }

  items.push("-");
  const below = tabs.filter((t) => t.index > tab.index && !t.pinned).map((t) => t.id);
  if (below.length) items.push({ label: `Close tabs below (${below.length})`, run: () => api.tabs.remove(below) });
  items.push({ label: "Close", danger: true, run: () => api.tabs.remove(tab.id) });
  openMenu(e, items);
}

function openTileMenu(e, tab) {
  const info = tileInfo.get(tab.id) || {};
  const muted = !!tab.mutedInfo?.muted;
  let host = "";
  try { host = new URL(info.url).hostname.replace(/^www\./, ""); } catch {}
  const items = [];
  if (info.url) items.push({ label: `Back to original page (${host || "start"})`, run: () => resetTile(tab.id) });
  if (!info.closed && isRealUrl(tab.url) && !sameUrl(info.url, tab.url)) {
    items.push({ label: "Use current page as original page", run: () => setTileUrlToCurrent(tab.id) });
  }
  if (!info.closed) {
    items.push(
      { label: "Reload", run: () => api.tabs.reload(tab.id) },
      { label: muted ? "Unmute" : "Mute", run: () => api.tabs.update(tab.id, { muted: !muted }) },
    );
  }
  items.push(
    { label: "Duplicate as regular tab", run: () => api.tabs.create({ windowId, url: tab.url }) },
    "-",
    { label: "Unpin (back to the list)", run: () => setPinned(tab.id, false) },
  );
  if (!info.closed) items.push({ label: "Close tile", run: () => closeTile(tab.id) });
  items.push({ label: "Remove tile", danger: true, run: () => api.tabs.remove(tab.id) });
  openMenu(e, items);
}

function openGroupMenu(e, g, members) {
  openMenu(e, [
    { label: "Rename", run: () => startRename(g.id) },
    { swatches: (color) => api.tabGroups.update(g.id, { color }), current: g.color },
    { label: "New tab in group", run: async () => {
      const t = await api.tabs.create({ windowId });
      await api.tabs.group({ groupId: g.id, tabIds: [t.id] });
    } },
    "-",
    { label: "Ungroup", run: () => api.tabs.ungroup(members.map((t) => t.id)) },
    { label: `Close group (${members.length} tabs)`, danger: true, run: () => api.tabs.remove(members.map((t) => t.id)) },
  ]);
}

/* ---------------------------------------------------------------- groups */

async function newGroup(tabIds) {
  const groupId = await api.tabs.group({ tabIds, createProperties: { windowId } });
  await api.tabGroups.update(groupId, { title: "New group" });
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
