// app/lib/image.processing.server.js

import sharp from "sharp";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const UPLOAD_ROOT = join(process.cwd(), "public", "uploads");

/**
 * Parses "2x2" into { rows: 2, cols: 2 }
 */
function parseGridSize(gridSize) {
  const [rows, cols] = gridSize.split("x").map(Number);
  return { rows, cols };
}

/**
 * Ensures the shop+composition specific directory exists.
 * Returns the absolute path to that directory.
 */
async function ensureCompositionDir(shop, compositionId) {
  const dir = join(UPLOAD_ROOT, shop, "compositions", compositionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Builds the public URL for a file saved under public/uploads/...
 */
function toPublicUrl(shop, compositionId, filename) {
  return `/uploads/${shop}/compositions/${compositionId}/${filename}`;
}

// ─── Split Photo Grid ──────────────────────────────────────────────────────

/**
 * Takes ONE source image and crops it into rows×cols equal tiles.
 * Also generates a single merged preview image showing all tiles together
 * (visually identical to the original, but composed from the actual tile files —
 * this guarantees the preview always matches what was actually generated).
 *
 * @param {string} sourcePath - absolute path to the original uploaded file
 * @param {string} gridSize - "1x1" | "2x2" | "3x3"
 * @param {string} shop - myshopify domain
 * @param {string} compositionId - id of the Composition record being built
 * @returns {Promise<{ previewUrl: string, cells: Array<{ position: string, imageUrl: string }> }>}
 */
export async function splitImageIntoGrid({ sourcePath, gridSize, shop, compositionId }) {
  const { rows, cols } = parseGridSize(gridSize);
  const dir = await ensureCompositionDir(shop, compositionId);

  const image = sharp(sourcePath);
  const metadata = await image.metadata();

  const fullWidth = metadata.width;
  const fullHeight = metadata.height;

  // Use floor to avoid extracting past the image boundary on odd dimensions
  const cellWidth = Math.floor(fullWidth / cols);
  const cellHeight = Math.floor(fullHeight / rows);

  const cells = [];
  const compositeLayers = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const left = col * cellWidth;
      const top = row * cellHeight;

      const filename = `tile-${row}-${col}.jpg`;
      const outputPath = join(dir, filename);

      // Crop this exact region from the original — does NOT modify the original
      await sharp(sourcePath)
        .extract({ left, top, width: cellWidth, height: cellHeight })
        .jpeg({ quality: 90 })
        .toFile(outputPath);

      cells.push({
        position: `${row}-${col}`,
        imageUrl: toPublicUrl(shop, compositionId, filename),
      });

      compositeLayers.push({
        input: outputPath,
        left,
        top,
      });
    }
  }

  // Build one merged preview from the actual generated tiles,
  // with a visible gap between cells so the grid division is clear
  const GAP = 8; // pixels between each tile in the preview

  const previewFilename = "preview.jpg";
  const previewPath = join(dir, previewFilename);

  // Recalculate composite positions with gaps inserted
  const gappedLayers = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const layer = compositeLayers[row * cols + col];
      gappedLayers.push({
        input: layer.input,
        left: col * (cellWidth + GAP),
        top: row * (cellHeight + GAP),
      });
    }
  }

  const previewWidth = cellWidth * cols + GAP * (cols - 1);
  const previewHeight = cellHeight * rows + GAP * (rows - 1);

  await sharp({
    create: {
      width: previewWidth,
      height: previewHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(gappedLayers)
    .jpeg({ quality: 90 })
    .toFile(previewPath);

  return {
    previewUrl: toPublicUrl(shop, compositionId, previewFilename),
    previewWidth,
    previewHeight,
    cells,
  };
}

// ─── Photo Collage ─────────────────────────────────────────────────────────

/**
 * Takes MULTIPLE source images (one per grid cell) and composites them
 * into a single grid layout. Each image is resized to fit its cell exactly
 * (cover crop — fills the cell without distortion, cropping excess).
 *
 * @param {string[]} sourcePaths - absolute paths, one per uploaded image, in cell order
 * @param {string} gridSize - "1x1" | "2x2" | "3x3"
 * @param {string} shop
 * @param {string} compositionId
 * @returns {Promise<{ previewUrl: string, cells: Array<{ position: string, imageUrl: string }> }>}
 */
export async function composePhotoCollage({ sourcePaths, gridSize, shop, compositionId }) {
  const { rows, cols } = parseGridSize(gridSize);
  const dir = await ensureCompositionDir(shop, compositionId);

  const expectedCount = rows * cols;
  if (sourcePaths.length !== expectedCount) {
    throw new Error(
      `Collage requires exactly ${expectedCount} images for a ${gridSize} grid. Received ${sourcePaths.length}.`
    );
  }

  // Bug 4 fix: derive cell dimensions from the actual first uploaded image
  // rather than hardcoding a 600×600 square. The client-side crop tool
  // ensures all images already share the same aspect ratio (lockedCropDimensions),
  // so we only need to read the first image's size and use it as the cell size.
  // We cap the long edge at 2048px to keep output files reasonable.
  const MAX_CELL_LONG_EDGE = 2048;
  const firstMeta = await sharp(sourcePaths[0]).metadata();
  let cellWidth = firstMeta.width || 600;
  let cellHeight = firstMeta.height || 600;
  if (Math.max(cellWidth, cellHeight) > MAX_CELL_LONG_EDGE) {
    const scale = MAX_CELL_LONG_EDGE / Math.max(cellWidth, cellHeight);
    cellWidth = Math.round(cellWidth * scale);
    cellHeight = Math.round(cellHeight * scale);
  }

  const cells = [];
  const compositeLayers = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const sourcePath = sourcePaths[index];

      const filename = `cell-${row}-${col}.jpg`;
      const outputPath = join(dir, filename);

      // Resize each cell to the shared dimensions (cover fit keeps aspect
      // ratio honest — any tiny rounding difference is trimmed, not stretched)
      await sharp(sourcePath)
        .resize(cellWidth, cellHeight, { fit: "cover" })
        .jpeg({ quality: 90 })
        .toFile(outputPath);

      cells.push({
        position: `${row}-${col}`,
        imageUrl: toPublicUrl(shop, compositionId, filename),
      });

      compositeLayers.push({
        input: outputPath,
        left: col * cellWidth,
        top: row * cellHeight,
      });
    }
  }

  const GAP = 8;
  const gappedLayers = compositeLayers.map((layer, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
      input: layer.input,
      left: col * (cellWidth + GAP),
      top: row * (cellHeight + GAP),
    };
  });

  const previewWidth = cellWidth * cols + GAP * (cols - 1);
  const previewHeight = cellHeight * rows + GAP * (rows - 1);

  const previewFilename = "preview.jpg";
  const previewPath = join(dir, previewFilename);

  await sharp({
    create: {
      width: previewWidth,
      height: previewHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(gappedLayers)
    .jpeg({ quality: 90 })
    .toFile(previewPath);

  return {
    previewUrl: toPublicUrl(shop, compositionId, previewFilename),
    previewWidth,
    previewHeight,
    cells,
  };
}

// ─── Single Image (1x1) Passthrough ───────────────────────────────────────

/**
 * Handles the 1x1 case for both layout types — no splitting or compositing
 * needed, just normalize the image into the same file structure so the
 * rest of the app treats it identically to 2x2/3x3 results.
 */
export async function processSingleImage({ sourcePath, shop, compositionId }) {
  const dir = await ensureCompositionDir(shop, compositionId);

  const filename = "tile-0-0.jpg";
  const outputPath = join(dir, filename);

  await sharp(sourcePath)
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  const metadata = await sharp(outputPath).metadata();
  const url = toPublicUrl(shop, compositionId, filename);

  return {
    previewUrl: url,
    previewWidth: metadata.width,
    previewHeight: metadata.height,
    cells: [{ position: "0-0", imageUrl: url }],
  };
}