ALTER TABLE "ocr_corrections"
DROP CONSTRAINT "ocr_corrections_override_type_check";

ALTER TABLE "ocr_corrections"
ADD CONSTRAINT "ocr_corrections_override_type_check"
CHECK (
  "override_type" IN (
    'MANUAL_OVERRIDE',
    'AI_ACCEPT',
    'AI_EDIT',
    'AI_REJECT',
    'AI_IGNORE'
  )
);
