import { BadRequestException } from '@nestjs/common';
import {
  AccountingDirection,
  DataRecordType,
  Prisma,
  RecordDataLayer,
  RecordSourceType
} from '@prisma/client';

import {
  FINANCIAL_POLICY_BASELINE,
  financialPolicySnapshot,
  H02_POLICY_PENDING_REASON
} from '../src/record-policy/financial-policy-baseline';
import { RecordPolicyService } from '../src/record-policy/record-policy.service';

describe('pending financial policy baseline', () => {
  const service = new RecordPolicyService();

  it('keeps H01, H02 and H07 pending with automatic financial actions disabled', () => {
    expect(FINANCIAL_POLICY_BASELINE).toMatchObject({
      schemaVersion: 'financial-policy-baseline/1.0',
      decisions: {
        H01: {
          status: 'pending_human_decision',
          automaticGranularitySelection: false,
          summaryDetailMutualExclusion: 'not_configured'
        },
        H02: {
          status: 'pending_human_decision',
          formalAmountSign: 'positive_only',
          automaticReversal: false,
          correctionRelation: 'not_configured',
          periodClose: 'not_configured',
          voidBehavior: 'soft_status_only'
        },
        H07: {
          status: 'pending_human_decision',
          attachmentRole: 'controlled_evidence_only',
          attachmentAsMasterData: false,
          ocrAutomaticCommit: false
        }
      }
    });
  });

  it('rejects zero and negative formal amounts without calling soft void a reversal', () => {
    expect(() => service.parseMoney('-1.00')).toThrow(/H02/);

    try {
      service.assertFormalAmountAllowed(new Prisma.Decimal('0.00'));
      throw new Error('expected zero amount to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();
      expect(response).toMatchObject({
        message: expect.stringContaining('H02'),
        data: {
          reason: H02_POLICY_PENDING_REASON,
          decisionId: 'H02',
          policyVersion: 'financial-policy-baseline/1.0'
        }
      });
      expect(JSON.stringify(response)).not.toContain('冲销请使用显式作废流程');
    }
  });

  it('freezes pending decision references into template and confirmation snapshots', () => {
    const template = {
      id: 'template-policy-test',
      name: '合成政策测试模板',
      recordType: DataRecordType.cost,
      accountingDirection: AccountingDirection.expense,
      dataLayer: RecordDataLayer.actual,
      primaryAmountFieldId: null,
      primaryDateFieldId: null,
      version: 1,
      description: null,
      isSystem: false,
      createdBy: 'test',
      createdAt: new Date('2026-07-18T00:00:00.000Z'),
      updatedAt: new Date('2026-07-18T00:00:00.000Z'),
      templateFields: []
    } as Parameters<RecordPolicyService['toSnapshot']>[0];
    const expectedPolicy = financialPolicySnapshot();

    expect(service.toSnapshot(template)).toMatchObject({ financialPolicy: expectedPolicy });
    expect(service.toConfirmationSnapshot(
      template,
      {
        amount: new Prisma.Decimal('1.00'),
        recordDate: new Date('2026-07-18T00:00:00.000Z'),
        accountingDirection: AccountingDirection.expense,
        category: '成本'
      },
      [],
      {
        projectId: 'project-policy-test',
        sourceType: RecordSourceType.manual,
        sourceId: 'manual',
        confirmedAt: new Date('2026-07-18T01:00:00.000Z'),
        confirmedBy: 'finance'
      }
    )).toMatchObject({ financialPolicy: expectedPolicy });
  });
});
