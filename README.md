# BetterVertTabs

A Firefox extension for vertical tabs in the style of Arc, Dia and Zen:
pinned tabs as tiles at the top, tab groups and a regular tab list below.

```
extension/            the extension itself (only this folder is packaged)
  manifest.json
  sidebar/            sidebar UI (HTML/CSS/JS)
chrome/userChrome.css hides the native tab strip and the sidebar header
dev/                  design preview without Firefox
scripts/sign.mjs      signs/publishes the extension on addons.mozilla.org
amo-metadata.json     listing texts and settings for addons.mozilla.org
web-ext-config.mjs    settings for lint, build and sign
```

Run `npm install` once (Node.js 22.9 or newer). Then these commands are available:

| Command | What it does |
|---|---|
| `npm run lint` | Checks the extension like the AMO validator does |
| `npm run build` | Packages `extension/` as a `.zip` into `web-ext-artifacts/` |
| `npm start` | Starts a fresh Firefox with the extension loaded |
| `npm run sign` | Uploads the extension to addons.mozilla.org for signing |

## 1. Try the extension (temporary)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and select `extension/manifest.json`.
3. The sidebar opens automatically. If not, press **Alt+S** or pick "BetterVertTabs" from the sidebar menu.

Temporary add-ons are removed when Firefox restarts. See section 3 for a permanent install.

## 2. Customize the Firefox UI (userChrome.css)

1. Open `about:config` and set `toolkit.legacyUserProfileCustomizations.stylesheets` to **true**.
2. Open `about:support` and click **Show in Finder** next to **Profile Folder**.
3. Create a `chrome` folder in the profile folder and copy `chrome/userChrome.css` from this repository into it.
4. Restart Firefox.

If you already have a `userChrome.css`, don't overwrite it. Append the contents instead.

## 3. Publish on addons.mozilla.org

One-time setup:

1. A Mozilla account with two-factor authentication enabled.
2. Accept the developer agreement in the [Developer Hub](https://addons.mozilla.org/developers/).
3. Create an API key under **Tools → Manage API Keys**.
4. Store the key as `MOZILLA_WEB_EXT_API_KEY` and the secret as `MOZILLA_WEB_EXT_API_SECRET`:
   - for releases via GitHub Actions: as organization or repository secrets
   - for local publishing: exported in your shell, or in a `.env` file (copy `.env.example`; `.env` is ignored by Git)

### Release via GitHub Actions (recommended)

1. Open **Actions → Release → Run workflow** on `main`.
2. Pick the bump (`patch`, `minor` or `major`). Tick **dry_run** to rehearse without submitting or pushing anything.

The [release workflow](.github/workflows/release.yaml) first runs [CI](.github/workflows/ci.yaml) as a gate, then hands over to the shared NoiX workflow [`create_firefox_addon_changelog_version_release`](https://github.com/NoiXdev/github-workflows/blob/main/.github/workflows/create_firefox_addon_changelog_version_release.yaml). It computes the next version, writes it into `extension/manifest.json`, generates `CHANGELOG.md`, lints and builds, submits the version to addons.mozilla.org, commits and tags the release and creates a GitHub release with the package attached.

Don't bump the version by hand: the workflow owns it. `manifest.json` starts at `0.0.0`, so the first `minor` release is `v0.1.0`.

### Release from your machine

Bump `version` in `extension/manifest.json` yourself, then:

```bash
npm run sign
```

On the first upload, description, category, license etc. are taken from `amo-metadata.json`. Mozilla then reviews the extension. Once approved, Firefox Sync installs it on all your devices automatically.

Just for yourself, without a public listing: `npm run sign -- --channel=unlisted` creates a signed `.xpi` in `web-ext-artifacts/` that you can install by dragging it into Firefox.

## Usage

| Action | How |
|---|---|
| Activate a tab | Click |
| Close a tab | Middle-click or the ✕ on hover |
| Pin as tile | Drag a tab into the tile area (a drop slot appears while dragging) or right-click → *Pin as tile* |
| Tile from a link/bookmark | Drag a link, bookmark or the address from the URL bar into the tile area |
| Close a tile | ✕ in the top-left corner of the tile or middle-click. The tile stays, its tab is unloaded |
| Open a closed tile | Click. It starts on its **original page** again |
| Back to the original page | **Double-click** the tile. A small dot shows that you have navigated away |
| Change the original page | Right-click → *Use current page as original page* |
| Remove a tile completely | Right-click → *Remove tile* or *Unpin* (back to the list) |
| Reorder | Drag & drop (also between tiles, groups and the list) |
| New group | Folder icon in the bottom left or right-click → *New group with this tab* |
| Rename a group | Double-click the group name or right-click → *Rename* |
| Collapse/expand a group | Click the group header |
| Color, ungroup, close | Right-click the group header |
| Split view | Shown as one paired row. Create it with Firefox's own split view (extensions can't create one yet) |

A tile's original page is stored on the tab itself and survives Firefox restarts.

Groups are native Firefox tab groups, so they persist even without the extension.

## Design preview without Firefox

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765/dev/preview.html. The page loads the real sidebar and replaces the Firefox API with sample tabs from `dev/dev-mock.js`. The `dev/` folder is not shipped with the extension.

## License

MIT, see [LICENSE](LICENSE).
