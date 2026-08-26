# Technical Requirements - Performance Improvement App

## Summary

| Requirement | How to Achieve It |
|-------------|-------------------|
| Inject scripts in `<head>` | Use Theme App Extensions with App Blocks that target head. |
| Let merchants add names to an array | Build the backend UI in your React Router app. Save the array to a Metaobject or your database. |
| Enable/Disable individual scripts | Use the App Embed panel in Shopify's theme editor to toggle blocks on/off. |
| "Plug and play" experience | The app installs and the merchant immediately finds the controls in the theme editor; no complex configurations needed. |
| Ensure performance | App Blocks limit scripts to necessary pages, preventing site-wide bloat. |