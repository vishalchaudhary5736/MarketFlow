-- AlterTable
-- New accounts start unverified and cannot sign in until they are activated.
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'INACTIVE';
