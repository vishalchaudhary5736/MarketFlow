-- AlterTable
ALTER TABLE "User" ADD COLUMN     "last_order" TIMESTAMP(3),
ADD COLUMN     "total_orders" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_spent" BIGINT NOT NULL DEFAULT 0;
