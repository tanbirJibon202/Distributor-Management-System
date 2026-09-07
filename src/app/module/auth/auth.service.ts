import type { RequestUser } from '../../middleware/checkAuth.js';
import { Role } from '../../../generated/prisma/client.js';
import bcrypt from 'bcryptjs';
import type { LoginTicket } from 'google-auth-library';
import httpStatus from 'http-status';
import config from '../../config/index.js';
import { googleClient } from '../../lib/googleAuth.js';
import { sendEmail, sendEmailSafely } from '../../lib/mailer.js';
import {
  OTP_TTL_MINUTES,
  OTP_TTL_SECONDS,
  generateOtp,
  storeOtp,
  verifyOtp,
} from '../../lib/otp.js';
import { prisma } from '../../lib/prisma.js';
import { redisClient } from '../../lib/redis.js';
import { AppError } from '../../utils/AppError.js';
import { createAuditLog } from '../audit/audit.service.js';
import {
  type JwtPayload,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt.js';
import type { AuthTokens, LoginInput, RegisterInput } from './auth.interface.js';

const BCRYPT_ROUNDS = 12;

const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  branchId: true,
  imageUrl: true,
  createdAt: true,
} as const;

const issueTokens = (user: {
  id: string;
  email: string;
  role: Role;
  branchId: string | null;
  tokenVersion: number;
}): AuthTokens => {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    tokenVersion: user.tokenVersion,
  };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
};

const REGISTRATION_PURPOSE = 'registration';
const REGISTRATION_DATA_TTL_SECONDS = OTP_TTL_SECONDS;

const registrationKey = (email: string) => `registration:${email}`;

type StagedRegistration = {
  name: string;
  email: string;
  password: string;
  phone?: string;
  branchId: string;
  authorizedBy: string;
};

/**
 * Stages a registration and emails a code. No user row is written here.
 *
 * Holding the pending signup in Redis rather than creating an unverified row
 * means an abandoned or fraudulent registration leaves nothing behind: no
 * half-built account occupying the email address, and no cleanup job to delete
 * them later. The address only becomes taken once someone proves they own it.
 */
const registerUser = async (actor: RequestUser, input: RegisterInput) => {
  if (
    actor.role !== Role.SUPER_ADMIN &&
    (actor.role !== Role.BRANCH_MANAGER || actor.branchId !== input.branchId)
  ) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      'Only an admin or the branch manager can register staff',
    );
  }
  const email = input.email.trim().toLowerCase();

  const branch = await prisma.branch.findFirst({
    where: { id: input.branchId, deletedAt: null },
  });
  if (!branch) {
    throw new AppError(httpStatus.NOT_FOUND, 'Branch not found');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, 'A user with this email already exists');
  }

  // Hashed before it is stored, not after: the staged payload lives in Redis
  // for five minutes, and a plaintext password does not belong there.
  const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const staged: StagedRegistration = {
    name: input.name,
    email,
    password: hashedPassword,
    phone: input.phone,
    branchId: input.branchId,
    authorizedBy: actor.userId,
  };

  const reserved = await redisClient.set(registrationKey(email), JSON.stringify(staged), {
    EX: REGISTRATION_DATA_TTL_SECONDS,
    NX: true,
  });
  if (!reserved)
    throw new AppError(
      httpStatus.CONFLICT,
      'Registration is already pending; resend the existing code',
    );

  const otp = generateOtp();
  await storeOtp(REGISTRATION_PURPOSE, email, otp);

  await sendEmail({
    to: email,
    subject: 'Verify your DMS account',
    template: 'registration-otp',
    data: { name: input.name, otp, expirationMinutes: OTP_TTL_MINUTES },
  });

  return {
    message: 'Verification code sent. Enter it to finish creating your account.',
    email,
  };
};

/** Consumes the code, creates the user, and signs them straight in. */
const verifyEmail = async (input: { email: string; otp: string }, ipAddress?: string | null) => {
  const email = input.email.trim().toLowerCase();

  const raw = await redisClient.get(registrationKey(email));
  if (!raw) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'This registration has expired. Please sign up again.',
    );
  }

  await verifyOtp(REGISTRATION_PURPOSE, email, input.otp);

  const staged = JSON.parse(raw) as StagedRegistration;

  // Re-checked after the wait: someone else may have taken this address, or
  // the branch been deleted, during the five minutes the code was valid.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await redisClient.del(registrationKey(email));
    throw new AppError(httpStatus.CONFLICT, 'A user with this email already exists');
  }

  const branch = await prisma.branch.findFirst({
    where: { id: staged.branchId, deletedAt: null },
  });
  if (!branch) {
    throw new AppError(httpStatus.NOT_FOUND, 'Branch not found');
  }

  const user = await prisma.$transaction(async (tx) => {
    const sponsor = staged.authorizedBy
      ? await tx.user.findFirst({
          where: { id: staged.authorizedBy, deletedAt: null },
          select: { role: true, branchId: true },
        })
      : null;
    if (
      !sponsor ||
      (sponsor.role !== Role.SUPER_ADMIN &&
        (sponsor.role !== Role.BRANCH_MANAGER || sponsor.branchId !== staged.branchId))
    ) {
      throw new AppError(httpStatus.FORBIDDEN, 'Staff registration approval is no longer valid');
    }
    const created = await tx.user.create({
      data: {
        name: staged.name,
        email: staged.email,
        password: staged.password,
        phone: staged.phone,
        role: Role.FIELD_SR,
        branchId: staged.branchId,
      },
      select: { ...userPublicSelect, tokenVersion: true },
    });

    await createAuditLog(tx, {
      userId: created.id,
      action: 'USER_REGISTER',
      entity: 'User',
      entityId: created.id,
      details: {
        email: created.email,
        branchId: staged.branchId,
        authorizedBy: staged.authorizedBy,
      },
      ipAddress,
    });

    return created;
  });

  await redisClient.del(registrationKey(email));

  const tokens = issueTokens({ ...user, branchId: user.branchId });
  const { tokenVersion: _version, ...safeUser } = user;
  return { user: safeUser, ...tokens };
};

/** Issues a fresh code for a registration that is still staged. */
const resendRegistrationOtp = async (rawEmail: string) => {
  const email = rawEmail.trim().toLowerCase();

  const raw = await redisClient.get(registrationKey(email));
  if (!raw) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'No pending registration for that email. Please sign up again.',
    );
  }

  const staged = JSON.parse(raw) as StagedRegistration;

  // Refreshed alongside the code, so a resend does not leave the payload
  // expiring before the code it belongs to.
  await redisClient.expire(registrationKey(email), REGISTRATION_DATA_TTL_SECONDS);

  const otp = generateOtp();
  await storeOtp(REGISTRATION_PURPOSE, email, otp);

  await sendEmail({
    to: email,
    subject: 'Verify your DMS account',
    template: 'registration-otp',
    data: { name: staged.name, otp, expirationMinutes: OTP_TTL_MINUTES },
  });

  return { message: 'A new verification code is on its way.', email };
};

const loginUser = async (input: LoginInput) => {
  // Normalised the same way registration stores it. Without this, an address
  // typed with different capitalisation than at signup simply fails to match,
  // and the user is told their password is wrong.
  const user = await prisma.user.findFirst({
    where: { email: input.email.trim().toLowerCase(), deletedAt: null },
  });
  if (!user || !user.password) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
  }

  const passwordMatches = await bcrypt.compare(input.password, user.password);
  if (!passwordMatches) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
  }

  const tokens = issueTokens(user);
  const { password: _password, tokenVersion: _version, ...safeUser } = user;
  return { user: safeUser, ...tokens };
};

const refreshAccessToken = async (token: string) => {
  let decoded: JwtPayload;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid or expired refresh token');
  }

  const user = await prisma.user.findFirst({
    where: { id: decoded.userId, deletedAt: null },
  });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'User no longer exists');
  }

  if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Session revoked; please log in again');
  }

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    tokenVersion: user.tokenVersion,
  });

  return { accessToken };
};

const googleAuth = async (idToken: string) => {
  if (!googleClient) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Google login is not configured');
  }

  // google-auth-library throws its own Error for a malformed, expired or
  // wrong-audience token. Left uncaught it is not an AppError, so the global
  // handler reports 500 — telling the caller the server broke when in fact
  // they sent a bad token, and burying real faults in the same signal.
  let ticket: LoginTicket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.google_client_id,
    });
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Google token');
  }

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified || !payload.sub) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Google token');
  }

  let user = await prisma.user.findFirst({
    where: { email: payload.email.trim().toLowerCase(), deletedAt: null },
  });

  if (!user) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      'Ask your admin or branch manager to register your staff account first',
    );
  }
  if (user.googleId && user.googleId !== payload.sub) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      'Google account does not match the linked staff account',
    );
  }
  if (!user.googleId) {
    // Conditional linking prevents two concurrent identities overwriting a link.
    const linked = await prisma.user.updateMany({
      where: { id: user.id, googleId: null, deletedAt: null },
      data: { googleId: payload.sub },
    });
    if (!linked.count)
      throw new AppError(httpStatus.CONFLICT, 'Google account link changed; retry login');
    user = { ...user, googleId: payload.sub };
  }

  const tokens = issueTokens(user);
  const { password: _password, tokenVersion: _version, ...safeUser } = user;
  return { user: safeUser, ...tokens };
};

const getMe = async (userId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { ...userPublicSelect, branch: { select: { id: true, name: true, code: true } } },
  });
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }
  return user;
};

const FORGOT_PASSWORD_PURPOSE = 'forgot-password';

const forgotPassword = async (email: string) => {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), deletedAt: null },
  });

  // Always the same answer, whether or not the address exists. Confirming which
  // emails have accounts turns this endpoint into a user-enumeration oracle,
  // and an attacker learns nothing from a uniform response.
  const genericResponse = {
    message: 'If an account exists for that email, a reset code is on its way.',
  };

  if (!user) return genericResponse;

  // A Google-only account has no password to reset; sending a code would let
  // someone set one and bypass Google sign-in entirely.
  if (!user.password && user.googleId) return genericResponse;

  const otp = generateOtp();
  await storeOtp(FORGOT_PASSWORD_PURPOSE, user.email, otp);

  await sendEmail({
    to: user.email,
    subject: 'Reset your DMS password',
    template: 'forgot-password',
    data: { name: user.name, otp, expirationMinutes: OTP_TTL_MINUTES },
  });

  return genericResponse;
};

const resetPassword = async (
  input: { email: string; otp: string; newPassword: string },
  ipAddress?: string | null,
) => {
  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
  if (!user) {
    throw new AppError(httpStatus.BAD_REQUEST, 'This code has expired. Request a new one.');
  }

  // Throws on a wrong or expired code, and consumes the code on success.
  await verifyOtp(FORGOT_PASSWORD_PURPOSE, email, input.otp);

  const hashedPassword = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, tokenVersion: { increment: 1 } },
    });

    await createAuditLog(tx, {
      // The user is acting on their own account, so they are the actor.
      userId: user.id,
      action: 'PASSWORD_RESET',
      entity: 'User',
      entityId: user.id,
      details: { email: user.email },
      ipAddress,
    });
  });

  // Outside the transaction, and failure-tolerant: the password is already
  // changed, so a mail server hiccup must not report the reset as failed.
  await sendEmailSafely({
    to: user.email,
    subject: 'Your DMS password was changed',
    template: 'reset-password-success',
    data: {
      name: user.name,
      changedAt: new Date().toUTCString(),
    },
  });

  return { message: 'Password reset successfully. You can now sign in.' };
};

const logout = async (userId: string) => {
  // Logout revokes every session for this account, including copied bearer and refresh tokens.
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
};

export const AuthService = {
  logout,
  registerUser,
  verifyEmail,
  resendRegistrationOtp,
  loginUser,
  refreshAccessToken,
  googleAuth,
  getMe,
  forgotPassword,
  resetPassword,
};
