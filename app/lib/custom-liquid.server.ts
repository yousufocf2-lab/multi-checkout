// Custom Liquid sections: a store's own Liquid + HTML + CSS (+ JS) inside its website.
// The storefront can run on growpefy.com (same origin as the admin), so code is never trusted:
// - Liquid runs in its own engine with no file access and time / size / memory limits.
// - Plain HTML and CSS are placed in the page after a sanitizer removes anything that can run code.
// - Code with scripts, event handlers or embeds runs in a sandboxed frame (its own origin, no access to the page,
//   cookies or the admin) that resizes itself to its content.
import { Liquid } from "liquidjs";
import sanitizeHtml from "sanitize-html";
import { formatMoney, imgUrl } from "./storefront.server";

const MAX_CODE = 50_000;

const engine = new Liquid({
  strictFilters: false, strictVariables: false, jsTruthy: false, cache: false,
  parseLimit: MAX_CODE * 2, renderLimit: 1500, memoryLimit: 20_000_000,
  // No theme files or other templates can be included from custom code
  fs: {
    exists: async () => false, existsSync: () => false,
    readFile: async () => { throw new Error("include and render aren't available in Custom Liquid"); },
    readFileSync: () => { throw new Error("include and render aren't available in Custom Liquid"); },
    resolve: (_d, f) => f, contains: async () => false, containsSync: () => false, sep: "/", dirname: () => "",
  },
});
engine.registerFilter("money", (paise: unknown) => formatMoney(Number(paise) || 0));
engine.registerFilter("img_url", (url: unknown, width?: unknown) => imgUrl(String(url ?? ""), Number(width) || 0));

/** Decodes HTML entities so `jav&#x61;script:` is seen for what it is. */
const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) || 32))
  .replace(/&colon;/gi, ":").replace(/&tab;|&newline;/gi, "");

const ACTIVE = /<\s*(script|object|embed|applet|base|meta|link|frameset|portal)\b|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:|<\s*iframe[^>]*\ssrcdoc\s*=|<\s*form\b/i;

/** True when the output needs the sandboxed frame (it would run code). */
export const needsFrame = (html: string) => ACTIVE.test(html) || ACTIVE.test(decode(html).replace(/[\u0000-\u001f]/g, ""));

const SAFE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags, "img", "picture", "source", "video", "audio", "track", "figure", "figcaption", "iframe", "style",
    "section", "article", "aside", "header", "footer", "nav", "main", "details", "summary", "mark", "small", "sub", "sup", "del", "ins", "s", "u",
    "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs", "lineargradient", "radialgradient", "stop", "use", "symbol", "title",
    "button", "label", "progress", "meter", "time",
  ],
  allowVulnerableTags: true, // <style> is allowed on purpose: CSS can't run code
  allowedAttributes: {
    "*": ["class", "id", "style", "title", "role", "lang", "dir", "hidden", "tabindex", "aria-*", "data-*", "width", "height", "align"],
    a: ["href", "target", "rel", "name"],
    img: ["src", "srcset", "sizes", "alt", "loading", "decoding"],
    source: ["src", "srcset", "type", "media", "sizes"],
    video: ["src", "poster", "controls", "autoplay", "muted", "loop", "playsinline", "preload"],
    audio: ["src", "controls", "autoplay", "muted", "loop", "preload"],
    track: ["src", "kind", "srclang", "label", "default"],
    iframe: ["src", "allow", "allowfullscreen", "frameborder", "loading", "referrerpolicy"],
    button: ["type", "disabled"], label: ["for"], progress: ["value", "max"], meter: ["value", "min", "max"], time: ["datetime"],
    svg: ["viewbox", "viewBox", "xmlns", "fill", "stroke", "stroke-width", "preserveaspectratio"],
    path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "transform"],
    g: ["fill", "stroke", "transform"], circle: ["cx", "cy", "r", "fill", "stroke"], rect: ["x", "y", "rx", "ry", "fill", "stroke"],
    line: ["x1", "y1", "x2", "y2", "stroke"], polyline: ["points", "fill", "stroke"], polygon: ["points", "fill", "stroke"], ellipse: ["cx", "cy", "rx", "ry", "fill"],
    stop: ["offset", "stop-color", "stop-opacity"], lineargradient: ["x1", "y1", "x2", "y2", "gradientunits"], use: ["href"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel", "whatsapp", "upi"],
  allowedSchemesByTag: { img: ["http", "https", "data"], iframe: ["https"] },
  allowProtocolRelative: false,
  parser: { lowerCaseAttributeNames: false },
  transformTags: {
    a: (tag, attribs) => ({ tagName: tag, attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener noreferrer" } : attribs }),
    iframe: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, loading: attribs.loading ?? "lazy" } }),
  },
};

export const sanitize = (html: string) => sanitizeHtml(html, SAFE);

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A <script> or <style> left open would swallow everything after it; close it so the page still lays out. */
function closeOpen(html: string) {
  let out = html;
  for (const tag of ["script", "style"]) {
    const opens = (out.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;
    const closes = (out.match(new RegExp(`</${tag}\\s*>`, "gi")) ?? []).length;
    if (opens > closes) out += `</${tag}>`;
  }
  return out;
}

/** A sandboxed frame for code that runs scripts. Its own origin: no cookies, no access to the page or admin. */
function frame(id: string, html: string, vars: string) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top">
<style>:root{${vars}}html,body{margin:0;background:transparent}body{font:16px/1.55 var(--font-body,system-ui),system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink,#14171a)}img,video{max-width:100%;height:auto}a{color:var(--brand,#111827)}</style>
<script>(function(){var last=0;function send(){var d=document.documentElement,b=document.body;var h=Math.ceil(Math.max(d.getBoundingClientRect().height,b?b.scrollHeight:0));if(h!==last){last=h;parent.postMessage({gpFrame:${JSON.stringify(id)},h:h},"*")}}try{new ResizeObserver(send).observe(document.documentElement)}catch(e){}addEventListener("DOMContentLoaded",send);addEventListener("load",send);setTimeout(send,300);setTimeout(send,1500)})()</script>
</head><body>${closeOpen(html)}</body></html>`;
  return `<iframe class="gp-code-frame" data-gp-frame="${attr(id)}" title="Custom content" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-top-navigation-by-user-activation" loading="lazy" style="display:block;width:100%;height:120px;border:0;background:transparent" srcdoc="${attr(doc)}"></iframe>
<script>(function(){var f=document.querySelector('[data-gp-frame=${JSON.stringify(id).replace(/</g, "\\u003c")}]');if(!f)return;addEventListener("message",function(e){if(e.source===f.contentWindow&&e.data&&e.data.gpFrame===${JSON.stringify(id).replace(/</g, "\\u003c")}&&e.data.h>0)f.style.height=Math.min(e.data.h,20000)+"px"})})()</script>`;
}

export type CustomResult = { html: string; mode: "inline" | "frame" | "empty"; error: string | null };

/** Renders a Custom Liquid section's code. Errors show only in the editor; shoppers see nothing for a broken section. */
export async function renderCustomLiquid(code: string, scope: Record<string, unknown>, opts: { id: string; editor: boolean; vars: string }): Promise<CustomResult> {
  const src = String(code ?? "").slice(0, MAX_CODE);
  if (!src.trim()) {
    return { html: opts.editor ? `<div class="gp-code-empty">Custom Liquid: add your code in the editor.</div>` : "", mode: "empty", error: null };
  }
  let out = "";
  try {
    out = await engine.parseAndRender(src, scope);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/, file:.*$/s, "").slice(0, 300);
    return { html: opts.editor ? `<div class="gp-code-error"><b>Custom Liquid error</b><br>${text(msg)}</div>` : "", mode: "empty", error: msg };
  }
  if (needsFrame(out)) return { html: frame(opts.id, out, opts.vars), mode: "frame", error: null };
  return { html: sanitize(out), mode: "inline", error: null };
}
