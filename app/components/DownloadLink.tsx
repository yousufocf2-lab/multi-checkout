import { useState } from "react";
import { BusyOverlay } from "./Brand";

/** Downloads a file (CSV) in the background with the Growpefy loader, then saves it. Falls back to a normal link. */
export function DownloadLink({ href, className, children, title = "Preparing your file" }: { href: string; className?: string; children: React.ReactNode; title?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || busy) return;
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (res.redirected && new URL(res.url).pathname === "/login") { window.location.href = res.url; return; }
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? href.split("?")[0].split("/").pop() ?? "export.csv";
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setError("Download failed. Try again.");
      setTimeout(() => setError(""), 4000);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a href={href} onClick={onClick} className={className} title={error || undefined} aria-busy={busy}>{error ? <span className="text-bad">{error}</span> : children}</a>
      {busy && <BusyOverlay title={title} note="Your download will start in a moment." />}
    </>
  );
}
