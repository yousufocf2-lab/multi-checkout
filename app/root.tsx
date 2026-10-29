import type { LinksFunction } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useNavigation,
  useRouteError,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import stylesheet from "./tailwind.css?url";
import { asset } from "~/lib/asset";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" },
  { rel: "stylesheet", href: stylesheet },
  { rel: "icon", href: asset("/favicon.ico"), sizes: "48x48" },
  { rel: "icon", href: asset("/brand/growpefy-icon.svg"), type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: asset("/brand/apple-touch-icon.png") },
  { rel: "manifest", href: asset("/site.webmanifest") },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Thin top bar while a page or form is loading (appears after 150ms to avoid flicker). */
function NavigationProgress() {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!busy) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(t);
  }, [busy]);
  return (
    <div aria-hidden className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden transition-opacity ${show ? "opacity-100" : "opacity-0"}`}>
      <div className="h-full w-2/5 animate-bar rounded-full bg-brand" />
    </div>
  );
}

export default function App() {
  return (
    <>
      <NavigationProgress />
      <Outlet />
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string" && error.data ? error.data : error.statusText
    : "Please refresh the page and try again.";
  const title = status === 404 ? "Page not found" : status === 410 ? "This link has expired" : status === 403 ? "No access" : "Something went wrong";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="num text-sm font-medium text-ink-faint">Error {status}</p>
      <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-ink-soft">{message}</p>
      <a href="/" className="btn-secondary mt-6 self-start">Go to home</a>
    </main>
  );
}
