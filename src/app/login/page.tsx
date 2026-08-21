"use client";

import { Suspense, useEffect, useState } from "react";
import { LoginForm } from "@/components/LoginForm";

function LoginClient() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready) {
    return (
      <p
        className="muted"
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Loading…
      </p>
    );
  }
  return <LoginForm />;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <p
          className="muted"
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Loading…
        </p>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
