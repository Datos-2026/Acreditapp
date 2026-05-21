import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { EventShellLayout } from "../components/EventShellLayout";
import { AdminLayout } from "../components/AdminLayout";
import { EventsBrowseLayout } from "../components/EventsBrowseLayout";
import { RoleBasedRedirect } from "../components/RoleBasedRedirect";
import { LoginPage } from "../features/auth/LoginPage";
import { EventsListPage } from "../features/events/EventsListPage";
import { EventsCalendarPage } from "../features/events/EventsCalendarPage";
import { CreateEventPage } from "../features/events/CreateEventPage";
import { EditEventPage } from "../features/events/EditEventPage";
import { EventDetailPage } from "../features/event-detail/EventDetailPage";
import { EventReportPage } from "../features/event-report/EventReportPage";
import { UsersAdminPage } from "../features/admin/UsersAdminPage";
import { AdminHomePage } from "../features/admin/AdminHomePage";
import { DirectoryAdminPage } from "../features/admin/DirectoryAdminPage";
import { PodioPage } from "../features/admin/PodioPage";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<RoleBasedRedirect />} />

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminHomePage />} />
          <Route path="usuarios" element={<UsersAdminPage />} />
          <Route path="directorio" element={<DirectoryAdminPage />} />
          <Route path="podio" element={<PodioPage />} />
          <Route path="eventos" element={<EventsListPage />} />
          <Route path="eventos/calendario" element={<EventsCalendarPage />} />
          <Route path="eventos/nuevo" element={<CreateEventPage />} />
          <Route path="eventos/:id/editar" element={<EditEventPage />} />
        </Route>

        <Route path="/events/:id" element={<EventShellLayout />}>
          <Route index element={<EventDetailPage />} />
          <Route path="informe" element={<EventReportPage />} />
        </Route>

        <Route element={<EventsBrowseLayout />}>
          <Route path="/eventos" element={<EventsListPage />} />
          <Route path="/eventos/calendario" element={<EventsCalendarPage />} />
          <Route path="/eventos/nuevo" element={<CreateEventPage />} />
          <Route path="/eventos/:id/editar" element={<EditEventPage />} />
        </Route>
      </Route>
      <Route path="*" element={<RoleBasedRedirect />} />
    </Routes>
  );
}
