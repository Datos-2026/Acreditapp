# Plataforma de Acreditación de Personas (GCBA)

Aplicación web full stack para migrar y operar acreditaciones de eventos en tiempo real, reemplazando el flujo manual de AppSheet.

## Stack implementado

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Base de datos: SQLite local (rápido) o PostgreSQL + Prisma
- Monorepo: npm workspaces (`apps/web`, `apps/api`, `packages/shared`)
- Auth: JWT access token + refresh token HTTP-only cookie
- Validaciones: Zod
- Estado servidor frontend: TanStack Query
- Formularios frontend: React Hook Form + Zod resolver
- Importación Excel: `xlsx` + `multer`
- Charts dashboard: Recharts
- Timezone operativa: `America/Argentina/Buenos_Aires`
- Idioma UI: Español

## Estructura del proyecto

```txt
apps/
  api/                # Express API + Prisma
  web/                # React/Vite UI
packages/
  shared/             # tipos, schemas y helpers compartidos
docker-compose.yml    # PostgreSQL opcional local
.env.example
README.md
```

## Modelo de datos

Incluye entidades y reglas pedidas:

- `User`, `Event`, `EventUser`
- `Person` (global)
- `EventPerson` (persona en evento)
- `AccreditationOverride`
- `ImportBatch`, `ImportBatchRowError`
- `AuditLog`

Archivos clave:

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260420105000_init/migration.sql`
- `apps/api/prisma/seed.ts`

## API REST (`/api/v1`)

### Auth
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /auth/forgot-password` (placeholder listo para integrar email)

### Users
- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `GET /users/:id`

### Events + People + Accreditation
- `GET /events`
- `POST /events`
- `GET /events/:id`
- `PATCH /events/:id`
- `POST /events/:id/users`
- `GET /events/:id/people`
- `POST /events/:id/people/manual`
- `GET /events/:id/people/search?cuil=`
- `POST /events/:id/people/:eventPersonId/accredit`
- `POST /events/:id/people/:eventPersonId/reaccredit`
- `GET /events/:id/activity`

### XLSX Import
- `POST /events/:id/imports/preview`
- `POST /events/:id/imports/confirm`
- `GET /events/:id/imports`
- `GET /imports/:id`

### Dashboard
- `GET /events/:id/stats`
- `GET /events/:id/stats/by-user`
- `GET /events/:id/stats/timeline`
- `GET /events/:id/dashboard`

## Reglas de negocio implementadas

- Bloqueo de doble acreditación por defecto.
- Reacreditación con override y motivo (roles admin).
- Trazabilidad de `quién + cuándo` acreditó.
- Alta manual marcada como `source=manual`.
- Búsqueda por CUIL normalizada (con/sin guiones/espacios).
- Preview de importación con validación de filas y resumen.
- Auditoría de acciones sensibles (auth, eventos, usuarios, importación, acreditación).
- RBAC backend y guardas de rol en frontend.

## UI / UX GCBA

Design system propio en `apps/web/src/styles/theme.css` con tokens:

- Azul oscuro: `#153244`
- Amarillo: `#FFCC00`
- Cyan: `#8DE2D6`
- Off white: `#FCFCFC`
- Gris oscuro: `#3C3C3B`

Componentes incluidos:

- `EventCard`
- `SearchByCuilPanel`
- `PersonSummaryCard`
- `AccreditationStatusBadge`
- `ManualPersonForm`
- `ImportWizard`
- `ImportPreviewTable`
- `MetricsCard`
- `ActivityTimeline`
- `ProtectedRoute`
- `RoleGuard`
- `AppLayout`
- `DataTable`
- `ConfirmDialog`

Assets de marca:

- `apps/web/public/brand/logo-ba.svg`
- `apps/web/public/brand/logo-ba-white.svg`
- carpeta preparada para favicon y logos oficiales

## Variables de entorno

Copiar `.env.example` a `.env` en la raíz:

```env
DATABASE_URL="file:./prisma/dev.db"
API_PORT=4000
WEB_PORT=5173
JWT_ACCESS_SECRET="dev_access_secret_change_me"
JWT_REFRESH_SECRET="dev_refresh_secret_change_me"
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=7
CORS_ORIGIN="http://localhost:5173"
COOKIE_SECURE=false
```

## Instalación paso a paso

1. Instalar dependencias:

```bash
npm install
```

2. Inicializar base local (SQLite):

```bash
npm run db:migrate
```

3. Cargar seed:

```bash
npm run db:seed
```

4. Levantar frontend + backend:

```bash
npm run dev
```

### Opción PostgreSQL (opcional)

Si preferís Postgres, podés levantarlo así:

```bash
docker compose up -d
```

API: `http://localhost:4000`  
Web: `http://localhost:5173`

## Scripts disponibles

- `npm run dev` (api + web)
- `npm run dev:api`
- `npm run dev:web`
- `npm run build`
- `npm run lint`
- `npm run test`
- `npm run db:migrate`
- `npm run db:seed`
- `npm run format`

## Credenciales demo (seed)

Password común: `Password123!`

- `superadmin@gcba.local` (`SUPERADMIN`)
- `admin1@gcba.local` (`ADMIN_EVENTO`)
- `admin2@gcba.local` (`ADMIN_EVENTO`)
- `acred1@gcba.local` (`ACREDITADOR`)
- `acred2@gcba.local` (`ACREDITADOR`)
- `acred3@gcba.local` (`ACREDITADOR`)
- `lectura@gcba.local` (`LECTURA`)

## Testing implementado

### Backend (`apps/api`)
- helper de login/search CUIL
- validación de búsqueda por CUIL normalizado
- bloqueo de doble acreditación
- validación de preview de importación

### Frontend (`apps/web`)
- render de login
- render de card de evento
- estado básico de flujo de acreditación (persona ya acreditada)

## Decisiones técnicas principales

- Persona global separada de participación por evento (`Person` vs `EventPerson`) para evitar duplicados y preservar identidad.
- JWT + refresh HTTP-only para operación simple y segura en despliegues estándar.
- Prisma con migración SQL explícita y seed reproducible.
- Arquitectura modular en API por dominio (`auth`, `users`, `events`, `imports`, `dashboard`).
- Componentización UI orientada a operación rápida de check-in.

## Nota operativa

Si usás la opción PostgreSQL y `docker compose up -d` falla por daemon apagado, iniciar Docker Desktop y repetir.
