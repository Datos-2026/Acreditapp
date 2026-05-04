import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { loginSchema } from "@gcba/shared";
import type { z } from "zod";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { Icon } from "../../components/Icon";

type FormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(loginSchema)
  });

  return (
    <div className="login-page">
      <div className="login-hero">
        <p className="login-hero__kicker">
          Gobierno de la Ciudad
        </p>
        <h1>Acreditación institucional con claridad operativa</h1>
        <p>
          Ingresá con tu cuenta para operar terminales de check-in, importar bases y consultar métricas por evento.
        </p>
      </div>
      <div className="login-panel">
        <div className="login-card card">
          <div className="login-card__header">
            <div className="login-card__badge">
              <Icon name="badge" style={{ color: "#fff", fontSize: 26 }} />
            </div>
            <div>
              <h2 className="login-card__title">Iniciar sesión</h2>
              <p className="login-card__subtitle">
                GCBA | Acreditación
              </p>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={handleSubmit(async (values) => {
              setError(null);
              try {
                const me = await login(values.email, values.password);
                if (fromPath && fromPath !== "/login") {
                  navigate(fromPath, { replace: true });
                  return;
                }
                navigate(me.role === "SUPERADMIN" ? "/admin" : "/eventos", { replace: true });
              } catch (err) {
                if (axios.isAxiosError(err)) {
                  if (err.code === "ERR_NETWORK" || err.message === "Network Error") {
                    setError(
                      "No hay conexión con la API. Revisá que el backend esté en marcha y VITE_API_URL (por defecto http://localhost:4000/api/v1)."
                    );
                    return;
                  }
                  const msg = err.response?.data && (err.response.data as { message?: string }).message;
                  if (err.response?.status === 401 && typeof msg === "string") {
                    setError(msg);
                    return;
                  }
                  if (err.response?.status === 429) {
                    setError(
                      "Demasiados intentos. Esperá unos minutos o reiniciá el servidor de la API (en desarrollo se relajó el límite)."
                    );
                    return;
                  }
                  if (err.response?.status === 503 && typeof msg === "string") {
                    setError(msg);
                    return;
                  }
                  if (err.response?.status === 500 && typeof msg === "string") {
                    setError(`Error del servidor: ${msg}`);
                    return;
                  }
                }
                setError("No se pudo iniciar sesión. Revisá correo y contraseña.");
              }
            })}
          >
            <label className="label-md login-form__label" htmlFor="email">
              Correo electrónico
            </label>
            <input id="email" className="input input--boxed" type="email" placeholder="nombre@gcba.local" {...register("email")} />
            <label className="label-md login-form__label login-form__label--spaced" htmlFor="password">
              Contraseña
            </label>
            <input id="password" className="input input--boxed" type="password" placeholder="••••••••" {...register("password")} />
            <button className="btn btn-primary login-form__submit" type="submit">
              Entrar
            </button>
          </form>
          <button className="btn btn-link login-form__recover" type="button">
            Recuperar contraseña
          </button>
          {error ? <p className="message-error">{error}</p> : null}
          {formState.errors.email ? <p className="message-error">{formState.errors.email.message}</p> : null}
        </div>
      </div>
    </div>
  );
}
