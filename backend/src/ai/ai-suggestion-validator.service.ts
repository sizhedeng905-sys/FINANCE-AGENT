import { BadGatewayException, Injectable } from '@nestjs/common';

import { StructuredOutputValidatorService } from '../model-runtime/structured-output-validator.service';
import {
  CLASSIFICATION_SUGGESTION_SCHEMA,
  ClassificationSuggestionOutput,
  MAPPING_SUGGESTION_SCHEMA,
  MappingSuggestionOutput,
  REPORT_NARRATIVE_SCHEMA,
  ReportNarrativeOutput,
  TRANSFORM_KEYS
} from './ai-suggestion.schemas';

export interface ClassificationAllowlist {
  templateVersionIds: ReadonlySet<string>;
  evidenceRefs: ReadonlySet<string>;
}

export interface MappingAllowlist extends ClassificationAllowlist {
  fieldKeys: ReadonlySet<string>;
  allowRepeatedTargetFieldKeys?: ReadonlySet<string>;
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
    this.assertAllowedMany(output.unmappedSourceRefs, allowlist.evidenceRefs, 'unmapped source reference');
    this.assertAllowedMany(output.unresolvedRequiredFields, allowlist.fieldKeys, 'required field');

    const sourceRefs = new Set<string>();
    const targetFieldKeys = new Set<string>();
    for (const mapping of output.mappings) {
      this.assertAllowed(mapping.sourceRef, allowlist.evidenceRefs, 'source reference');
      this.assertAllowed(mapping.targetFieldKey, allowlist.fieldKeys, 'target field');
      this.assertAllowed(mapping.transformKey, this.transformKeys, 'transform');
      this.assertAllowedMany(mapping.evidenceRefs, allowlist.evidenceRefs, 'evidence reference');
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
