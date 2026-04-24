import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventCardDto } from "@gcba/shared";
import { formatDateTimeAr } from "@gcba/shared";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { useAuth } from "../auth/auth-context";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Eventos que intersectan cada día (hora local). */
function eventsByDay(events: EventCardDto[]): Map<string, EventCardDto[]> {
  const map = new Map<string, EventCardDto[]>();
  for (const ev of events) {
    const start = startOfDay(new Date(ev.startAt));
    const end = startOfDay(new Date(ev.endAt));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end < start) continue;
    const cur = new Date(start);
    while (cur <= end) {
      const k = toYMD(cur);
      const list = map.get(k) ?? [];
      list.push(ev);
      map.set(k, list);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

function buildMonthGrid(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === month });
  }
  return cells;
}

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const statusLabel: Record<EventCardDto["status"], string> = {
  active: "Activo",
  draft: "Borrador",
  closed: "Cerrado",
  archived: "Archivado"
};

export function EventsCalendarPage() {
  const { user } = useAuth();
  const canCreateEvent = user?.role === "SUPERADMIN" || user?.role === "ADMIN_EVENTO";
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => ({
    y: today.getFullYear(),
    m: today.getMonth()
  }));
  const [selected, setSelected] = useState(() => startOfDay(today));

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const response = await api.get<EventCardDto[]>("/events");
      return response.data;
    }
  });

  const byDay = useMemo(() => eventsByDay(events), [events]);
  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor.y, cursor.m]);

  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(
        new Date(cursor.y, cursor.m, 1)
      ),
    [cursor.y, cursor.m]
  );

  const selectedKey = toYMD(selected);
  const selectedEvents = byDay.get(selectedKey) ?? [];

  const goMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  if (isLoading) {
    return <div className="page-state">Cargando calendario...</div>;
  }

  return (
    <section className="events-cal-page">
      <div className="events-cal-page__head">
        <div>
          <h1 className="display-sm">Eventos</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            Calendario mensual y detalle por día. Los eventos multi‑día aparecen en cada fecha del rango.
          </p>
        </div>
        <div className="events-cal-page__head-actions">
          <Link to="/" className="btn btn-ghost">
            <Icon name="dashboard" />
            Vista panel
          </Link>
          {canCreateEvent ? (
            <Link to="/events/new" className="btn btn-primary">
              <Icon name="add" />
              Nuevo evento
            </Link>
          ) : null}
        </div>
      </div>

      <div className="events-cal-layout">
        <div className="card events-cal">
          <div className="events-cal__toolbar">
            <button type="button" className="icon-btn" onClick={() => goMonth(-1)} aria-label="Mes anterior">
              <Icon name="chevron_left" />
            </button>
            <h2 className="events-cal__title">{monthTitle}</h2>
            <button type="button" className="icon-btn" onClick={() => goMonth(1)} aria-label="Mes siguiente">
              <Icon name="chevron_right" />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn--sm"
              onClick={() => {
                const n = new Date();
                setCursor({ y: n.getFullYear(), m: n.getMonth() });
                setSelected(startOfDay(n));
              }}
            >
              Hoy
            </button>
          </div>

          <div className="events-cal__weekdays" aria-hidden>
            {WEEKDAYS.map((w) => (
              <div key={w} className="events-cal__weekday">
                {w}
              </div>
            ))}
          </div>

          <div className="events-cal__grid" role="grid" aria-label={`Calendario de ${monthTitle}`}>
            {grid.map(({ date, inMonth }) => {
              const k = toYMD(date);
              const dayEvents = byDay.get(k) ?? [];
              const isToday = sameYMD(date, today);
              const isSelected = sameYMD(date, selected);
              return (
                <button
                  key={k}
                  type="button"
                  role="gridcell"
                  className={`events-cal__cell${!inMonth ? " events-cal__cell--muted" : ""}${isToday ? " events-cal__cell--today" : ""}${isSelected ? " events-cal__cell--selected" : ""}`}
                  onClick={() => setSelected(startOfDay(date))}
                >
                  <span className="events-cal__daynum">{date.getDate()}</span>
                  <div className="events-cal__chips">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <Link
                        key={ev.id}
                        to={`/events/${ev.id}?tab=terminal`}
                        className="events-cal__chip"
                        title={ev.name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ev.name.length > 22 ? `${ev.name.slice(0, 20)}…` : ev.name}
                      </Link>
                    ))}
                    {dayEvents.length > 3 ? (
                      <span className="events-cal__more">+{dayEvents.length - 3}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="card events-cal-detail">
          <h3 className="events-cal-detail__heading">
            {new Intl.DateTimeFormat("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric"
            }).format(selected)}
          </h3>
          {selectedEvents.length === 0 ? (
            <p className="events-cal-detail__empty">No hay eventos en esta fecha.</p>
          ) : (
            <ul className="events-cal-detail__list">
              {selectedEvents.map((ev) => (
                <li key={ev.id} className="events-cal-detail__item">
                  <div className="events-cal-detail__item-top">
                    <span className={`status-pill status-pill--${ev.status}`}>{statusLabel[ev.status]}</span>
                    <Link to={`/events/${ev.id}?tab=terminal`} className="events-cal-detail__link">
                      {ev.name}
                      <Icon name="arrow_forward" style={{ fontSize: 16 }} />
                    </Link>
                  </div>
                  <p className="events-cal-detail__meta">
                    <Icon name="schedule" style={{ fontSize: 16 }} />
                    {formatDateTimeAr(ev.startAt)} — {formatDateTimeAr(ev.endAt)}
                  </p>
                  {ev.location ? (
                    <p className="events-cal-detail__meta">
                      <Icon name="place" style={{ fontSize: 16 }} />
                      {ev.location}
                    </p>
                  ) : null}
                  <p className="events-cal-detail__meta">
                    En base: {ev.totalPeople} · Acreditados: {ev.accreditedPeople}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
