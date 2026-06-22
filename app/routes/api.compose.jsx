// app/routes/api.compose.jsx

import { join } from "path";
import { db } from "../db.server";
import {
  createComposition,
  saveCompositionResult,
} from "../lib/db.compositions.server";
import {
  splitImageIntoGrid,
  composePhotoCollage,
  processSingleImage,
} from "../lib/image.processing.server";

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
    const body = await request.json();
    const { shop, layoutType, gridSize, uploadIds, productId, variantId, cartToken } = body;

    // ─── Validation ──────────────────────────────────────────────────────

    if (!shop || !layoutType || !gridSize || !Array.isArray(uploadIds)) {
      return Response.json(
        { error: "Missing required fields: shop, layoutType, gridSize, uploadIds" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!["split", "collage"].includes(layoutType)) {
      return Response.json(
        { error: 'layoutType must be "split" or "collage"' },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!["1x1", "2x2", "3x3"].includes(gridSize)) {
      return Response.json(
        { error: 'gridSize must be "1x1", "2x2", or "3x3"' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const [rows, cols] = gridSize.split("x").map(Number);
    const requiredCount = layoutType === "split" ? 1 : rows * cols;

    if (uploadIds.length !== requiredCount) {
      return Response.json(
        {
          error: `${layoutType === "split" ? "Split mode" : "Collage mode"} with ${gridSize} requires exactly ${requiredCount} image(s). Received ${uploadIds.length}.`,
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    // ─── Find Shop ───────────────────────────────────────────────────────

    const shopRecord = await db.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      return Response.json(
        { error: "Shop not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    // ─── Load Upload Records ─────────────────────────────────────────────

    const uploads = await db.upload.findMany({
      where: { id: { in: uploadIds }, shopId: shopRecord.id },
    });

    if (uploads.length !== uploadIds.length) {
      return Response.json(
        { error: "One or more uploadIds were not found for this shop" },
        { status: 404, headers: corsHeaders() }
      );
    }

    // Preserve the order the client sent them in (matters for collage grid position)
    const orderedUploads = uploadIds.map((id) => uploads.find((u) => u.id === id));

    // ─── Create Composition Record ──────────────────────────────────────

    const composition = await createComposition({
      shopId: shopRecord.id,
      layoutType,
      gridSize,
      productId:  productId  || null,
      variantId:  variantId  || null,
      cartToken:  cartToken  || null,
    });

    // ─── Run Sharp Processing ────────────────────────────────────────────

    const publicRoot = join(process.cwd(), "public");
    let result;
    let uploadIdByCell = {};

    if (layoutType === "split") {
      const sourcePath = join(publicRoot, orderedUploads[0].originalUrl);

      if (gridSize === "1x1") {
        result = await processSingleImage({
          sourcePath,
          shop,
          compositionId: composition.id,
        });
      } else {
        result = await splitImageIntoGrid({
          sourcePath,
          gridSize,
          shop,
          compositionId: composition.id,
        });
      }

      // Every cell traces back to the same single upload in split mode
      result.cells.forEach((cell) => {
        uploadIdByCell[cell.position] = orderedUploads[0].id;
      });

    } else {
      // Collage mode
      const sourcePaths = orderedUploads.map((u) => join(publicRoot, u.originalUrl));

      if (gridSize === "1x1") {
        result = await processSingleImage({
          sourcePath: sourcePaths[0],
          shop,
          compositionId: composition.id,
        });
        uploadIdByCell["0-0"] = orderedUploads[0].id;
      } else {
        result = await composePhotoCollage({
          sourcePaths,
          gridSize,
          shop,
          compositionId: composition.id,
        });

        const [, cols2] = gridSize.split("x").map(Number);
        result.cells.forEach((cell, index) => {
          uploadIdByCell[cell.position] = orderedUploads[index].id;
        });
      }
    }

    // ─── Save Results to Database ───────────────────────────────────────

    await saveCompositionResult({
      compositionId: composition.id,
      previewUrl:    result.previewUrl,
      cells:         result.cells,
      uploadIdByCell,
    });

    return Response.json(
      {
        success:       true,
        compositionId: composition.id,
        previewUrl:    result.previewUrl,
        cells:         result.cells,
      },
      { headers: corsHeaders() }
    );

  } catch (error) {
    console.error("Compose error:", error);
    return Response.json(
      { error: "Composition failed", details: error.message },
      { status: 500, headers: corsHeaders() }
    );
  }
};