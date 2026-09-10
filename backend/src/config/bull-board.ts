import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from '../services/queue.service';

export const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: bullBoardAdapter,
});
