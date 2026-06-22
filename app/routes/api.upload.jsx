// app/routes/api.upload.jsx

import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import sharp from "sharp";
import { db } from "../db.server";
import { createUpload } from "../lib/db.compositions.server";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  return new Response(null, { status: 405, headers: corsHeaders() });
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders() }
    );
  }

  try {
    const url  = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return Response.json(
        { error: "Missing required parameter: shop" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const shopRecord = await db.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      return Response.json(
        { error: "Shop not found. App may not be installed." },
        { status: 404, headers: corsHeaders() }
      );
    }

    // ─── Parse multipart form data using the native Web API ──────────────
    // request.formData() is built into the Fetch API standard that
    // React Router v7 uses internally — no extra package needed.

    const formData = await request.formData();
    const file = formData.get("image");

    if (!file || typeof file === "string") {
      return Response.json(
        { error: "No image file provided" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // file is a native Web API "File" object here (Blob with a .name)
    const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED_TYPES.includes(file.type)) {
      return Response.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400, headers: corsHeaders() }
      );
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      return Response.json(
        { error: "File exceeds 10MB limit" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // ─── Save file to disk manually ────────────────────────────────────────

    const shopUploadDir = join(UPLOAD_DIR, shop, "originals");
    await mkdir(shopUploadDir, { recursive: true });

    const timestamp = Date.now();
    const random    = Math.random().toString(36).slice(2);
    const ext       = file.name.split(".").pop();
    const filename  = `${timestamp}-${random}.${ext}`;
    const savedPath = join(shopUploadDir, filename);

    // Convert the Web API File/Blob into a Node Buffer, then write it
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(savedPath, buffer);

    // ─── Read actual dimensions using Sharp ────────────────────────────────

    const metadata = await sharp(savedPath).metadata();

    const publicUrl = `/uploads/${shop}/originals/${filename}`;

    // ─── Save Upload record to database ────────────────────────────────────

    const upload = await createUpload({
      shopId:      shopRecord.id,
      originalUrl: publicUrl,
      width:       metadata.width,
      height:      metadata.height,
      fileSize:    file.size,
      mimeType:    file.type,
    });

    return Response.json(
      {
        success:  true,
        uploadId: upload.id,
        url:      publicUrl,
        width:    metadata.width,
        height:   metadata.height,
      },
      { headers: corsHeaders() }
    );

  } catch (error) {
    console.error("Upload error:", error);
    return Response.json(
      { error: "Upload failed", details: error.message },
      { status: 500, headers: corsHeaders() }
    );
  }
};