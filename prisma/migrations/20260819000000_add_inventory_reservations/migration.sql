-- CreateTable
CREATE TABLE "inventory_reservations" (
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("orderId")
);
