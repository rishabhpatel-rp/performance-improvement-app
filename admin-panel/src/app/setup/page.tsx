import { redirect } from "next/navigation";
import { hasAnyAdminUser } from "@/lib/auth";
import SetupForm from "./setup-form";

/**
 * Server component so the gate is enforced BEFORE the form is ever sent to the
 * browser. As a client component this page rendered "Create Admin Account" to
 * anonymous visitors forever on a fully provisioned instance; only the POST
 * returned 409. A fresh, un-provisioned deployment is also takeable by whoever
 * reaches this page first, so provisioning must be done deliberately.
 */
export default async function SetupPage() {
  if (await hasAnyAdminUser()) {
    redirect("/login");
  }
  return <SetupForm />;
}
