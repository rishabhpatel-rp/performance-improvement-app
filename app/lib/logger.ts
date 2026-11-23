/* One small structured logger shared by the app and the worker. */
const NOOP_CONTEXT: Record<string, unknown> = Object.create(null);
let context: Record<string, unknown> = NOOP_CONTEXT;

export function setLogContext(fields: Record<string, unknown> = {}): void {
  context = { ...context, ...fields };
}

export function clearLogContext(): void {
  context = NOOP_CONTEXT;
}

function normalizeDetail(detail: unknown): unknown {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack };
  }
  return detail;
}

function emit(level: string, message: unknown, details: unknown[]): void {
  const payload: Record<string, unknown> = {
    level,
    message,
    ts: new Date().toISOString(),
    ...context,
  };
  if (details.length) payload.details = details.map(normalizeDetail);
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (message: unknown, ...details: unknown[]) => emit("debug", message, details),
  info: (message: unknown, ...details: unknown[]) => emit("info", message, details),
  warn: (message: unknown, ...details: unknown[]) => emit("warn", message, details),
  error: (message: unknown, ...details: unknown[]) => emit("error", message, details),
};

export function fireAndForget(promise: Promise<unknown>, label: string): void {
  Promise.resolve(promise).catch((err) => {
    logger.error(`${label} failed`, err);
  });
}
