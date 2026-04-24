import type { PropsWithChildren, ReactNode } from "react";
import type { AppRole } from "@gcba/shared";
import { useAuth } from "../features/auth/auth-context";

type Props = PropsWithChildren<{
  roles: AppRole[];
  fallback?: ReactNode;
}>;

export function RoleGuard({ roles, children, fallback = null }: Props) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <>{fallback}</>;
  return <>{children}</>;
}
