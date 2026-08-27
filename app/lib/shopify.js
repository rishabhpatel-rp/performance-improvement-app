/**
 * Build a deep link into the Shopify theme editor, optionally focused on a
 * specific app block so merchants land directly on the script injector block.
 *
 * @param {string} shop - myshopify domain, e.g. "example.myshopify.com"
 * @param {string} [blockId] - app block id (from theme editor) to pre-select
 * @returns {string}
 */
export function getThemeEditorDeepLink(shop, blockId) {
  const base = `https://${shop}/admin/themes/editor?context=app`;
  return blockId ? `${base}&app_block_id=${encodeURIComponent(blockId)}` : base;
}
