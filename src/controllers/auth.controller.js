import * as authService from '../services/auth.service.js';

const isProduction = process.env.NODE_ENV === 'production';

const cookieOptions = {
  path: '/',
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
};

/**
 * Controller endpoint to handle user registration.
 * Validates request body, calls registration service, and returns user/wallet details.
 */
export const register = async (request, reply) => {
  const { email, password } = request.body;
  
  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }
  
  try {
    const { user, wallet } = await authService.registerUser(email, password);
    return reply.status(201).send({ message: 'Registration successful', user, wallet });
  } catch (error) {
    return reply.status(400).send({ error: error.message });
  }
};

/**
 * Controller endpoint to handle user login.
 * Authenticates user, creates session tokens, sets them in secure HTTP-only cookies,
 * and returns user/wallet meta alongside the access token.
 */
export const login = async (request, reply) => {
  const { email, password } = request.body;
  
  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }
  
  try {
    const { user, wallet, accessToken, refreshToken } = await authService.loginUser(email, password);
    
    // Set HTTP-only cookies
    reply.setCookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60, // 15 mins
    });
    
    reply.setCookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
    
    return reply.send({ user, wallet, accessToken });
  } catch (error) {
    return reply.status(401).send({ error: error.message });
  }
};

/**
 * Controller endpoint to refresh expired access tokens.
 * Validates the refresh token (from cookies or body), rotates token pairs,
 * sets new secure cookies, and returns the fresh access token.
 */
export const refresh = async (request, reply) => {
  const oldRefreshToken = request.cookies.refreshToken || request.body?.refreshToken;
  
  if (!oldRefreshToken) {
    return reply.status(400).send({ error: 'Refresh token is required' });
  }
  
  try {
    const { accessToken, refreshToken } = await authService.refreshSession(oldRefreshToken);
    
    reply.setCookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60,
    });
    
    reply.setCookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60,
    });
    
    return reply.send({ accessToken });
  } catch (error) {
    // Clear cookies on auth refresh failure
    reply.clearCookie('accessToken', cookieOptions);
    reply.clearCookie('refreshToken', cookieOptions);
    return reply.status(401).send({ error: error.message });
  }
};

/**
 * Controller endpoint to handle session logouts.
 * Revokes the active refresh token in the database and clears the browser cookies.
 */
export const logout = async (request, reply) => {
  const refreshToken = request.cookies.refreshToken || request.body?.refreshToken;
  
  if (refreshToken) {
    try {
      await authService.logoutSession(refreshToken);
    } catch (error) {
      // Log error but proceed to clear cookies
      request.log.error(error);
    }
  }
  
  reply.clearCookie('accessToken', cookieOptions);
  reply.clearCookie('refreshToken', cookieOptions);
  
  return reply.send({ message: 'Logged out successfully' });
};
