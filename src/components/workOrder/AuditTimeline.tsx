import { Timeline, Typography } from 'antd';
import type { TimelineItem } from '@/types/workOrder';
import { roleLabelMap } from '@/utils/statusMap';

export default function AuditTimeline({ timeline }: { timeline: TimelineItem[] }) {
  return (
    <Timeline
      items={timeline.map((item) => ({
        children: (
          <>
            <Typography.Text strong>
              {item.time} · {item.operator}
              {item.role in roleLabelMap ? `（${roleLabelMap[item.role as keyof typeof roleLabelMap]}）` : ''}
            </Typography.Text>
            <br />
            <Typography.Text>{item.action}</Typography.Text>
            <br />
            <Typography.Text type="secondary">{item.comment}</Typography.Text>
          </>
        ),
      }))}
    />
  );
}
