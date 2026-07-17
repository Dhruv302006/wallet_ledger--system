import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt';

/**
 * Fastify preHandler hook to authenticate requests using JWT tokens.
 * Extracts the token from either the Authorization header (Bearer <token>)
 * or the secure HTTP-only accessToken cookie. Decodes and binds the user object to request.user.
 */
export const authenticateJWT = async (request, reply) => {
  try {
    let token = null;

    // Check auth header
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // Check cookies
    if (!token && request.cookies) {
      token = request.cookies.accessToken;
    }

    if (!token) {
      reply.status(401).send({ error: 'Authentication required' });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    request.user = decoded;
  } catch (error) {
    reply.status(401).send({ error: 'Invalid or expired access token' });
  }
};
