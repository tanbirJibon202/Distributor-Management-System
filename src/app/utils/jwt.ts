import type { Role } from '../../generated/prisma/client.js';
import jwt, { type SignOptions } from 'jsonwebtoken';
import config from '../config/index.js';

export type JwtPayload = {
  userId: string;
  email: string;
  role: Role;
  branchId: string | null;
  tokenVersion?: number;
};

export const signAccessToken = (payload: JwtPayload) =>
  jwt.sign(payload, config.jwt_access_secret, {
    expiresIn: config.jwt_access_expires_in,
  } as SignOptions);

export const signRefreshToken = (payload: JwtPayload) =>
  jwt.sign(payload, config.jwt_refresh_secret, {
    expiresIn: config.jwt_refresh_expires_in,
  } as SignOptions);

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, config.jwt_access_secret) as JwtPayload;

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, config.jwt_refresh_secret) as JwtPayload;
