import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_MS = 12000;

/**
 * Password-protection state for the Step 1 password box.
 *
 * `initial` is the value the loader read from the database: true / false once
 * the background check (app/lib/password-protection.server.ts) has answered,
 * null while it has not. While null, this polls /api/password-status every
 * second for up to ~12 s and switches to true / false as soon as the server has
 * an answer. If it never answers the state stays null and the box stays hidden
 * (the toggle-time check and the audit still catch a protected store).
 */
export function usePasswordStatus(initial) {
  const [state, setState] = useState(initial);

  // A fresh loader value (e.g. after a revalidation) wins when it is definite.
  useEffect(() => {
    if (initial !== null) setState(initial);
  }, [initial]);

  useEffect(() => {
    if (state !== null) return undefined;
    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const res = await fetch(`/api/password-status${window.location.search}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.state === "protected") setState(true);
        else if (data.state === "not_protected") setState(false);
      } catch {
        // transient failure: try again on the next tick
      }
    };

    const timer = setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        clearInterval(timer);
        return;
      }
      poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state]);

  return state;
}
