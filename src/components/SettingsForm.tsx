"use client";

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
}

export function SettingsForm() {
  const [form, setForm] = useState({
    torboxApiKey: "",
    cometUrl: "",
    moviesPath: "",
    tvShowsPath: "",
    jellyfinUrl: "",
    jellyfinApiKey: "",
  });
  const [hasKey, setHasKey] = useState(false);
  const [hasJfKey, setHasJfKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
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
      });
      setHasKey(s.hasTorboxApiKey);
      setHasJfKey(s.hasJellyfinApiKey);
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
      setForm((f) => ({
        ...f,
        torboxApiKey: "",
        jellyfinApiKey: "",
        moviesPath: saved.moviesPath,
        tvShowsPath: saved.tvShowsPath,
        jellyfinUrl: saved.jellyfinUrl || "",
      }));
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="px-4 py-8 text-[var(--muted)] sm:px-6">Loading…</p>
    );
  }

  return (
    <form onSubmit={save} className="page-shell page-enter max-w-xl">
      <div className="page-header">
        <div>
          <p className="page-kicker">Config</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-desc">
            TorBox key, Comet URL, Movies / TV-Shows folders. Also set via{" "}
            <code className="text-[var(--accent)]">.env</code>.
          </p>
        </div>
      </div>

      <div className="panel space-y-5 p-5 sm:p-6">
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            TorBox API key{" "}
            {hasKey && (
              <span className="normal-case tracking-normal text-[var(--accent)]">
                (saved — leave blank to keep)
              </span>
            )}
          </span>
          <input
            type="password"
            className="field w-full"
            value={form.torboxApiKey}
            onChange={(e) =>
              setForm((f) => ({ ...f, torboxApiKey: e.target.value }))
            }
            placeholder={hasKey ? "••••••••" : "Paste API key"}
            autoComplete="off"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Comet base URL
          </span>
          <input
            className="field w-full"
            value={form.cometUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, cometUrl: e.target.value }))
            }
            placeholder="https://comet.elfhosted.com"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Movies folder
          </span>
          <input
            className="field w-full font-mono text-sm"
            value={form.moviesPath}
            onChange={(e) =>
              setForm((f) => ({ ...f, moviesPath: e.target.value }))
            }
            placeholder="/raid/Jellyfin/Movies"
          />
          <span className="block text-xs text-[var(--muted)]">
            Saves as <code>Title (Year)/Title (Year) - 1080p.mkv</code>
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            TV-Shows folder
          </span>
          <input
            className="field w-full font-mono text-sm"
            value={form.tvShowsPath}
            onChange={(e) =>
              setForm((f) => ({ ...f, tvShowsPath: e.target.value }))
            }
            placeholder="/raid/Jellyfin/TV-Shows"
          />
          <span className="block text-xs text-[var(--muted)]">
            Saves as <code>Show/Season 1/Show - S01E01 - Title.mkv</code>
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Jellyfin server URL
          </span>
          <input
            className="field w-full"
            value={form.jellyfinUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, jellyfinUrl: e.target.value }))
            }
            placeholder="http://jellyfin.local:8096"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Jellyfin API key{" "}
            {hasJfKey && (
              <span className="normal-case tracking-normal text-[var(--accent)]">
                (saved — leave blank to keep)
              </span>
            )}
          </span>
          <input
            type="password"
            className="field w-full"
            value={form.jellyfinApiKey}
            onChange={(e) =>
              setForm((f) => ({ ...f, jellyfinApiKey: e.target.value }))
            }
            placeholder={hasJfKey ? "••••••••" : "Dashboard → API Keys"}
            autoComplete="off"
          />
          <span className="block text-xs text-[var(--muted)]">
            Used by the Library&apos;s &quot;Refresh metadata&quot; check.
          </span>
        </label>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
      </div>
    </form>
  );
}
