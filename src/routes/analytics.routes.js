import * as analyticsController from '../controllers/analytics.controller.js';

export default async function analyticsRoutes(fastify, options) {
  fastify.get('/metrics', { logLevel: 'warn' }, analyticsController.getMetrics);
}
