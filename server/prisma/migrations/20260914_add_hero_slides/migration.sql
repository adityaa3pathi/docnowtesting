-- CreateTable
CREATE TABLE "HeroSlide" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "badgeText" TEXT,
    "ctaText" TEXT NOT NULL DEFAULT 'Book a Test',
    "ctaLink" TEXT NOT NULL DEFAULT '/search',
    "secondaryCtaText" TEXT,
    "secondaryCtaLink" TEXT,
    "imageUrl" TEXT,
    "desktopImageUrl" TEXT,
    "desktopImageKey" TEXT,
    "mobileImageUrl" TEXT,
    "mobileImageKey" TEXT,
    "imageAlt" TEXT,
    "bgGradient" TEXT NOT NULL DEFAULT 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroSlide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeroSlide_isActive_sortOrder_idx" ON "HeroSlide"("isActive", "sortOrder");
