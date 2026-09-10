import { Router } from 'express';
import healthRoutes from './health.routes';
import emailRoutes from './email.routes';
import senderRoutes from './sender.routes';
import slackRoutes from './slack.routes';

const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/emails', emailRoutes);
apiRouter.use('/senders', senderRoutes);
apiRouter.use('/slack', slackRoutes);

export default apiRouter;

