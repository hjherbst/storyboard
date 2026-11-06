# Storyboard

Plattform zur Videoplanung: Storyboards anlegen, Szenen mit Foto, Dauer und Beschreibung bearbeiten.

## Lokal starten

```bash
npm install
env -u DATABASE_URL npm run dev
```

Ohne `DATABASE_URL` läuft die App gegen eine lokale In-Memory-Postgres (PGlite).

## Stack

- Next.js App Router
- Postgres (`DATABASE_URL` in Produktion, PGlite lokal)
- Cursor App Identity für den angemeldeten Viewer
