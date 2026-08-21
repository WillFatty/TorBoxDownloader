"use client";

import { useEffect, useState } from "react";
import { SearchWorkspace } from "@/components/SearchWorkspace";

export default function HomePage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="empty-state" style={{ minHeight: "40vh" }}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return <SearchWorkspace />;
}
