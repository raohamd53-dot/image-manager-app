-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalUrl" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shopId" TEXT NOT NULL,
    CONSTRAINT "Upload_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Composition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "layoutType" TEXT NOT NULL,
    "gridSize" TEXT NOT NULL,
    "previewUrl" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "cartToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT,
    CONSTRAINT "Composition_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Composition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompositionImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "compositionId" TEXT NOT NULL,
    "uploadId" TEXT,
    CONSTRAINT "CompositionImage_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompositionImage_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Upload_shopId_idx" ON "Upload"("shopId");

-- CreateIndex
CREATE INDEX "Composition_shopId_idx" ON "Composition"("shopId");

-- CreateIndex
CREATE INDEX "Composition_orderId_idx" ON "Composition"("orderId");

-- CreateIndex
CREATE INDEX "Composition_cartToken_idx" ON "Composition"("cartToken");

-- CreateIndex
CREATE INDEX "CompositionImage_compositionId_idx" ON "CompositionImage"("compositionId");
