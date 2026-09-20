-- AlterEnum
-- Postgres refuses to use a newly added enum value inside the transaction that
-- added it, so the matching `SET DEFAULT 'INACTIVE'` lives in the next
-- migration rather than here.
ALTER TYPE "UserStatus" ADD VALUE 'INACTIVE';
