DROP INDEX "report_narratives_snapshot_id_narrative_hash_key";

CREATE UNIQUE INDEX "report_narratives_snapshot_id_narrative_hash_version_vector_hash_key"
  ON "report_narratives"("snapshot_id", "narrative_hash", "version_vector_hash");
