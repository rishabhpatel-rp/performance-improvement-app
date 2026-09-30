import { redirect } from "next/navigation";

// Settings page is temporarily removed from the admin panel. The route
// redirects rather than 404ing so any existing links/bookmarks still land
// somewhere useful. Re-enable by restoring the previous page body (see git
// history) once ready to bring Settings back.
export default async function SettingsPage() {
  redirect("/dashboard");
}
