export type RegisterInput = {
  name: string;
  email: string;
  password: string;
  phone?: string;
  branchId: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};
