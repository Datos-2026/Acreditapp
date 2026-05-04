import { Navigate } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";

/** Tras login o ruta desconocida: superadmin → panel, resto → listado de eventos. */
export function RoleBasedRedirect() {
  const { user } = useAuth();
  if (user?.role === "SUPERADMIN") {
    return <Navigate to="/admin" replace />;
  }
  return <Navigate to="/eventos" replace />;
}
