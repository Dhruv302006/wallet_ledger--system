import * as walletController from '../controllers/wallet.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

export default async function walletRoutes(fastify, options) {
  // Apply JWT authentication pre-handler to all routes in this plugin
  fastify.addHook('preHandler', authenticateJWT);

  fastify.get('/balance', { logLevel: 'warn' }, walletController.getBalance);
  fastify.get('/history', { logLevel: 'warn' }, walletController.getHistory);
  fastify.post('/deposit', walletController.depositFunds);
  fastify.post('/transfer', walletController.transferFunds);
}
