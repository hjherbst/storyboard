"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { formatDuration, formatUpdatedAt } from "@/lib/format";
import type { Scene, StoryboardDetail } from "@/lib/types";

type Props = { storyboardId: string };

async function fetchBoard(storyboardId: string): Promise<StoryboardDetail> {
  const res = await fetch(`/api/storyboards/${storyboardId}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    throw new Error("not_found");
  }
  if (!res.ok) {
    throw new Error("load_failed");
  }
  const data = (await res.json()) as { storyboard: StoryboardDetail };
  return data.storyboard;
}

export function StoryboardEditor({ storyboardId }: Props) {
  const router = useRouter();
  const [board, setBoard] = useState<StoryboardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchBoard(storyboardId)
      .then((next) => {
        if (cancelled) return;
        setBoard(next);
        setTitleDraft(next.title);
        setSummaryDraft(next.summary);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setBoard(null);
        setError(
          err.message === "not_found"
            ? "Storyboard nicht gefunden."
            : "Storyboard konnte nicht geladen werden.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [storyboardId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function refreshBoard() {
    return fetchBoard(storyboardId)
      .then((next) => {
        setBoard(next);
        setTitleDraft(next.title);
        setSummaryDraft(next.summary);
      })
      .catch(() => {
        setError("Storyboard konnte nicht geladen werden.");
      });
  }

  function scheduleMetaSave(nextTitle: string, nextSummary: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      startTransition(async () => {
        const res = await fetch(`/api/storyboards/${storyboardId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: nextTitle, summary: nextSummary }),
        });
        if (!res.ok) {
          setError("Titel oder Beschreibung konnten nicht gespeichert werden.");
          return;
        }
        const data = (await res.json()) as { storyboard: StoryboardDetail };
        setBoard(data.storyboard);
      });
    }, 450);
  }

  function addScene() {
    startTransition(async () => {
      const res = await fetch(`/api/storyboards/${storyboardId}/scenes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "", durationSeconds: 3 }),
      });
      if (!res.ok) {
        setError("Szene konnte nicht angelegt werden.");
        return;
      }
      await refreshBoard();
    });
  }

  function deleteBoard() {
    if (!window.confirm("Dieses Storyboard wirklich löschen?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/storyboards/${storyboardId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Löschen fehlgeschlagen.");
        return;
      }
      router.push("/");
    });
  }

  async function patchScene(
    sceneId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(
      `/api/storyboards/${storyboardId}/scenes/${sceneId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      setError("Szene konnte nicht aktualisiert werden.");
      return;
    }
    const data = (await res.json()) as {
      scene?: Scene;
      storyboard?: StoryboardDetail;
    };
    if (data.storyboard) {
      setBoard(data.storyboard);
      return;
    }
    await refreshBoard();
  }

  async function uploadImage(sceneId: string, file: File) {
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(
      `/api/storyboards/${storyboardId}/scenes/${sceneId}/image`,
      { method: "POST", body: form },
    );
    if (!res.ok) {
      setError(
        res.status === 400
          ? "Bild ungültig (JPG/PNG/WebP/GIF, max. 4 MB)."
          : "Bild-Upload fehlgeschlagen.",
      );
      return;
    }
    await refreshBoard();
  }

  async function removeScene(sceneId: string) {
    if (!window.confirm("Szene löschen?")) return;
    const res = await fetch(
      `/api/storyboards/${storyboardId}/scenes/${sceneId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setError("Szene konnte nicht gelöscht werden.");
      return;
    }
    await refreshBoard();
  }

  const totalDuration =
    board?.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) ?? 0;

  return (
    <div className="page-shell">
      <div className="atmosphere atmosphere--editor" aria-hidden />
      <SiteHeader
        eyebrow="Bearbeiten & erweitern"
        action={
          <div className="header-actions">
            <Link href="/" className="btn btn-ghost">
              Übersicht
            </Link>
            <button
              type="button"
              className="btn btn-danger"
              onClick={deleteBoard}
              disabled={pending || !board}
            >
              Löschen
            </button>
          </div>
        }
      />

      <main className="editor">
        {error ? <p className="banner-error">{error}</p> : null}

        {!board ? (
          <p className="muted loading-line">
            {error ? "—" : "Lade Storyboard…"}
          </p>
        ) : (
          <>
            <section className="editor-meta">
              <label className="field">
                <span>Titel</span>
                <input
                  value={titleDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTitleDraft(value);
                    scheduleMetaSave(value, summaryDraft);
                  }}
                  className="title-input"
                  placeholder="Titel des Videos"
                />
              </label>
              <label className="field">
                <span>Kurzbeschreibung</span>
                <textarea
                  value={summaryDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSummaryDraft(value);
                    scheduleMetaSave(titleDraft, value);
                  }}
                  rows={2}
                  placeholder="Worum geht es in diesem Video?"
                />
              </label>
              <p className="editor-stats">
                <span>
                  {board.scenes.length}{" "}
                  {board.scenes.length === 1 ? "Szene" : "Szenen"}
                </span>
                <span>{formatDuration(totalDuration)} Gesamt</span>
                <span>Aktualisiert {formatUpdatedAt(board.updatedAt)}</span>
              </p>
            </section>

            <section className="scene-section">
              <div className="scene-section__head">
                <h2>Szenen</h2>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={addScene}
                  disabled={pending}
                >
                  Szene hinzufügen
                </button>
              </div>

              {board.scenes.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <p>
                    Noch keine Szenen. Füge die erste Szene hinzu und lade ein
                    Foto vom Handy hoch.
                  </p>
                </div>
              ) : (
                <ol className="scene-list">
                  {board.scenes.map((scene, index) => (
                    <li key={scene.id} className="scene-item">
                      <div className="scene-item__index">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div className="scene-move">
                          <button
                            type="button"
                            aria-label="Szene nach oben"
                            disabled={index === 0}
                            onClick={() =>
                              void patchScene(scene.id, { move: "up" })
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="Szene nach unten"
                            disabled={index === board.scenes.length - 1}
                            onClick={() =>
                              void patchScene(scene.id, { move: "down" })
                            }
                          >
                            ↓
                          </button>
                        </div>
                      </div>

                      <label className="scene-frame">
                        {scene.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={scene.imageUrl} alt="" />
                        ) : (
                          <span className="scene-frame__placeholder">
                            Foto hochladen
                          </span>
                        )}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          capture="environment"
                          className="sr-only"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void uploadImage(scene.id, file);
                            event.target.value = "";
                          }}
                        />
                      </label>

                      <div className="scene-fields">
                        <label className="field field--inline">
                          <span>Dauer (Sekunden)</span>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            defaultValue={scene.durationSeconds}
                            key={`${scene.id}-duration-${scene.updatedAt}`}
                            onBlur={(event) => {
                              const value = Number(event.target.value);
                              if (
                                Number.isFinite(value) &&
                                value !== scene.durationSeconds
                              ) {
                                void patchScene(scene.id, {
                                  durationSeconds: value,
                                });
                              }
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>Beschreibung</span>
                          <textarea
                            rows={3}
                            defaultValue={scene.description}
                            key={`${scene.id}-desc-${scene.updatedAt}`}
                            placeholder="Was passiert in dieser Szene?"
                            onBlur={(event) => {
                              if (event.target.value !== scene.description) {
                                void patchScene(scene.id, {
                                  description: event.target.value,
                                });
                              }
                            }}
                          />
                        </label>
                        <div className="scene-actions">
                          {scene.hasImage ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                void patchScene(scene.id, { clearImage: true })
                              }
                            >
                              Foto entfernen
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void removeScene(scene.id)}
                          >
                            Szene löschen
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
