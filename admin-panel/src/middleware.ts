import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight, cookie-presence-only check. The cookie is an encrypted
// iron-session blob, so we can't validate its contents here (middleware
// runs on the Edge runtime and can't touch Prisma) — the dashboard layout
// does the real `requireAdmin()` check server-side and redirects if the
// session doesn't actually decrypt/validate. This middleware only avoids
// an unnecessary render for the common "no cookie at all" case.
export function middleware(request: NextRequest) {
  const session = request.cookies.get("admin-session");
  const pathname = request.nextUrl.pathname;

  const isLoginPage = pathname === "/login";
  const isSetupPage = pathname === "/setup";
  const isRootPage = pathname === "/";

  if (isLoginPage || isSetupPage) {
    return NextResponse.next();
  }

  if (isRootPage) {
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
