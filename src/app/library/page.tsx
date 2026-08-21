"use client";

import { useEffect, useState } from "react";
import { LibraryPage } from "@/components/LibraryPage";

export default function Page() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready) {
    return (
      <div className="page-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  return <LibraryPage />;
}
