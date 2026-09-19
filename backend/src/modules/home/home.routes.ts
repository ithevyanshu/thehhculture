import { Router } from 'express';
import { optionalAuth } from '../../middleware/auth';
import { buildHome } from './home.service';

export const homeRouter = Router();

homeRouter.get('/', optionalAuth, async (req, res) => {
  res.json(await buildHome(req.user?.id));
});
