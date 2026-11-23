/** Lightweight process liveness check (no DB). */
export function loader() {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
