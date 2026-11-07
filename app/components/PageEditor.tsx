// Website page editor: a visual editor with a formatting toolbar, ready-made design blocks and an HTML code mode.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAGE_BLOCKS, PAGE_BLOCKS_CSS, PAGE_TEMPLATES } from "~/lib/page-blocks";

/** Code the visual editor can't safely show (it would run or restyle the admin): edited in HTML mode only. */
const ADVANCED = /<(script|style|iframe|form|object|embed|link|meta)\b|\son[a-z]+\s*=|javascript:/i;

const CANVAS_CSS = `
.pe-canvas{min-height:420px;padding:22px 26px 40px;outline:none;font:15px/1.65 Inter,system-ui,sans-serif;color:#1a1a1a;overflow-wrap:anywhere}
.pe-canvas h1,.pe-canvas h2,.pe-canvas h3,.pe-canvas h4{line-height:1.25;margin:1.1em 0 .45em;font-weight:700}
.pe-canvas h1{font-size:30px}.pe-canvas h2{font-size:24px}.pe-canvas h3{font-size:19px}.pe-canvas h4{font-size:16px}
.pe-canvas p{margin:0 0 .85em}.pe-canvas ul,.pe-canvas ol{margin:0 0 .85em;padding-left:1.4em}
.pe-canvas blockquote{margin:1em 0;padding:4px 0 4px 16px;border-left:3px solid #d4d4d4;color:#555}
.pe-canvas a{color:#2563eb;text-decoration:underline}
.pe-canvas img{max-width:100%;height:auto;border-radius:8px}
.pe-canvas table{border-collapse:collapse;width:100%}.pe-canvas td,.pe-canvas th{border:1px solid #e5e5e5;padding:6px 10px}
.pe-canvas:empty:before{content:attr(data-placeholder);color:#9a9a9a}
.pe-canvas details{pointer-events:auto}
`;

type Props = { name: string; initial: string; mediaUrl: string };

export function PageEditor({ name, initial, mediaUrl }: Props) {
  const [html, setHtml] = useState(initial);
  const advanced = ADVANCED.test(html);
  const [mode, setMode] = useState<"visual" | "code">(ADVANCED.test(initial) ? "code" : "visual");
  const canvas = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLTextAreaElement>(null);
  const range = useRef<Range | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<"blocks" | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // Put the HTML into the visual canvas when entering visual mode
  useEffect(() => {
    if (mode === "visual" && canvas.current && canvas.current.innerHTML !== html) canvas.current.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const syncFromCanvas = useCallback(() => {
    if (!canvas.current) return;
    const v = canvas.current.innerHTML.replace(/<p><br><\/p>$/, "").replace(/^<br>$/, "");
    setHtml(v);
  }, []);

  const saveRange = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && canvas.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    canvas.current?.focus();
    const s = window.getSelection();
    if (range.current && s) { s.removeAllRanges(); s.addRange(range.current); }
    else if (canvas.current && s) { const r = document.createRange(); r.selectNodeContents(canvas.current); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
  };

  const exec = (cmd: string, value?: string) => {
    restoreRange();
    document.execCommand(cmd, false, value);
    saveRange();
    syncFromCanvas();
  };

  const insertHtml = (snippet: string) => {
    if (mode === "code") {
      const t = code.current; if (!t) { setHtml((h) => h + "\n" + snippet); return; }
      const a = t.selectionStart, b = t.selectionEnd;
      const next = html.slice(0, a) + snippet + html.slice(b);
      setHtml(next);
      requestAnimationFrame(() => { t.focus(); t.selectionStart = t.selectionEnd = a + snippet.length; });
      return;
    }
    exec("insertHTML", snippet + "<p><br></p>");
  };

  const link = () => {
    saveRange();
    const sel = window.getSelection()?.toString() ?? "";
    const url = window.prompt("Link address (https://…, /products/all, tel:, mailto:)", "https://");
    if (!url || url === "https://") return;
    if (/^\s*javascript:/i.test(url)) return;
    if (sel) exec("createLink", url.trim());
    else exec("insertHTML", `<a href="${url.trim().replace(/"/g, "&quot;")}">${url.trim().replace(/</g, "&lt;")}</a>`);
  };

  const upload = async (f: File) => {
    setErr(""); setBusy("Uploading photo…");
    try {
      const r = await fetch(mediaUrl, { method: "POST", headers: { "Content-Type": f.type }, body: f });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || "Upload failed");
      insertHtml(`<img src="${d.url}" alt="">`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    setBusy("");
  };

  const switchMode = (m: "visual" | "code") => {
    if (m === mode) return;
    if (m === "visual" && advanced) return;
    if (mode === "visual") syncFromCanvas();
    setMode(m);
  };

  const applyTemplate = (t: (typeof PAGE_TEMPLATES)[number]) => {
    if (html.trim() && !window.confirm(`Replace the page content with the “${t.name}” design?`)) return;
    setHtml(t.html);
    if (mode === "visual" && canvas.current) canvas.current.innerHTML = t.html;
    setMenu(null);
  };

  const onCodeKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const t = e.currentTarget, a = t.selectionStart, b = t.selectionEnd;
    setHtml(html.slice(0, a) + "  " + html.slice(b));
    requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 2; });
  };

  const unclosed = useMemo(() => {
    const n = (re: RegExp) => (html.match(re) ?? []).length;
    return n(/<script\b/gi) > n(/<\/script\s*>/gi) ? "<script>" : n(/<style\b/gi) > n(/<\/style\s*>/gi) ? "<style>" : "";
  }, [html]);

  const B = ({ cmd, value, title, children }: { cmd: string; value?: string; title: string; children: React.ReactNode }) => (
    <button type="button" className="pe-btn" title={title} aria-label={title} disabled={mode === "code"} onMouseDown={(e) => { e.preventDefault(); exec(cmd, value); }}>{children}</button>
  );

  return (
    <div className="pe">
      <style>{CANVAS_CSS + PAGE_BLOCKS_CSS + PE_CSS}</style>
      <input type="hidden" name={name} value={html} />
      <div className="pe-bar" role="toolbar" aria-label="Formatting">
        <span className="pe-sel">
          <select aria-label="Text style" disabled={mode === "code"} value="" onMouseDown={saveRange} onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) exec("formatBlock", v); }}>
            <option value="">Text style</option>
            <option value="<p>">Paragraph</option>
            <option value="<h2>">Heading</option>
            <option value="<h3>">Sub-heading</option>
            <option value="<h4>">Small heading</option>
            <option value="<blockquote>">Quote</option>
          </select>
        </span>
        <i className="pe-sep" />
        <B cmd="bold" title="Bold"><b>B</b></B>
        <B cmd="italic" title="Italic"><i style={{ fontFamily: "Georgia,serif" }}>I</i></B>
        <B cmd="underline" title="Underline"><u>U</u></B>
        <B cmd="strikeThrough" title="Strike through"><s>S</s></B>
        <i className="pe-sep" />
        <B cmd="insertUnorderedList" title="Bullet list"><Svg d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></B>
        <B cmd="insertOrderedList" title="Numbered list"><Svg d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 15.5c0-.8.7-1.5 1.5-1.5S7 14.7 7 15.5 4 18 4 19h3" /></B>
        <B cmd="justifyLeft" title="Align left"><Svg d="M4 6h16M4 10h10M4 14h16M4 18h10" /></B>
        <B cmd="justifyCenter" title="Align centre"><Svg d="M4 6h16M7 10h10M4 14h16M7 18h10" /></B>
        <B cmd="justifyRight" title="Align right"><Svg d="M4 6h16M10 10h10M4 14h16M10 18h10" /></B>
        <i className="pe-sep" />
        <button type="button" className="pe-btn" title="Add link" aria-label="Add link" disabled={mode === "code"} onMouseDown={(e) => e.preventDefault()} onClick={link}><Svg d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></button>
        <B cmd="unlink" title="Remove link"><Svg d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7M4 4l16 16" /></B>
        <button type="button" className="pe-btn" title="Add photo" aria-label="Add photo" onMouseDown={(e) => { e.preventDefault(); saveRange(); }} onClick={() => file.current?.click()}><Svg d="M4 6h16v12H4zM4 15l4-4 4 4 3-3 5 5M15.5 9.5h.01" /></button>
        <B cmd="insertHorizontalRule" title="Line"><Svg d="M4 12h16" /></B>
        <B cmd="removeFormat" title="Clear formatting"><Svg d="M6 5h12M12 5l-3 14M5 19h7M15 14l5 5M20 14l-5 5" /></B>
        <i className="pe-sep" />
        <B cmd="undo" title="Undo"><Svg d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></B>
        <B cmd="redo" title="Redo"><Svg d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></B>
        <span className="pe-grow" />
        <div className="pe-pop">
          <button type="button" className="pe-add" onMouseDown={(e) => { e.preventDefault(); saveRange(); }} onClick={() => setMenu(menu ? null : "blocks")} aria-expanded={menu === "blocks"}>
            <Svg d="M12 5v14M5 12h14" /> Add block
          </button>
          {menu === "blocks" && (
            <div className="pe-menu" role="menu">
              <p className="pe-menu__h">Blocks</p>
              {PAGE_BLOCKS.map((b) => (
                <button key={b.id} type="button" role="menuitem" className="pe-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setMenu(null); insertHtml(b.html); }}>
                  <b>{b.name}</b><span>{b.hint}</span>
                </button>
              ))}
              <button type="button" role="menuitem" className="pe-item" onClick={() => { setMenu(null); if (mode === "visual") syncFromCanvas(); setMode("code"); requestAnimationFrame(() => insertHtmlCode()); }}>
                <b>Custom HTML / Liquid</b><span>Write your own code: HTML, CSS, Liquid or a script</span>
              </button>
              <p className="pe-menu__h">Whole page designs</p>
              {PAGE_TEMPLATES.map((t) => (
                <button key={t.id} type="button" role="menuitem" className="pe-item" onClick={() => applyTemplate(t)}>
                  <b>{t.name}</b><span>{t.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pe-tabs" role="tablist" aria-label="Editor mode">
          <button type="button" role="tab" aria-selected={mode === "visual"} disabled={advanced} title={advanced ? "This page has custom code. Edit it in HTML." : "Visual editor"} onClick={() => switchMode("visual")}>Visual</button>
          <button type="button" role="tab" aria-selected={mode === "code"} onClick={() => switchMode("code")}>{"</> HTML"}</button>
        </div>
      </div>

      {mode === "visual" ? (
        <div ref={canvas} className="pe-canvas page-body" contentEditable suppressContentEditableWarning data-placeholder="Start writing, or click “Add block” for ready-made designs…"
          onInput={syncFromCanvas} onKeyUp={saveRange} onMouseUp={saveRange} onBlur={() => { saveRange(); syncFromCanvas(); }}
          onPaste={(e) => {
            // Pasted text keeps its paragraphs but not the source site's styling
            const h = e.clipboardData.getData("text/html");
            if (!h) return;
            e.preventDefault();
            const doc = new DOMParser().parseFromString(h, "text/html");
            doc.querySelectorAll("script,style,meta,link,iframe,object,embed,form").forEach((n) => n.remove());
            doc.body.querySelectorAll("*").forEach((n) => { [...n.attributes].forEach((a) => { if (!/^(href|src|alt|colspan|rowspan)$/i.test(a.name)) n.removeAttribute(a.name); }); });
            doc.body.querySelectorAll("a").forEach((a) => { if (/^\s*javascript:/i.test(a.getAttribute("href") ?? "")) a.removeAttribute("href"); });
            document.execCommand("insertHTML", false, doc.body.innerHTML);
            syncFromCanvas();
          }} />
      ) : (
        <div className="pe-code">
          <textarea ref={code} value={html} onChange={(e) => setHtml(e.target.value)} onKeyDown={onCodeKey} spellCheck={false} autoCapitalize="off" autoComplete="off" wrap="off"
            aria-label="Page HTML" placeholder={"<h2>About {{ shop.name }}</h2>\n<p>Your own HTML, CSS and Liquid…</p>"} />
        </div>
      )}

      <div className="pe-foot">
        {busy && <span>{busy}</span>}
        {err && <span className="pe-err">{err}</span>}
        {unclosed && <span className="pe-err">A {unclosed} tag isn't closed. The code may have been cut off while pasting.</span>}
        {advanced && mode === "code" && <span>This page has custom code (style, script or embed), so it's edited in HTML. Scripts run in a secure frame on the website.</span>}
        {!busy && !err && !unclosed && !advanced && <span>Liquid works too: <code>{"{{ shop.name }}"}</code>, <code>{"{{ routes.all }}"}</code>. It shows as code here and as your details on the website.</span>}
        <span className="pe-grow" />
        <span>{html.length.toLocaleString("en-IN")} characters</span>
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
    </div>
  );

  function insertHtmlCode() {
    const snippet = `\n<div class="my-block">\n  <h2>Your heading</h2>\n  <p>Your text</p>\n</div>\n<style>\n  .my-block{padding:24px;background:#f5f6f7}\n</style>\n`;
    const t = code.current;
    const at = t ? t.selectionStart : html.length;
    setHtml((h) => h.slice(0, at) + snippet + h.slice(at));
  }
}

function Svg({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

const PE_CSS = `
.pe{border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.1);background:#fff;overflow:visible}
.pe-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:6px 8px;border-bottom:1px solid #ececec;background:#fafafa;border-radius:12px 12px 0 0}
.pe-btn{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 6px;border:0;background:none;border-radius:7px;color:#303030;font-size:13px;cursor:pointer}
.pe-btn:hover:not(:disabled){background:#ececec}.pe-btn:disabled{opacity:.35;cursor:default}
.pe-sep{width:1px;height:18px;background:#e2e2e2;margin:0 4px}
.pe-sel select{height:28px;border:0;background:transparent;border-radius:7px;padding:0 6px;font-size:12.5px;color:#303030;cursor:pointer}
.pe-sel select:hover{background:#ececec}
.pe-grow{flex:1}
.pe-pop{position:relative}
.pe-add{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border:0;border-radius:8px;background:#303030;color:#fff;font-size:12.5px;font-weight:550;cursor:pointer}
.pe-add:hover{background:#1a1a1a}
.pe-menu{position:absolute;right:0;top:34px;z-index:20;width:300px;max-height:420px;overflow:auto;background:#fff;border-radius:12px;box-shadow:0 10px 30px -8px rgba(0,0,0,.25),0 0 0 1px rgba(0,0,0,.08);padding:6px}
.pe-menu__h{margin:6px 8px 4px;font-size:11px;font-weight:600;color:#8a8a8a;text-transform:uppercase;letter-spacing:.06em}
.pe-item{display:block;width:100%;text-align:left;border:0;background:none;border-radius:8px;padding:7px 9px;cursor:pointer}
.pe-item:hover{background:#f3f3f3}
.pe-item b{display:block;font-size:13px;font-weight:550;color:#1a1a1a}.pe-item span{display:block;font-size:12px;color:#6b6b6b}
.pe-tabs{display:inline-flex;margin-left:6px;padding:2px;border-radius:8px;background:#ececec}
.pe-tabs button{height:24px;padding:0 9px;border:0;border-radius:6px;background:none;font-size:12px;font-weight:550;color:#5c5c5c;cursor:pointer}
.pe-tabs button[aria-selected=true]{background:#fff;color:#1a1a1a;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.pe-tabs button:disabled{opacity:.4;cursor:not-allowed}
.pe-code textarea{display:block;width:100%;min-height:460px;border:0;outline:none;resize:vertical;padding:16px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#1a1a1a;background:#fff;tab-size:2;white-space:pre}
.pe-foot{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:8px 12px;border-top:1px solid #ececec;font-size:12px;color:#6b6b6b}
.pe-foot code{font-size:11.5px;background:#f1f1f1;padding:1px 4px;border-radius:4px}
.pe-err{color:#b42318;font-weight:550}
`;
