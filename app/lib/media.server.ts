// Store media (product / dish / service photos and video clips): uploaded to the Railway bucket "growpefy-media"
// and served through Growpefy at /media/<key> (the bucket itself is private).
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { env } from "./env.server";

export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
export const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
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
export async function uploadMedia(storeId: number, contentType: string, body: ReadableStream<Uint8Array>, size: number) {
  const ext = IMAGE_TYPES[contentType] ?? VIDEO_TYPES[contentType];
  if (!ext) throw new Error("Only photos (JPG, PNG, WebP, GIF) and videos (MP4, WebM, MOV) can be uploaded.");
  const isVideo = contentType in VIDEO_TYPES;
  const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > max) throw new Error(`That file is too big. ${isVideo ? "Videos" : "Photos"} can be up to ${Math.round(max / 1024 / 1024)} MB.`);
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
  return { url: `${env.appUrl}/media/${key}`, type: isVideo ? ("video" as const) : ("image" as const), bytes: seen };
}

/** Serves one file from the bucket, with Range support so videos can seek. */
export async function serveMedia(key: string, range: string | null) {
  if (!/^stores\/\d+\/[\w/.-]+$/.test(key) || key.includes("..")) return new Response("Not found", { status: 404 });
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: cfg().bucket, Key: key, Range: range ?? undefined }));
    const headers = new Headers({
      "Content-Type": r.ContentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    });
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
