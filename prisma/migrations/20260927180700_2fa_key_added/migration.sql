-- AlterTable
ALTER TABLE "User" ADD COLUMN     "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "two_factor_secret" TEXT,
ADD COLUMN     "two_factor_setup_completed" BOOLEAN NOT NULL DEFAULT false;
