# Storyboard

Plattform zur Videoplanung: Storyboards anlegen, Szenen mit Foto, Dauer und Beschreibung bearbeiten.

## Änderungen live sehen (Deploy)

So testest du Änderungen — ohne Extra-Setup:

1. Agent macht die Änderung und publisht die App (Cursor Hosting).
2. Im Chat erscheint der **Publish**-Button → einmal bestätigen (Sichtbarkeit: private / public).
3. Danach öffnest du die App über die App-Pill im Chat. Jede weitere Änderung wird neu publisht und ist dort sichtbar.

Kein Vercel, kein manuelles `git push` zum Testen nötig. Die Live-App ist die Quelle der Wahrheit zum Prüfen.

Wenn du dem Agent nur sagst: **„publish“** oder **„deploy“**, soll er genau das tun.

## Lokal starten (optional)

```bash
npm install
env -u DATABASE_URL npm run dev
```

Ohne `DATABASE_URL` läuft die App gegen eine lokale In-Memory-Postgres (PGlite).

## Stack

- Next.js App Router
- Postgres (`DATABASE_URL` in Produktion, PGlite lokal)
- Cursor App Identity für den angemeldeten Viewer
