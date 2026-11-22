# BetterVertTabs

Eine eigene Firefox-Extension für vertikale Tabs im Stil von Arc, Dia und Zen:
angeheftete Tabs als Kacheln, darunter Gruppen und eine normale Tab-Liste.

```
extension/            die Extension selbst
  manifest.json
  sidebar/            Sidebar-Oberfläche (HTML/CSS/JS)
chrome/userChrome.css blendet die alte Tab-Leiste und den Sidebar-Kopf aus
```

## 1. Extension testen (temporär)

1. In Firefox `about:debugging#/runtime/this-firefox` öffnen.
2. Auf **Temporäres Add-on laden…** klicken und `extension/manifest.json` auswählen.
3. Die Sidebar öffnet sich automatisch. Falls nicht: **Alt+S** drücken oder über das Sidebar-Menü „BetterVertTabs“ wählen.

Temporäre Add-ons verschwinden nach einem Neustart von Firefox. Wie du sie dauerhaft installierst, steht unten in Abschnitt 3.

## 2. Firefox-Oberfläche anpassen (userChrome.css)

1. `about:config` öffnen und `toolkit.legacyUserProfileCustomizations.stylesheets` auf **true** setzen.
2. `about:support` öffnen, beim Eintrag **Profilordner** auf **Im Finder anzeigen** klicken.
3. Im Profilordner einen Ordner `chrome` anlegen und `chrome/userChrome.css` aus diesem Projekt hineinkopieren.
4. Firefox neu starten.

Eine bestehende `userChrome.css` überschreibst du nicht, sondern hängst den Inhalt unten an.

## 3. Dauerhaft installieren

Normale Firefox-Versionen verlangen signierte Extensions. Die Signatur ist kostenlos, und die Extension bleibt dabei privat (unlisted):

1. Auf https://addons.mozilla.org/developers/ unter **Verwalten → API-Schlüssel** einen Schlüssel erzeugen.
2. Ausführen:

```bash
cd extension
npx web-ext sign --channel=unlisted --api-key=DEIN_KEY --api-secret=DEIN_SECRET
```

3. Die erzeugte `.xpi`-Datei per Drag & Drop in Firefox ziehen.

## Bedienung

| Aktion | Wie |
|---|---|
| Tab aktivieren | Klick |
| Tab schließen | Mittelklick oder das ✕ beim Überfahren |
| Als Kachel anheften | Tab in den Kachelbereich ziehen (beim Ziehen erscheint ein Ablageplatz) oder Rechtsklick → *Als Kachel anheften* |
| Kachel aus Link/Lesezeichen | Link, Lesezeichen oder Adresse aus der URL-Leiste in den Kachelbereich ziehen |
| Kachel schließen | ✕ oben links auf der Kachel oder Mittelklick. Die Kachel bleibt stehen, der Tab wird entladen |
| Geschlossene Kachel öffnen | Klick. Sie startet wieder auf ihrer **Originalseite** |
| Zurück zur Originalseite | **Doppelklick** auf die Kachel. Ein kleiner Punkt zeigt an, dass du woanders bist |
| Originalseite ändern | Rechtsklick → *Aktuelle Seite als Originalseite merken* |
| Kachel ganz entfernen | Rechtsklick → *Kachel entfernen* oder *Lösen* (zurück in die Liste) |
| Sortieren | Drag & Drop (auch zwischen Kacheln, Gruppen und Liste) |
| Neue Gruppe | Ordner-Symbol unten links oder Rechtsklick → *Neue Gruppe mit diesem Tab* |
| Gruppe umbenennen | Doppelklick auf den Gruppennamen oder Rechtsklick → *Umbenennen* |
| Gruppe ein-/ausklappen | Klick auf den Gruppenkopf |
| Farbe, Auflösen, Schließen | Rechtsklick auf den Gruppenkopf |

Die Originalseite einer Kachel wird direkt am Tab gespeichert und übersteht auch einen Neustart von Firefox.

Gruppen sind echte Firefox-Tab-Gruppen. Sie bleiben also auch ohne die Extension erhalten.

## Design-Vorschau ohne Firefox

`extension/sidebar/sidebar.html` lässt sich direkt im Browser öffnen. `dev-mock.js` liefert dann Beispiel-Tabs.
