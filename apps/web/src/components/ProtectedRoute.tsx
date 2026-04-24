import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../features/auth/auth-context";

export function ProtectedRoute() {
  const { user, refreshMe } = useAuth();
  const [checked, setChecked] = useState(Boolean(user));
  const location = useLocation();

  useEffect(() => {
    if (user) return;
    refreshMe().finally(() => setChecked(true));
  }, [refreshMe, user]);

  const loading = !user && !checked;
  if (loading) return <div className="page-state">Cargando sesión...</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}
