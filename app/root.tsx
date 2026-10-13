import type { LinksFunction } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import stylesheet from "./tailwind.css?url";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
  { rel: "stylesheet", href: stylesheet },
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
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error) ? `${error.status}` : "Kuch gadbad ho gayi";
  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string" ? error.data : error.statusText
    : "Page reload karke dobara try karein.";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
      <p className="text-4xl font-bold">{title}</p>
      <p className="mt-2 text-gray-600">{message}</p>
    </main>
  );
}
