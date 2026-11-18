import { Router } from 'express';
import type { AppContext } from '../context';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { rateLimits } from '../middleware/rate-limit';
import type { AuthService } from '../services/auth.service';

export function authRouter(ctx: AppContext, auth: AuthService): Router {
  const router = Router();
  const c = authController(auth);
  const limit = rateLimits(ctx.env);
  const requireAuth = authenticate(ctx);

  // Credentials and tokens must never be cached by browsers or proxies.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', limit.register, c.register);
  router.post('/login', limit.login, c.login);
  router.post('/mfa/verify', limit.mfa, c.mfaVerify);
  router.post('/refresh', limit.refresh, c.refresh);

  router.post('/password/forgot', limit.sensitive, c.forgotPassword);
  router.post('/password/reset', limit.sensitive, c.resetPassword);
  router.post('/verify/resend', limit.sensitive, c.resendVerification);
  router.post('/verify/email', limit.sensitive, c.verifyEmail);
  router.post('/verify/phone', limit.mfa, c.verifyPhone);

  router.use(requireAuth);
  router.get('/me', c.me);
  router.post('/logout', c.logout);
  router.post('/logout-all', c.logoutAll);
  router.get('/sessions', c.sessions);
  router.delete('/sessions/:id', c.revokeSession);
  router.post('/password/change', limit.sensitive, c.changePassword);
  router.post('/mfa/setup', limit.sensitive, c.mfaSetup);
  router.post('/mfa/enable', limit.mfa, c.mfaEnable);
  router.post('/mfa/disable', limit.mfa, c.mfaDisable);
  return router;
}
