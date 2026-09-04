import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../utils/prisma.js';
import { AppError } from '../../utils/AppError.js';
import config from '../../config/index.js';
import { Role } from '../../generated/prisma/index.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import type { AuthTokens, LoginInput, RegisterInput } from './auth.interface.js';

const BCRYPT_ROUNDS = 12;

const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  branchId: true,
  createdAt: true,
} as const;

const issueTokens = (user: { id: string; email: string; role: Role; branchId: string | null }): AuthTokens => {
  const payload = { id: user.id, email: user.email, role: user.role, branchId: user.branchId };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
};

const registerUser = async (input: RegisterInput) => {
  const branch = await prisma.branch.findFirst({
    where: { id: input.branchId, deletedAt: null },
  });
  if (!branch) {
    throw new AppError(httpStatus.NOT_FOUND, 'Branch not found');
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, 'A user with this email already exists');
  }

  const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: hashedPassword,
      phone: input.phone,
      role: Role.FIELD_SR,
      branchId: input.branchId,
    },
    select: userPublicSelect,
  });

  const tokens = issueTokens(user);
  return { user, ...tokens };
};

const loginUser = async (input: LoginInput) => {
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
  });
  if (!user || !user.password) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
  }

  const passwordMatches = await bcrypt.compare(input.password, user.password);
  if (!passwordMatches) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
  }

  const tokens = issueTokens(user);
  const { password: _password, ...safeUser } = user;
  return { user: safeUser, ...tokens };
};

const refreshAccessToken = async (token: string) => {
  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid or expired refresh token');
  }

  const user = await prisma.user.findFirst({
    where: { id: decoded.id, deletedAt: null },
  });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'User no longer exists');
  }

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
  });

  return { accessToken };
};

const googleClient = config.google_client_id ? new OAuth2Client(config.google_client_id) : null;

const googleAuth = async (idToken: string) => {
  if (!googleClient) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Google login is not configured');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.google_client_id,
  });
  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Google token');
  }

  let user = await prisma.user.findFirst({
    where: { email: payload.email, deletedAt: null },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: payload.name ?? payload.email,
        email: payload.email,
        password: null,
        googleId: payload.sub,
        role: Role.FIELD_SR,
        branchId: null,
      },
    });
  } else if (!user.googleId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId: payload.sub },
    });
  }

  const tokens = issueTokens(user);
  const { password: _password, ...safeUser } = user;
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

export const AuthService = { registerUser, loginUser, refreshAccessToken, googleAuth, getMe };
