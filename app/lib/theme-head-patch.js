export const THEME_SNIPPET_FILENAME = "snippets/pagepulse-head-inline.liquid";
export const THEME_LAYOUT_FILENAME = "layout/theme.liquid";
export const THEME_RENDER_MARKER = "pagepulse-head-inline";
export const THEME_RENDER_LINE = `{% render '${THEME_RENDER_MARKER}' %}`;

/**
 * Insert the render tag immediately after the opening <head> tag (once).
 * @param {string} content
 */
export function patchThemeLayoutHead(content) {
  if (content.includes(THEME_RENDER_MARKER)) {
    return content;
  }
  const re = /<head(\s[^>]*)?>/i;
  const m = content.match(re);
  if (!m) {
    throw new Error("layout/theme.liquid: no <head> tag found");
  }
  const insertAt = content.indexOf(m[0]) + m[0].length;
  const injection = `\n  ${THEME_RENDER_LINE}\n`;
  return content.slice(0, insertAt) + injection + content.slice(insertAt);
}
