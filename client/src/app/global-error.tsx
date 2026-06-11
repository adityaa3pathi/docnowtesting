"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.captureException(error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="min-h-screen bg-white px-6 py-20 text-slate-900">
          <div className="mx-auto max-w-md">
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="mt-3 text-sm text-slate-600">
              Please try again. If the issue continues, our team will use the error report to investigate.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
