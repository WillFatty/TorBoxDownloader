
import { useEffect, useState } from "react";
import { readJson } from "./LibraryShared";

interface SettingsView {
  torboxApiKey: string;
  cometUrl: string;
  moviesPath: string;
  tvShowsPath: string;
  jellyfinUrl: string;
  hasTorboxApiKey: boolean;
  hasJellyfinApiKey: boolean;
  hasOmdbApiKey: boolean;
}

export function SettingsForm() {
  const [form, setForm] = useState({
    torboxApiKey: "",
    cometUrl: "",
    moviesPath: "",
    tvShowsPath: "",
    jellyfinUrl: "",
    jellyfinApiKey: "",
    omdbApiKey: "",
  });
  const [hasKey, setHasKey] = useState(false);
  const [hasJfKey, setHasJfKey] = useState(false);
  const [hasOmdbKey, setHasOmdbKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "error">("ok");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings");
      const data = await readJson<{
        error?: string;
        settings?: SettingsView;
      }>(res);
      const s = data.settings as SettingsView;
      setForm({
        torboxApiKey: "",
        cometUrl: s.cometUrl || "",
        moviesPath: s.moviesPath || "",
        tvShowsPath: s.tvShowsPath || "",
        jellyfinUrl: s.jellyfinUrl || "",
        jellyfinApiKey: "",
        omdbApiKey: "",
      });
      setHasKey(s.hasTorboxApiKey);
      setHasJfKey(s.hasJellyfinApiKey);
      setHasOmdbKey(s.hasOmdbApiKey);
      setLoading(false);
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cometUrl: form.cometUrl,
          moviesPath: form.moviesPath,
          tvShowsPath: form.tvShowsPath,
          jellyfinUrl: form.jellyfinUrl,
          ...(form.torboxApiKey.trim()
            ? { torboxApiKey: form.torboxApiKey.trim() }
            : {}),
          ...(form.jellyfinApiKey.trim()
            ? { jellyfinApiKey: form.jellyfinApiKey.trim() }
            : {}),
          ...(form.omdbApiKey.trim()
            ? { omdbApiKey: form.omdbApiKey.trim() }
            : {}),
        }),
      });
      const data = await readJson<{
        error?: string;
        settings?: SettingsView;
      }>(res);
      if (!res.ok || !data.settings) {
        throw new Error(data.error || "Save failed");
      }
      const saved = data.settings;
      setHasKey(saved.hasTorboxApiKey);
      setHasJfKey(saved.hasJellyfinApiKey);
      setHasOmdbKey(saved.hasOmdbApiKey);
      setForm((f) => ({
        ...f,
        torboxApiKey: "",
        jellyfinApiKey: "",
        omdbApiKey: "",
        moviesPath: saved.moviesPath,
        tvShowsPath: saved.tvShowsPath,
        jellyfinUrl: saved.jellyfinUrl || "",
      }));
      setMsgTone("ok");
      setMsg("Saved.");
    } catch (err) {
      setMsgTone("error");
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="settings-page page-enter">
      <header className="settings-hero">
        <div className="settings-hero-copy">
          <p className="page-kicker">Config</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-desc">
            Connections, library paths, and Jellyfin. Values can also come from{" "}
            <code className="text-accent">.env</code>.
          </p>
        </div>
        <div className="settings-hero-actions">
          {msg && (
            <p className={`settings-msg is-${msgTone}`}>{msg}</p>
          )}
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </header>

      <div className="settings-pulse">
        <div className={`settings-pulse-item${hasKey ? " is-ok" : ""}`}>
          <span className="settings-pulse-dot" aria-hidden="true" />
          <div>
            <span className="settings-pulse-label">TorBox</span>
            <span className="settings-pulse-value">
              {hasKey ? "Key saved" : "Key missing"}
            </span>
          </div>
        </div>
        <div className={`settings-pulse-item${form.cometUrl ? " is-ok" : ""}`}>
          <span className="settings-pulse-dot" aria-hidden="true" />
          <div>
            <span className="settings-pulse-label">Comet</span>
            <span className="settings-pulse-value">
              {form.cometUrl ? "URL set" : "URL missing"}
            </span>
          </div>
        </div>
        <div
          className={`settings-pulse-item${
            form.moviesPath && form.tvShowsPath ? " is-ok" : ""
          }`}
        >
          <span className="settings-pulse-dot" aria-hidden="true" />
          <div>
            <span className="settings-pulse-label">Library</span>
            <span className="settings-pulse-value">
              {form.moviesPath && form.tvShowsPath
                ? "Paths set"
                : "Paths incomplete"}
            </span>
          </div>
        </div>
        <div
          className={`settings-pulse-item${
            form.jellyfinUrl && hasJfKey ? " is-ok" : ""
          }`}
        >
          <span className="settings-pulse-dot" aria-hidden="true" />
          <div>
            <span className="settings-pulse-label">Jellyfin</span>
            <span className="settings-pulse-value">
              {form.jellyfinUrl && hasJfKey
                ? "Connected"
                : form.jellyfinUrl || hasJfKey
                  ? "Partial"
                  : "Not set"}
            </span>
          </div>
        </div>
        <div
          className={`settings-pulse-item${hasOmdbKey ? " is-ok" : ""}`}
          title="Optional — adds Rotten Tomatoes and Metacritic scores"
        >
          <span className="settings-pulse-dot" aria-hidden="true" />
          <div>
            <span className="settings-pulse-label">Reviews</span>
            <span className="settings-pulse-value">
              {hasOmdbKey ? "RT + Metacritic" : "IMDb only"}
            </span>
          </div>
        </div>
      </div>

      <div className="settings-sections">
        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Connections</h2>
            <p className="settings-section-desc">
              TorBox downloads and Comet stream search.
            </p>
          </div>
          <div className="settings-fields">
            <label className="settings-field">
              <span className="settings-label">
                TorBox API key
                {hasKey && (
                  <span className="settings-hint-inline">
                    saved — leave blank to keep
                  </span>
                )}
              </span>
              <input
                type="password"
                className="field"
                value={form.torboxApiKey}
                onChange={(e) =>
                  setForm((f) => ({ ...f, torboxApiKey: e.target.value }))
                }
                placeholder={hasKey ? "••••••••" : "Paste API key"}
                autoComplete="off"
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">Comet base URL</span>
              <input
                className="field"
                value={form.cometUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cometUrl: e.target.value }))
                }
                placeholder="https://comet.elfhosted.com"
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">
                OMDb API key
                {hasOmdbKey ? (
                  <span className="settings-hint-inline">
                    saved — leave blank to keep
                  </span>
                ) : (
                  <span className="settings-hint-inline">optional</span>
                )}
              </span>
              <input
                type="password"
                className="field"
                value={form.omdbApiKey}
                onChange={(e) =>
                  setForm((f) => ({ ...f, omdbApiKey: e.target.value }))
                }
                placeholder={
                  hasOmdbKey ? "••••••••" : "Adds Rotten Tomatoes + Metacritic"
                }
                autoComplete="off"
              />
              <span className="settings-hint">
                Free key from{" "}
                <a
                  href="https://www.omdbapi.com/apikey.aspx"
                  target="_blank"
                  rel="noreferrer"
                >
                  omdbapi.com
                </a>
                . IMDb rating shows without it.
              </span>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Library paths</h2>
            <p className="settings-section-desc">
              Where finished downloads are filed for Jellyfin.
            </p>
          </div>
          <div className="settings-fields">
            <label className="settings-field">
              <span className="settings-label">Movies folder</span>
              <input
                className="field field-mono"
                value={form.moviesPath}
                onChange={(e) =>
                  setForm((f) => ({ ...f, moviesPath: e.target.value }))
                }
                placeholder="/raid/Jellyfin/Movies"
              />
              <span className="settings-hint">
                Saves as <code>Title (Year)/Title (Year) - 1080p.mkv</code>
              </span>
            </label>

            <label className="settings-field">
              <span className="settings-label">TV-Shows folder</span>
              <input
                className="field field-mono"
                value={form.tvShowsPath}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tvShowsPath: e.target.value }))
                }
                placeholder="/raid/Jellyfin/TV-Shows"
              />
              <span className="settings-hint">
                Saves as <code>Show/Season 1/Show - S01E01 - Title.mkv</code>
              </span>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Jellyfin</h2>
            <p className="settings-section-desc">
              Used by Library → Refresh metadata.
            </p>
          </div>
          <div className="settings-fields">
            <label className="settings-field">
              <span className="settings-label">Server URL</span>
              <input
                className="field"
                value={form.jellyfinUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, jellyfinUrl: e.target.value }))
                }
                placeholder="http://jellyfin.local:8096"
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">
                API key
                {hasJfKey && (
                  <span className="settings-hint-inline">
                    saved — leave blank to keep
                  </span>
                )}
              </span>
              <input
                type="password"
                className="field"
                value={form.jellyfinApiKey}
                onChange={(e) =>
                  setForm((f) => ({ ...f, jellyfinApiKey: e.target.value }))
                }
                placeholder={hasJfKey ? "••••••••" : "Dashboard → API Keys"}
                autoComplete="off"
              />
            </label>
          </div>
        </section>
      </div>

      <footer className="settings-foot">
        {msg && (
          <p className={`settings-msg is-${msgTone}`}>{msg}</p>
        )}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </footer>
    </form>
  );
}
