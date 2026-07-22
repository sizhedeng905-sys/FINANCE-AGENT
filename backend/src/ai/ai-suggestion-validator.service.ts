import { BadGatewayException, Injectable } from '@nestjs/common';

import { StructuredOutputValidatorService } from '../model-runtime/structured-output-validator.service';
import {
  CLASSIFICATION_SUGGESTION_SCHEMA,
  ClassificationSuggestionOutput,
  MAPPING_ANOMALY_REVIEW_SCHEMA,
  MappingAnomalyReviewOutput,
  MAPPING_SUGGESTION_SCHEMA,
  MappingSuggestionOutput,
  REPORT_FACT_CHECK_SCHEMA,
  ReportFactCheckOutput,
  REPORT_NARRATIVE_SCHEMA,
  ReportNarrativeOutput,
  TEMPLATE_DRAFT_SCHEMA,
  TemplateDraftOutput,
  TRANSFORM_KEYS,
  UNMAPPED_FIELD_SUGGESTION_SCHEMA,
  UnmappedFieldSuggestionOutput
} from './ai-suggestion.schemas';

export interface ClassificationAllowlist {
  templateVersionIds: ReadonlySet<string>;
  evidenceRefs: ReadonlySet<string>;
}

export interface MappingAllowlist extends ClassificationAllowlist {
  fieldKeys: ReadonlySet<string>;
  allowRepeatedTargetFieldKeys?: ReadonlySet<string>;
  sourceRefs?: ReadonlySet<string>;
  requiredFieldKeys?: ReadonlySet<string>;
  transformKeysByField?: ReadonlyMap<string, ReadonlySet<string>>;
  evidenceRefsBySource?: ReadonlyMap<string, ReadonlySet<string>>;
  blockedSourceRefs?: ReadonlySet<string>;
  requireSourceEvidence?: boolean;
}

@Injectable()
export class AiSuggestionValidatorService {
  private readonly transformKeys = new Set<string>(TRANSFORM_KEYS);

  constructor(private readonly structuredOutput: StructuredOutputValidatorService) {}

  classification(text: string, allowlist: ClassificationAllowlist): ClassificationSuggestionOutput {
    const output = this.structuredOutput.parseAndValidate(CLASSIFICATION_SUGGESTION_SCHEMA, text);
    this.assertAllowedMany(output.candidateTemplateVersionIds, allowlist.templateVersionIds, 'template version');
    if (output.selectedTemplateVersionId !== null) {
      this.assertAllowed(output.selectedTemplateVersionId, allowlist.templateVersionIds, 'selected template version');
      if (!output.candidateTemplateVersionIds.includes(output.selectedTemplateVersionId)) {
        throw this.invalid('selected template version is not present in the candidate set');
      }
    }
    this.assertAllowedMany(output.evidenceRefs, allowlist.evidenceRefs, 'evidence reference');
    return output;
  }

  mapping(text: string, allowlist: MappingAllowlist): MappingSuggestionOutput {
    const output = this.structuredOutput.parseAndValidate(MAPPING_SUGGESTION_SCHEMA, text);
    this.assertAllowed(output.templateVersionId, allowlist.templateVersionIds, 'template version');
    const allowedSourceRefs = allowlist.sourceRefs ?? allowlist.evidenceRefs;
    this.assertAllowedMany(output.unmappedSourceRefs, allowedSourceRefs, 'unmapped source reference');
    this.assertAllowedMany(output.unresolvedRequiredFields, allowlist.fieldKeys, 'required field');

    const sourceRefs = new Set<string>();
    const targetFieldKeys = new Set<string>();
    for (const mapping of output.mappings) {
      this.assertAllowed(mapping.sourceRef, allowedSourceRefs, 'source reference');
      if (allowlist.blockedSourceRefs?.has(mapping.sourceRef)) {
        throw this.invalid(`blocked source reference cannot be mapped: ${mapping.sourceRef}`);
      }
      this.assertAllowed(mapping.targetFieldKey, allowlist.fieldKeys, 'target field');
      this.assertAllowed(mapping.transformKey, this.transformKeys, 'transform');
      const allowedTransforms = allowlist.transformKeysByField?.get(mapping.targetFieldKey);
      if (allowedTransforms) this.assertAllowed(mapping.transformKey, allowedTransforms, 'field transform');
      this.assertAllowedMany(mapping.evidenceRefs, allowlist.evidenceRefs, 'evidence reference');
      const sourceEvidence = allowlist.evidenceRefsBySource?.get(mapping.sourceRef);
      if (sourceEvidence) {
        this.assertAllowedMany(mapping.evidenceRefs, sourceEvidence, 'source-bound evidence reference');
      }
      if (allowlist.requireSourceEvidence && !mapping.evidenceRefs.includes(mapping.sourceRef)) {
        throw this.invalid(`source evidence is missing for: ${mapping.sourceRef}`);
      }
      if (sourceRefs.has(mapping.sourceRef)) throw this.invalid(`duplicate source reference: ${mapping.sourceRef}`);
      sourceRefs.add(mapping.sourceRef);
      if (
        targetFieldKeys.has(mapping.targetFieldKey) &&
        !allowlist.allowRepeatedTargetFieldKeys?.has(mapping.targetFieldKey)
      ) {
        throw this.invalid(`duplicate target field: ${mapping.targetFieldKey}`);
      }
      targetFieldKeys.add(mapping.targetFieldKey);
    }

    const overlapping = output.unmappedSourceRefs.find((sourceRef) => sourceRefs.has(sourceRef));
    if (overlapping) throw this.invalid(`source reference is both mapped and unmapped: ${overlapping}`);
    if (allowlist.sourceRefs) {
      const covered = new Set([...sourceRefs, ...output.unmappedSourceRefs]);
      for (const sourceRef of allowlist.sourceRefs) {
        if (!covered.has(sourceRef)) throw this.invalid(`mapping omitted source reference: ${sourceRef}`);
      }
      if (covered.size !== allowlist.sourceRefs.size) {
        throw this.invalid('mapping does not account for every source reference');
      }
    }
    if (allowlist.requiredFieldKeys) {
      const expectedUnresolved = new Set(
        [...allowlist.requiredFieldKeys].filter((fieldKey) => !targetFieldKeys.has(fieldKey))
      );
      const reportedUnresolved = new Set(output.unresolvedRequiredFields);
      if (reportedUnresolved.size !== expectedUnresolved.size) {
        throw this.invalid('unresolved required fields do not match server template facts');
      }
      for (const fieldKey of expectedUnresolved) {
        if (!reportedUnresolved.has(fieldKey)) {
          throw this.invalid(`missing unresolved required field: ${fieldKey}`);
        }
      }
    }
    return output;
  }

  reportNarrative(text: string, allowedSnapshotIds: ReadonlySet<string>): ReportNarrativeOutput {
    const output = this.structuredOutput.parseAndValidate(REPORT_NARRATIVE_SCHEMA, text);
    this.assertAllowed(output.snapshotId, allowedSnapshotIds, 'snapshot');
    const claimIds = new Set<string>();
    for (const claim of output.claims) {
      if (claimIds.has(claim.claimId)) throw this.invalid(`duplicate claim id: ${claim.claimId}`);
      claimIds.add(claim.claimId);
    }
    return output;
  }

  templateDraft(text: string, allowedFieldKeys: ReadonlySet<string>): TemplateDraftOutput {
    const output = this.structuredOutput.parseAndValidate(TEMPLATE_DRAFT_SCHEMA, text);
    this.assertAllowedMany(output.existingFieldKeys, allowedFieldKeys, 'existing field');
    return output;
  }

  anomalyReview(text: string, allowedEvidenceRefs: ReadonlySet<string>): MappingAnomalyReviewOutput {
    const output = this.structuredOutput.parseAndValidate(MAPPING_ANOMALY_REVIEW_SCHEMA, text);
    for (const issue of output.issues) {
      this.assertAllowedMany(issue.evidenceRefs, allowedEvidenceRefs, 'evidence reference');
    }
    return output;
  }

  unmappedFields(
    text: string,
    allowedEvidenceRefs: ReadonlySet<string>,
    allowedFieldKeys: ReadonlySet<string>
  ): UnmappedFieldSuggestionOutput {
    const output = this.structuredOutput.parseAndValidate(UNMAPPED_FIELD_SUGGESTION_SCHEMA, text);
    const sourceRefs = new Set<string>();
    for (const suggestion of output.suggestions) {
      this.assertAllowed(suggestion.sourceRef, allowedEvidenceRefs, 'source reference');
      this.assertAllowedMany(suggestion.candidateExistingFieldKeys, allowedFieldKeys, 'existing field');
      if (sourceRefs.has(suggestion.sourceRef)) throw this.invalid(`duplicate source reference: ${suggestion.sourceRef}`);
      sourceRefs.add(suggestion.sourceRef);
    }
    return output;
  }

  reportFactCheck(
    text: string,
    allowlist: {
      snapshotIds: ReadonlySet<string>;
      narrativeHashes: ReadonlySet<string>;
      claimIds: ReadonlySet<string>;
      sourcePaths: ReadonlySet<string>;
    }
  ): ReportFactCheckOutput {
    const output = this.structuredOutput.parseAndValidate(REPORT_FACT_CHECK_SCHEMA, text);
    this.assertAllowed(output.snapshotId, allowlist.snapshotIds, 'snapshot');
    this.assertAllowed(output.narrativeHash, allowlist.narrativeHashes, 'narrative hash');
    for (const issue of output.issues) {
      this.assertAllowed(issue.claimId, allowlist.claimIds, 'claim');
      this.assertAllowed(issue.sourcePath, allowlist.sourcePaths, 'source path');
    }
    return output;
  }

  private assertAllowedMany(values: readonly string[], allowlist: ReadonlySet<string>, kind: string) {
    for (const value of values) this.assertAllowed(value, allowlist, kind);
  }

  private assertAllowed(value: string, allowlist: ReadonlySet<string>, kind: string) {
    if (!allowlist.has(value)) throw this.invalid(`unauthorized ${kind}: ${value}`);
  }

  private invalid(reason: string) {
    return new BadGatewayException(`AI suggestion rejected: ${reason}`);
  }
}
