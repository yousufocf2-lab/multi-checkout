import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, Link, Outlet } from "@remix-run/react";
import { requireAdmin } from "~/lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Checkout admin" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}

export default function AdminLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="font-bold">Checkout admin</Link>
          <Form method="post" action="/admin/logout">
            <button className="text-sm text-gray-500 hover:text-gray-800">Logout</button>
          </Form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
