export const ROLE_LABEL = { MAIN: "Live", UNPUBLISHED: "Unpublished", DEMO: "Demo" };

export const PASSWORD_BLOCK_MESSAGE = {
  PASSWORD_REQUIRED:
    "Your store is password protected. Enter the storefront password below and we'll scan again.",
  PASSWORD_INCORRECT:
    "The saved password didn't work. Update it below and we'll scan again.",
};

export function shortPath(path, max = 40) {
  if (!path || path.length <= max) return path || "";
  const half = Math.floor((max - 1) / 2);
  return `${path.slice(0, half)}…${path.slice(-half)}`;
}
