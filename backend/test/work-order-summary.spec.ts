import { RiskLevel, UserRole, WorkOrderStatus } from '@prisma/client';

import { WorkOrdersService } from '../src/work-orders/work-orders.service';

describe('work-order summary', () => {
  it('uses database-wide groups while preserving the token-derived role scope', async () => {
    const groupBy = jest.fn(async () => [{
      status: WorkOrderStatus.finance_reviewing,
      riskLevel: RiskLevel.high,
      _count: { _all: 125 }
    }]);
    const service = new WorkOrdersService(
      { workOrder: { groupBy } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    const employeeSummary = await service.summary({ id: 'employee-a', role: UserRole.employee } as any);
    expect(groupBy).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { creatorId: 'employee-a' }
    }));
    expect(employeeSummary).toMatchObject({
      total: 125,
      byStatus: { finance_reviewing: 125 },
      byRisk: { high: 125 },
      byStatusAndRisk: { finance_reviewing: { high: 125 } }
    });

    await service.summary({ id: 'reviewer-a', role: UserRole.reviewer } as any);
    expect(groupBy).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { status: { in: expect.arrayContaining([WorkOrderStatus.reviewer_reviewing]) } }
    }));
  });
});
