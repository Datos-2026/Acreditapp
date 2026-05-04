import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../middlewares/error-handler";

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export async function login(email: string, password: string): Promise<{ tokens: AuthTokens; userId: string }> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || !user.isActive) {
    throw new AppError("Credenciales inválidas", StatusCodes.UNAUTHORIZED);
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new AppError("Credenciales inválidas", StatusCodes.UNAUTHORIZED);

  const accessToken = jwt.sign(
    { role: user.role, email: user.email, name: user.name },
    env.JWT_ACCESS_SECRET,
    { subject: user.id, expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m` }
  );

  const refreshToken = jwt.sign({ type: "refresh" }, env.JWT_REFRESH_SECRET, {
    subject: user.id,
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken }
  });

  return { tokens: { accessToken, refreshToken }, userId: user.id };
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string };
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user || !user.refreshToken || user.refreshToken !== refreshToken || !user.isActive) {
    throw new AppError("Refresh token inválido", StatusCodes.UNAUTHORIZED);
  }

  const accessToken = jwt.sign(
    { role: user.role, email: user.email, name: user.name },
    env.JWT_ACCESS_SECRET,
    { subject: user.id, expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m` }
  );
  const nextRefreshToken = jwt.sign({ type: "refresh" }, env.JWT_REFRESH_SECRET, {
    subject: user.id,
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: nextRefreshToken }
  });

  return { accessToken, refreshToken: nextRefreshToken };
}

export async function logout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null }
  });
}
