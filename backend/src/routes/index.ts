import { Router } from 'express';
import healthRoutes from './health.routes';
import emailRoutes from './email.routes';

const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/emails', emailRoutes);

export default apiRouter;

