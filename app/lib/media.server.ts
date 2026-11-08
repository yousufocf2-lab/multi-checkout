// Store media (product / dish / service photos and video clips): uploaded to the Railway bucket "growpefy-media"
// and served through Growpefy at /media/<key> (the bucket itself is private).
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { env } from "./env.server";

export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
export const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
// Files library also takes documents. No SVG/HTML: files are served from growpefy.com, so nothing that can run script.
export const DOC_TYPES: Record<string, string> = {
  "application/pdf": "pdf", "text/csv": "csv", "text/plain": "txt", "application/json": "json", "application/zip": "zip", "application/x-zip-compressed": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf", "audio/mpeg": "mp3",
};
const EXT_MIME: Record<string, string> = Object.fromEntries([...Object.entries(IMAGE_TYPES), ...Object.entries(VIDEO_TYPES), ...Object.entries(DOC_TYPES)].map(([m, e]) => [e, m]));
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

const cfg = () => ({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "",
  bucket: process.env.MEDIA_S3_BUCKET ?? "",
  region: process.env.MEDIA_S3_REGION || "auto",
  key: process.env.MEDIA_S3_KEY ?? "",
  secret: process.env.MEDIA_S3_SECRET ?? "",
});

export const mediaReady = () => { const c = cfg(); return Boolean(c.endpoint && c.bucket && c.key && c.secret); };

let client: S3Client | null = null;
function s3() {
  const c = cfg();
  if (!mediaReady()) throw new Error("Media storage isn't set up yet.");
  client ??= new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: false, credentials: { accessKeyId: c.key, secretAccessKey: c.secret } });
  return client;
}

/** Streams an upload (the request body) into the bucket. Returns the public Growpefy URL. */
export async function uploadMedia(storeId: number, contentType: string, body: ReadableStream<Uint8Array>, size: number, opts: { documents?: boolean } = {}) {
  const ext = IMAGE_TYPES[contentType] ?? VIDEO_TYPES[contentType] ?? (opts.documents ? DOC_TYPES[contentType] : undefined);
  if (!ext) throw new Error(opts.documents
    ? "This file type can't be uploaded. Use photos, videos, PDF, Word, Excel, CSV, ZIP or fonts."
    : "Only photos (JPG, PNG, WebP, GIF) and videos (MP4, WebM, MOV) can be uploaded.");
  const isVideo = contentType in VIDEO_TYPES;
  const kind = isVideo ? ("video" as const) : contentType in IMAGE_TYPES ? ("image" as const) : ("document" as const);
  const max = isVideo ? MAX_VIDEO_BYTES : kind === "image" ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
  if (size > max) throw new Error(`That file is too big. ${isVideo ? "Videos" : kind === "image" ? "Photos" : "Documents"} can be up to ${Math.round(max / 1024 / 1024)} MB.`);
  const now = new Date();
  const key = `stores/${storeId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomBytes(10).toString("hex")}.${ext}`;

  // Count bytes as they pass, and stop a body that is bigger than it said
  let seen = 0;
  const counted = Readable.fromWeb(body as never).on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > max) counted.destroy(new Error("That file is too big."));
  });
  await new Upload({
    client: s3(),
    params: { Bucket: cfg().bucket, Key: key, Body: counted, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" },
    queueSize: 3, partSize: 8 * 1024 * 1024,
  }).done();
  return { url: `${env.appUrl}/media/${key}`, key, kind, type: isVideo ? ("video" as const) : ("image" as const), bytes: seen };
}

export async function deleteMedia(key: string) {
  if (!/^stores\/\d+\//.test(key)) return;
  await s3().send(new DeleteObjectCommand({ Bucket: cfg().bucket, Key: key }));
}

/** Everything already in the bucket for a store (uploads from before the Files library). */
export async function listStoreMedia(storeId: number, max = 2000) {
  const out: { key: string; bytes: number; at: Date; mime: string }[] = [];
  let token: string | undefined;
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: cfg().bucket, Prefix: `stores/${storeId}/`, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) {
      if (!o.Key) continue;
      const ext = o.Key.split(".").pop()?.toLowerCase() ?? "";
      out.push({ key: o.Key, bytes: o.Size ?? 0, at: o.LastModified ?? new Date(), mime: EXT_MIME[ext] ?? "application/octet-stream" });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token && out.length < max);
  return out;
}

export const mimeKind = (mime: string) => (mime in VIDEO_TYPES ? "video" : mime in IMAGE_TYPES ? "image" : "document") as "image" | "video" | "document";

/** Serves one file from the bucket, with Range support so videos can seek. */
export async function serveMedia(key: string, range: string | null) {
  if (!/^stores\/\d+\/[\w/.-]+$/.test(key) || key.includes("..")) return new Response("Not found", { status: 404 });
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: cfg().bucket, Key: key, Range: range ?? undefined }));
    const type = r.ContentType ?? "application/octet-stream";
    const headers = new Headers({
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });
    // Documents never run in the page: PDFs open in the browser's viewer (sandboxed), everything else downloads
    if (!(type in IMAGE_TYPES) && !(type in VIDEO_TYPES)) {
      headers.set("Content-Security-Policy", "sandbox");
      if (type !== "application/pdf") headers.set("Content-Disposition", "attachment");
    }
    if (r.ContentLength != null) headers.set("Content-Length", String(r.ContentLength));
    if (r.ContentRange) headers.set("Content-Range", r.ContentRange);
    if (r.ETag) headers.set("ETag", r.ETag);
    const stream = r.Body?.transformToWebStream();
    return new Response(stream ?? null, { status: r.ContentRange ? 206 : 200, headers });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return new Response("Not found", { status: 404 });
    if (name === "InvalidRange") return new Response("Range not satisfiable", { status: 416 });
    console.error("[media]", key, e instanceof Error ? e.message : e);
    return new Response("Media unavailable", { status: 502 });
  }
}
