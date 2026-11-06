"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { formatDuration, formatUpdatedAt } from "@/lib/format";
import type { StoryboardSummary } from "@/lib/types";

export function StoryboardOverview() {
  const router = useRouter();
  const [boards, setBoards] = useState<StoryboardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/storyboards", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) throw new Error("unauthorized");
        if (!res.ok) throw new Error("load_failed");
        return (await res.json()) as { storyboards: StoryboardSummary[] };
      })
      .then((data) => {
        if (!cancelled) setBoards(data.storyboards);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setBoards([]);
          setError(
            err.message === "unauthorized"
              ? "Bitte in Cursor anmelden und die App auf Private stellen."
              : "Storyboards konnten nicht geladen werden.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createBoard() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/storyboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Neues Storyboard" }),
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? "Bitte in Cursor anmelden und die App auf Private stellen."
            : res.status === 429
              ? "Limit erreicht — bitte bestehende Storyboards löschen."
              : "Storyboard konnte nicht erstellt werden.",
        );
        return;
      }
      const data = (await res.json()) as { storyboard: StoryboardSummary };
      router.push(`/storyboards/${data.storyboard.id}`);
    } catch {
      setError("Storyboard konnte nicht erstellt werden.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="atmosphere" aria-hidden />
      <SiteHeader
        eyebrow="Videoplanung in Szenen"
        action={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void createBoard()}
            disabled={creating}
          >
            {creating ? "Erstelle…" : "Neues Storyboard"}
          </button>
        }
      />

      <main className="overview">
        <section className="overview-hero">
          <h1 className="brand-hero">Storyboard</h1>
          <p className="lede">
            Plane Videos Szene für Szene — mit Foto, Dauer und Beschreibung.
          </p>
        </section>

        {error ? <p className="banner-error">{error}</p> : null}

        {boards === null ? (
          <p className="muted loading-line">Lade Übersicht…</p>
        ) : boards.length === 0 ? (
          <section className="empty-state">
            <h2>Noch keine Storyboards</h2>
            <p>
              Lege dein erstes Board an und baue daraus eine visuelle
              Schnittfolge.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void createBoard()}
              disabled={creating}
            >
              Erstes Storyboard anlegen
            </button>
          </section>
        ) : (
          <ul className="board-list">
            {boards.map((board, index) => (
              <li
                key={board.id}
                className="board-row"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <Link href={`/storyboards/${board.id}`} className="board-link">
                  <div className="board-link__main">
                    <h2>{board.title}</h2>
                    <p>
                      {board.summary.trim() ||
                        "Noch keine Kurzbeschreibung — öffnen und erweitern."}
                    </p>
                  </div>
                  <div className="board-link__meta">
                    <span>
                      {board.sceneCount}{" "}
                      {board.sceneCount === 1 ? "Szene" : "Szenen"}
                    </span>
                    <span>{formatDuration(board.totalDurationSeconds)}</span>
                    <span>{formatUpdatedAt(board.updatedAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
