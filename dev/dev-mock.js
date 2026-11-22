"use strict";
/*
 * Fake browser API for the design preview (dev/preview.html) outside Firefox.
 * Not shipped with the extension.
 */
if (typeof globalThis.browser === "undefined" || !globalThis.browser.tabs) {
  const listeners = {};
  const ev = (name) => ({
    addListener: (fn) => (listeners[name] ||= []).push(fn),
  });
  const fire = () => Object.values(listeners).flat().forEach((fn) => fn());

  const fav = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  let nextId = 100;
  const mk = (url, title, extra = {}) => ({
    id: nextId++, windowId: 1, url, title, favIconUrl: fav(new URL(url).hostname),
    pinned: false, active: false, hidden: false, groupId: -1, status: "complete", ...extra,
  });

  let tabs = [
    mk("https://github.com", "GitHub", { pinned: true }),
    mk("https://example.org", "Example", { pinned: true, favIconUrl: "" }),
    mk("https://developer.mozilla.org", "MDN Web Docs", { pinned: true }),
    mk("https://wikipedia.org", "Wikipedia", { pinned: true }),
    mk("https://youtube.com/watch?v=demo", "YouTube", { pinned: true, active: true }),
    mk("https://mail.proton.me", "Mail", { pinned: true }),
    mk("https://figma.com", "Figma", { pinned: true }),
    mk("https://x.com", "X", { pinned: true }),
    mk("https://github.com/NoiXdev/BetterVertTabs/issues", "Issues · NoiXdev/BetterVertTabs", { groupId: 1 }),
    mk("https://tracker.example", "Sprint board", { groupId: 1, favIconUrl: "" }),
    mk("https://developer.mozilla.org/docs/Mozilla/Add-ons", "Browser extensions – MDN", { groupId: 1 }),
    mk("https://news.ycombinator.com", "Hacker News"),
    mk("https://open.spotify.com", "Spotify – Web Player", { audible: true }),
    mk("https://duckduckgo.com", "firefox vertical tabs at DuckDuckGo", { status: "loading" }),
    mk("about:neterror", "Problem loading page", { favIconUrl: "" }),
    mk("https://www.mozilla.org/firefox/releases/", "Firefox Release Notes", { discarded: true }),
    mk("https://translate.google.com", "Google Translate"),
  ];
  let groups = [{ id: 1, windowId: 1, title: "Work", color: "red", collapsed: false }];
  const reindex = () => tabs.forEach((t, i) => (t.index = i));
  reindex();
  // Demo: YouTube was pinned on its start page, Mail is closed
  queueMicrotask(() => {
    const yt = tabs.find((t) => t.title === "YouTube");
    tabValues.set(yt.id + "tileUrl", "https://youtube.com");
    const mail = tabs.find((t) => t.title === "Mail");
    tabValues.set(mail.id + "tileClosed", true);
  });

  const get = (id) => tabs.find((t) => t.id === id);
  const ids = (x) => (Array.isArray(x) ? x : [x]);
  const done = (v) => { reindex(); setTimeout(fire); return Promise.resolve(v); };

  const tabValues = new Map();
  globalThis.browser = {
    sessions: {
      getTabValue: async (id, k) => tabValues.get(id + k),
      setTabValue: async (id, k, v) => { tabValues.set(id + k, v); },
      removeTabValue: async (id, k) => { tabValues.delete(id + k); },
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: {
      query: async () => tabs.map((t) => ({ ...t })),
      get: async (id) => ({ ...get(id) }),
      update: async (id, p) => {
        const t = get(id);
        if (p.active) tabs.forEach((x) => (x.active = x === t));
        if (p.muted !== undefined) t.mutedInfo = { muted: p.muted };
        if (p.url) { t.url = p.url; t.discarded = false; }
        if (p.pinned !== undefined && p.pinned !== t.pinned) {
          tabs.splice(tabs.indexOf(t), 1);
          t.pinned = p.pinned;
          t.groupId = -1;
          const n = tabs.filter((x) => x.pinned).length;
          tabs.splice(n, 0, t);
        }
        return done(t);
      },
      move: async (id, { index }) => {
        const t = get(id);
        tabs.splice(tabs.indexOf(t), 1);
        tabs.splice(index < 0 ? tabs.length : index, 0, t);
        return done(t);
      },
      remove: async (x) => { tabs = tabs.filter((t) => !ids(x).includes(t.id)); return done(); },
      create: async (p = {}) => {
        const t = p.url ? mk(p.url, new URL(p.url).hostname, { pinned: !!p.pinned }) : mk("about:newtab", "New Tab", { favIconUrl: "" });
        if (p.active !== false) tabs.forEach((x) => (x.active = false)), (t.active = true);
        if (t.pinned) tabs.splice(tabs.filter((x) => x.pinned).length, 0, t); else tabs.push(t);
        return done(t);
      },
      duplicate: async (id) => { const t = { ...get(id), id: nextId++ }; tabs.splice(tabs.indexOf(get(id)) + 1, 0, t); return done(t); },
      reload: async () => done(),
      discard: async (id) => { get(id).discarded = true; return done(); },
      group: async ({ tabIds, groupId }) => {
        if (groupId === undefined) { groupId = nextId++; groups.push({ id: groupId, title: "", color: "blue", collapsed: false }); }
        ids(tabIds).forEach((id) => (get(id).groupId = groupId));
        return done(groupId);
      },
      ungroup: async (x) => { ids(x).forEach((id) => (get(id).groupId = -1)); return done(); },
      onUpdated: ev("u"), onCreated: ev("c"), onRemoved: ev("r"), onActivated: ev("a"),
      onMoved: ev("m"), onAttached: ev("at"), onDetached: ev("d"),
    },
    tabGroups: {
      query: async () => groups.filter((g) => tabs.some((t) => t.groupId === g.id)).map((g) => ({ ...g })),
      update: async (id, p) => { Object.assign(groups.find((g) => g.id === id), p); return done(); },
      onCreated: ev("gc"), onUpdated: ev("gu"), onRemoved: ev("gr"), onMoved: ev("gm"),
    },
  };
}
