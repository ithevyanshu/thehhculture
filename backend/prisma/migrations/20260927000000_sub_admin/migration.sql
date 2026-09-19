-- Sub-admins: admin-panel access limited to granted sections.
ALTER TYPE "Role" ADD VALUE 'SUB_ADMIN' AFTER 'ADMIN';

ALTER TABLE "User" ADD COLUMN "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Admin password resets issue a temporary password that must be replaced.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
