import { Router } from 'express';
import healthRoutes from './health.routes';
import emailRoutes from './email.routes';
import senderRoutes from './sender.routes';

const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/emails', emailRoutes);
apiRouter.use('/senders', senderRoutes);

export default apiRouter;

