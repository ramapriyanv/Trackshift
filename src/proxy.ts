import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth?.accessToken && !req.auth.error;
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/app") && !isLoggedIn) {
    return Response.redirect(new URL("/", req.nextUrl));
  }
  if (pathname === "/" && isLoggedIn) {
    return Response.redirect(new URL("/app", req.nextUrl));
  }
});

export const config = {
  matcher: ["/", "/app/:path*"],
};
