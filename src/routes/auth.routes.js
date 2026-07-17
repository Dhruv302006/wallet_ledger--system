import * as authController from '../controllers/auth.controller.js';

export default async function authRoutes(fastify, options) {
  fastify.post('/register', authController.register);
  fastify.post('/login', authController.login);
  fastify.post('/refresh', authController.refresh);
  fastify.post('/logout', authController.logout);
}
