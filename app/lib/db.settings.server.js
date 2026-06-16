// app/lib/db.settings.server.js

import { db } from "../db.server";

const DEFAULTS = {
  maxFileSizeMb:     10,
  allowedFileTypes:  "jpg,jpeg,png,webp",
  notifyOnUpload:    true,
  notifyOnReview:    false,
  storageProvider:   "local",
};

/**
 * Get settings for a shop.
 * Returns defaults if no settings row exists yet.
 */
export async function getShopSettings(shopId) {
  const settings = await db.shopSettings.findUnique({
    where: { shopId },
  });

  if (!settings) return { ...DEFAULTS, shopId, isNew: true };
  return { ...settings, isNew: false };
}

/**
 * Save settings for a shop.
 * Creates the row if it doesn't exist, updates if it does.
 */
export async function saveShopSettings({
  shopId,
  maxFileSizeMb,
  allowedFileTypes,
  notifyOnUpload,
  notifyOnReview,
  storageProvider,
}) {
  return db.shopSettings.upsert({
    where:  { shopId },
    update: {
      maxFileSizeMb:    parseInt(maxFileSizeMb, 10),
      allowedFileTypes: allowedFileTypes.trim(),
      notifyOnUpload:   notifyOnUpload === "true" || notifyOnUpload === true,
      notifyOnReview:   notifyOnReview === "true" || notifyOnReview === true,
      storageProvider,
      updatedAt:        new Date(),
    },
    create: {
      shopId,
      maxFileSizeMb:    parseInt(maxFileSizeMb, 10),
      allowedFileTypes: allowedFileTypes.trim(),
      notifyOnUpload:   notifyOnUpload === "true" || notifyOnUpload === true,
      notifyOnReview:   notifyOnReview === "true" || notifyOnReview === true,
      storageProvider,
    },
  });
}