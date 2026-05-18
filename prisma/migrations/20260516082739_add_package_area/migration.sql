-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "centerLat" DOUBLE PRECISION,
ADD COLUMN     "centerLng" DOUBLE PRECISION,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "radiusKm" DOUBLE PRECISION;
