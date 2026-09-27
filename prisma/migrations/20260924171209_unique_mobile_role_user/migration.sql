/*
  Warnings:

  - You are about to drop the column `phone` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[countryCode,mobileNumber,role]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_mobileNumber_key";

-- DropIndex
DROP INDEX "User_phone_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "phone";

-- CreateIndex
CREATE UNIQUE INDEX "User_countryCode_mobileNumber_role_key" ON "User"("countryCode", "mobileNumber", "role");
