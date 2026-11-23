import type { Page } from "playwright";

/** Drop hide selectors that still contain interactive / chrome children. */
export async function filterSelectorsWithInteractiveChildren(
  page: Page,
  selectors: string[],
): Promise<{ safe: string[]; rejected: string[] }> {
  if (!selectors.length) return { safe: [], rejected: [] };
  return page
    .evaluate((sels) => {
      const CHILD_UNSAFE =
        "button,a[href],input,textarea,select,form,nav,[role='navigation']," +
        "[role='dialog'],[role='banner'],[aria-live],[data-cart-count]," +
        "[data-cart-item-count],.cart-count,.cart-icon";
      const safe: string[] = [];
      const rejected: string[] = [];
      for (const sel of sels as string[]) {
        try {
          const els = document.querySelectorAll(sel);
          let hasUnsafe = false;
          for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el.matches(CHILD_UNSAFE) || el.querySelector(CHILD_UNSAFE)) {
              hasUnsafe = true;
              break;
            }
          }
          (hasUnsafe ? rejected : safe).push(sel);
        } catch {
          safe.push(sel);
        }
      }
      return { safe, rejected };
    }, selectors)
    .catch(() => ({ safe: selectors, rejected: [] as string[] }));
}
