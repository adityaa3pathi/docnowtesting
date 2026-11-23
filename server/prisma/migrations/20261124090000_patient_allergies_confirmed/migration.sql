-- When the allergies were last confirmed: an empty list with a date means "no known allergies",
-- an empty list without one means nobody has asked yet.
ALTER TABLE "Patient" ADD COLUMN "allergiesConfirmedAt" TIMESTAMP(3);
