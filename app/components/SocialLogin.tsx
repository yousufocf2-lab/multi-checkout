// "Continue with Google / Facebook" buttons (shown only when the keys are set on the server).
export function SocialLogin({ google, facebook, next = "/dashboard", error }: { google: boolean; facebook: boolean; next?: string; error?: string | null }) {
  if (!google && !facebook) return null;
  const q = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="space-y-2.5">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
      {google && (
        <a href={`/auth/google${q}`} className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-rule bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-paper">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </a>
      )}
      {facebook && (
        <a href={`/auth/facebook${q}`} className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>
          Continue with Facebook
        </a>
      )}
      <div className="flex items-center gap-3 py-1 text-xs text-ink-faint"><span className="h-px flex-1 bg-rule" />or<span className="h-px flex-1 bg-rule" /></div>
    </div>
  );
}
