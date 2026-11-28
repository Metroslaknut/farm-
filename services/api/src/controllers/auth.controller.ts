import type { RequestHandler } from 'express';
import type { MyAccessResponse } from '@farmplus/shared-types';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  mfaVerifySchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailConfirmSchema,
  verifyPhoneConfirmSchema,
} from '@farmplus/validation';
import { notFound, unauthorized } from '../lib/errors';
import { parse, requestMeta, requireActor } from '../lib/http';
import { parseObjectId } from '../lib/object-id';
import { Session, User } from '../models';
import type { AuthService } from '../services/auth.service';
import { listSessions, revokeSession } from '../services/session.service';
import { roleKeysByUser, toPublicUser } from '../services/user.service';

export function authController(auth: AuthService) {
  const currentUser = async (req: Parameters<RequestHandler>[0]) => {
    const user = await User.findById(requireActor(req).userId);
    if (!user) throw unauthorized();
    return user;
  };

  const handlers = {
    register: (async (req, res) => {
      const user = await auth.register(parse(registerSchema, req.body), requestMeta(req));
      res.status(201).json({ user });
    }) satisfies RequestHandler,

    login: (async (req, res) => {
      res.json(await auth.login(parse(loginSchema, req.body), requestMeta(req)));
    }) satisfies RequestHandler,

    mfaVerify: (async (req, res) => {
      const body = parse(mfaVerifySchema, req.body);
      res.json(await auth.completeMfaLogin(body.mfaToken, body.code, requestMeta(req)));
    }) satisfies RequestHandler,

    refresh: (async (req, res) => {
      const { refreshToken } = parse(refreshSchema, req.body);
      res.json({ tokens: await auth.refresh(refreshToken, requestMeta(req)) });
    }) satisfies RequestHandler,

    logout: (async (req, res) => {
      await auth.logout(requireActor(req));
      res.status(204).end();
    }) satisfies RequestHandler,

    sessionHandoff: (async (req, res) => {
      res
        .status(201)
        .json({ tokens: await auth.handoffSession(requireActor(req), requestMeta(req)) });
    }) satisfies RequestHandler,

    logoutAll: (async (req, res) => {
      await auth.logoutAll(requireActor(req));
      res.status(204).end();
    }) satisfies RequestHandler,

    me: (async (req, res) => {
      const actor = requireActor(req);
      // The user and their role keys are independent reads: fetch them together.
      const [user, roleKeys] = await Promise.all([
        currentUser(req),
        roleKeysByUser([parseObjectId(actor.userId)]),
      ]);
      const body: MyAccessResponse = {
        user: toPublicUser(user, roleKeys.get(String(user._id)) ?? []),
        permissions: [...actor.access.permissions].sort(),
        mfaRequired: actor.access.withheld.size > 0,
      };
      res.json(body);
    }) satisfies RequestHandler,

    sessions: (async (req, res) => {
      const actor = requireActor(req);
      res.json({ sessions: await listSessions(parseObjectId(actor.userId), actor.sessionId) });
    }) satisfies RequestHandler,

    revokeSession: (async (req, res) => {
      const actor = requireActor(req);
      const id = parseObjectId(req.params['id']);
      // Ownership: a session can only be revoked by the user it belongs to.
      const session = await Session.findOne({ _id: id, userId: actor.userId, revokedAt: null });
      if (!session) throw notFound('Session not found');
      await revokeSession(id, 'revoked_by_user');
      res.status(204).end();
    }) satisfies RequestHandler,

    forgotPassword: (async (req, res) => {
      await auth.forgotPassword(parse(forgotPasswordSchema, req.body).identifier);
      res.status(202).json({ message: 'If the account exists, reset instructions have been sent' });
    }) satisfies RequestHandler,

    resetPassword: (async (req, res) => {
      const body = parse(resetPasswordSchema, req.body);
      await auth.resetPassword(body.token, body.newPassword, requestMeta(req));
      res.status(204).end();
    }) satisfies RequestHandler,

    changePassword: (async (req, res) => {
      const body = parse(changePasswordSchema, req.body);
      await auth.changePassword(
        await currentUser(req),
        requireActor(req),
        body.currentPassword,
        body.newPassword,
      );
      res.status(204).end();
    }) satisfies RequestHandler,

    resendVerification: (async (req, res) => {
      await auth.resendVerification(parse(resendVerificationSchema, req.body).identifier);
      res.status(202).json({ message: 'If verification is pending, a new code has been sent' });
    }) satisfies RequestHandler,

    verifyEmail: (async (req, res) => {
      await auth.verification.confirmEmail(parse(verifyEmailConfirmSchema, req.body).token);
      res.status(204).end();
    }) satisfies RequestHandler,

    verifyPhone: (async (req, res) => {
      const body = parse(verifyPhoneConfirmSchema, req.body);
      await auth.verification.confirmPhone(body.phone, body.code);
      res.status(204).end();
    }) satisfies RequestHandler,

    mfaSetup: (async (req, res) => {
      res.json(await auth.mfa.setup(await currentUser(req)));
    }) satisfies RequestHandler,

    mfaEnable: (async (req, res) => {
      const { code } = parse(mfaCodeSchema, req.body);
      res.json(await auth.mfa.enable(await currentUser(req), code, requireActor(req)));
    }) satisfies RequestHandler,

    mfaDisable: (async (req, res) => {
      const body = parse(mfaDisableSchema, req.body);
      await auth.mfa.disable(await currentUser(req), body.password, body.code, requireActor(req));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
  return handlers;
}
