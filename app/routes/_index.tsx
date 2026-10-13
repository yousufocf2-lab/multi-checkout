import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";

export const meta: MetaFunction = () => [{ title: "Checkout" }];

export default function Index() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
      <p className="text-xl font-semibold">Checkout is running ✓</p>
      <Link to="/admin" className="mt-4 text-sm text-gray-500 underline">Admin</Link>
    </main>
  );
}
