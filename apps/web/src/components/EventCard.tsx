import { useEffect, useRef, useState } from "react";
import type { EventCardDto } from "@gcba/shared";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDateTimeAr } from "@gcba/shared";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { useAuth } from "../features/auth/auth-context";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  event: EventCardDto;
};

const statusClass: Record<EventCardDto["status"], string> = {
  active: "status-pill status-pill--active",
  draft: "status-pill status-pill--draft",
  closed: "status-pill status-pill--closed",
  archived: "status-pill status-pill--archived"
};

const statusLabel: Record<EventCardDto["status"], string> = {
  active: "Activo",
  draft: "Borrador",
  closed: "Cerrado",
  archived: "Archivado"
};

export function EventCard({ event }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canManage = user?.role === "SUPERADMIN" || user?.role === "ADMIN_EVENTO";
  const isAdminPath = location.pathname.startsWith("/admin");
  const editPath = isAdminPath ? `/admin/eventos/${event.id}/editar` : `/eventos/${event.id}/editar`;
  const eventHref =
    user?.role === "INFORMADOR" ? `/events/${event.id}/informe` : `/events/${event.id}?tab=terminal`;

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/events/${event.id}`);
    },
    onSuccess: () => {
      setShowDeleteConfirm(false);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(isAdminPath ? "/admin/eventos" : "/eventos");
    },
    onError: () => {
      setShowDeleteConfirm(false);
      setDeleteError("No se pudo eliminar el evento.");
    }
  });

  return (
    <article className="card event-card">
      <div className="event-card__top">
        <span className={statusClass[event.status]}>{statusLabel[event.status]}</span>
        {canManage ? (
          <div className="event-card__menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="icon-btn event-card__menu"
              aria-label="Opciones del evento"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="more_vert" />
            </button>
            {menuOpen ? (
              <div className="event-card__dropdown" role="menu">
                <Link
                  to={editPath}
                  className="event-card__dropdown-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name="edit" />
                  Editar evento
                </Link>
                <button
                  type="button"
                  className="event-card__dropdown-item event-card__dropdown-item--danger"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowDeleteConfirm(true);
                  }}
                >
                  <Icon name="delete" />
                  Eliminar evento
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <h3 className="event-card__title">{event.name}</h3>
      <p className="event-card__description">{event.description ?? "Sin descripción"}</p>
      <div className="event-card__meta">
        <Icon name="calendar_today" style={{ fontSize: 18 }} />
        <span>{formatDateTimeAr(event.startAt)}</span>
      </div>
      <p className="event-card__stats">
        <strong>En base:</strong> {event.totalPeople} &nbsp;|&nbsp; <strong>Acreditados:</strong>{" "}
        {event.accreditedPeople}
      </p>
      <Link to={eventHref} className="btn btn-primary event-card__action">
        <Icon name="arrow_forward" />
        {user?.role === "INFORMADOR" ? "Ver informe" : "Ingresar al evento"}
      </Link>
      {deleteError ? <p className="message-error" style={{ marginTop: "0.5rem" }}>{deleteError}</p> : null}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Eliminar evento"
        message={`¿Eliminar "${event.name}"? Se borrarán personas del evento, importaciones e informes asociados. No se puede deshacer.`}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </article>
  );
}
