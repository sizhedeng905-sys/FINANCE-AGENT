CREATE OR REPLACE FUNCTION "prevent_report_audit_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_report_audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'immutable report audit rows cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;
