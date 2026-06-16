// prisma/seed.js

import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  console.log("Seeding test data...");

  // Find your shop (created when you loaded the dashboard)
  const shop = await db.shop.findFirst();

  if (!shop) {
    console.log("No shop found. Load /app in your browser first, then run seed again.");
    return;
  }

  console.log(`Found shop: ${shop.myshopifyDomain}`);

  // Create a test order
  const order = await db.order.upsert({
    where: {
      shopId_shopifyOrderId: {
        shopId: shop.id,
        shopifyOrderId: "gid://shopify/Order/999999999",
      },
    },
    update: {},
    create: {
      shopId:           shop.id,
      shopifyOrderId:   "gid://shopify/Order/999999999",
      orderName:        "#TEST-001",
      financialStatus:  "PAID",
      fulfillmentStatus: "UNFULFILLED",
      totalPrice:       "49.99",
      currency:         "USD",
      customerName:     "Test Customer",
      customerEmail:    "test@example.com",
    },
  });

  console.log(`Created order: ${order.orderName}`);

  // Create test image uploads
  await db.imageUpload.createMany({
    data: [
      {
        orderId:      order.id,
        imageUrl:     "https://picsum.photos/800/600?random=1",
        originalName: "custom-photo-1.jpg",
        mimeType:     "image/jpeg",
        fileSize:     245760,
        width:        800,
        height:       600,
        status:       "PENDING",
      },
      {
        orderId:      order.id,
        imageUrl:     "https://picsum.photos/800/600?random=2",
        originalName: "custom-photo-2.jpg",
        mimeType:     "image/jpeg",
        fileSize:     189440,
        width:        800,
        height:       600,
        status:       "PENDING",
      },
      {
        orderId:      order.id,
        imageUrl:     "https://picsum.photos/800/600?random=3",
        originalName: "canvas-artwork.jpg",
        mimeType:     "image/jpeg",
        fileSize:     312320,
        width:        800,
        height:       600,
        status:       "APPROVED",
      },
    ],
    
  });

  console.log("Created 3 test images (2 pending, 1 approved)");
  console.log("Done. Navigate to /app/images to see them.");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());