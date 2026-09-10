#!/usr/bin/env python3
"""
Cruza inscripciones de un curso vs dotación GCBA.

Hoja 1 (Pendientes): personas de la dotación que NO figuran en el Excel de
inscripciones, excluyendo:
  - quienes tienen NOTA = Aprobado (no se cruzan / no salen)
  - en la DOTACIÓN, quienes tienen REGIMEN Docente o Salud/médico

Hoja 2 (Universo): por MINISTERIO, % de personas de la dotación (ya filtrada
por REGIMEN) que NO lo hicieron (no tienen NOTA Aprobado en el Excel).
  Ej.: Hacienda 1000 en dotación, 500 aprobados → 50% no lo hicieron.

Uso:
  py scripts/pendientes_vs_dotacion_curso.py "ruta/inscripciones.xlsx" --from-mysql
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd
import pymysql
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]

# Exclusión por REGIMEN de la dotación (no por ministerio del Excel)
EXCLUDED_REGIMEN_KEYWORDS = (
    "docente",
    "salud",
    "medico",
)

# Roles a reportar en Universo_Roles (match exacto sobre LIT_PUESTO)
TARGET_ROLES = (
    "PERSONAL DE GABINETE",
    "LOYS",
    "SUBGERENTE OPERATIVO",
    "GERENTE OPERATIVO",
    "Director General",
    "Subsecretario",
    "Secretaria",
    "Ministro",
)


def digits(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return re.sub(r"\D", "", str(value))


def normalize_cuil(value) -> str | None:
    cuil = digits(value)
    if len(cuil) == 11:
        return cuil
    if len(cuil) == 10:
        return cuil.zfill(11)
    return None


def fold(text: str) -> str:
    text = str(text or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text)


def is_excluded_regimen(value) -> bool:
    name = fold(value)
    return any(keyword in name for keyword in EXCLUDED_REGIMEN_KEYWORDS)


def target_role_label(lit_puesto) -> str | None:
    """Devuelve el label canónico del rol si LIT_PUESTO es uno de los pedidos."""
    key = fold(lit_puesto)
    for role in TARGET_ROLES:
        if fold(role) == key:
            return role
    return None


def clean_text(value) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "<na>"}:
        return None
    return text


def load_inscripciones(path: Path, sheet: str) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=sheet, dtype=str)
    required = {"CUIT", "NOTA"}
    missing = required - set(df.columns)
    if missing:
        cols = {fold(c): c for c in df.columns}
        cuit_col = cols.get("cuit") or cols.get("cuil")
        nota_col = cols.get("nota")
        if not cuit_col or not nota_col:
            raise SystemExit(f"Faltan columnas {missing}. Columnas: {list(df.columns)}")
        df = df.rename(columns={cuit_col: "CUIT", nota_col: "NOTA"})
    df["_cuil"] = df["CUIT"].map(normalize_cuil)
    df["_nota"] = df["NOTA"].map(lambda x: fold(x) if clean_text(x) else "")
    return df


def load_dotacion_excel(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, dtype=str)
    if "CUIL" not in df.columns and "CUIL_SIN_GUIONES" not in df.columns:
        raise SystemExit(f"La dotación Excel no tiene CUIL. Columnas: {list(df.columns)}")
    if "MINISTERIO" not in df.columns:
        raise SystemExit("La dotación Excel no tiene columna MINISTERIO")
    if "REGIMEN" not in df.columns:
        raise SystemExit("La dotación Excel no tiene columna REGIMEN")
    return df


def load_dotacion_mysql() -> pd.DataFrame:
    load_dotenv(REPO_ROOT / ".env")
    host = os.getenv("ACREDITADOS_MYSQL_HOST", "").strip()
    user = os.getenv("ACREDITADOS_MYSQL_USER", "").strip()
    password = os.getenv("ACREDITADOS_MYSQL_PASSWORD", "")
    port = int(os.getenv("ACREDITADOS_MYSQL_PORT", "3306"))
    database = os.getenv("DOTACION_MYSQL_DATABASE", "padron").strip() or "padron"
    table = os.getenv("DOTACION_MYSQL_TABLE", "dotacion_gcba_prueba").strip() or "dotacion_gcba_prueba"
    if not host or not user or not password:
        raise SystemExit("Faltan credenciales MySQL en .env")
    if not re.fullmatch(r"[A-Za-z0-9_]+", table):
        raise SystemExit("Nombre de tabla DOTACION inválido")

    conn = pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
        connect_timeout=25,
        read_timeout=180,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT * FROM `{table}`")
            rows = cur.fetchall()
    finally:
        conn.close()
    return pd.DataFrame(rows).astype(str)


def prepare_dotacion(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if "CUIL_SIN_GUIONES" in out.columns:
        out["_cuil"] = out["CUIL_SIN_GUIONES"].map(normalize_cuil)
    else:
        out["_cuil"] = None
    if "CUIL" in out.columns:
        fallback = out["CUIL"].map(normalize_cuil)
        out["_cuil"] = out["_cuil"].where(out["_cuil"].notna(), fallback)
    out = out[out["_cuil"].notna()].copy()
    out = out.drop_duplicates(subset=["_cuil"], keep="first")
    out["_excluir_regimen"] = out["REGIMEN"].map(is_excluded_regimen)
    return out


def nota_por_cuil(inscripciones: pd.DataFrame) -> dict[str, str]:
    """Una NOTA por CUIL; si hay varias filas, prioriza En Curso > Libre > Desaprobado > otra."""
    priority = {
        "en curso": 3,
        "libre": 2,
        "desaprobado": 1,
        "aprobado": 4,
    }
    best: dict[str, tuple[int, str]] = {}
    for _, row in inscripciones.iterrows():
        cuil = row.get("_cuil")
        if not cuil:
            continue
        raw = clean_text(row.get("NOTA"))
        if not raw:
            continue
        score = priority.get(fold(raw), 0)
        prev = best.get(cuil)
        if prev is None or score > prev[0]:
            best[cuil] = (score, raw)
    return {cuil: nota for cuil, (_score, nota) in best.items()}


def build_report(
    inscripciones: pd.DataFrame, dotacion: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict]:
    # CUILs a excluir del archivo (Aprobado): no se cruzan
    aprobados = set(inscripciones.loc[inscripciones["_nota"] == "aprobado", "_cuil"].dropna())
    # Quienes aparecen en el Excel (cualquier nota)
    aparecen = set(inscripciones["_cuil"].dropna())
    notas = nota_por_cuil(inscripciones)

    # Universo de cruce: dotación sin REGIMEN Docente / Salud / médico
    base = dotacion[~dotacion["_excluir_regimen"]].copy()

    # Pendientes: todos salvo Aprobado (incluye no inscritos y Libre/En Curso/etc.)
    # Así la columna NOTA puede traer el estado del Excel de inscripciones.
    pendientes = base.loc[~base["_cuil"].isin(aprobados)].copy()
    pendientes["NOTA"] = pendientes["_cuil"].map(lambda c: notas.get(c, pd.NA))
    pendientes = pendientes.drop(columns=["_excluir_regimen"], errors="ignore")

    # Aprobados por ministerio según el Excel (mismo criterio que el filtro del archivo)
    min_col = "Ministerios/Reparticion"
    if min_col not in inscripciones.columns:
        cols = {fold(c): c for c in inscripciones.columns}
        min_col = cols.get("ministerios_reparticion") or cols.get("ministerio") or ""
    excel_aprobados_por_min: dict[str, int] = {}
    if min_col:
        aprob_rows = inscripciones[inscripciones["_nota"] == "aprobado"].copy()
        aprob_rows["_min_key"] = aprob_rows[min_col].map(lambda x: fold(x) if clean_text(x) else "n/d")
        excel_aprobados_por_min = aprob_rows.groupby("_min_key").size().to_dict()

    rows = []
    for ministerio, group in base.groupby("MINISTERIO", dropna=False):
        total = len(group)
        min_label = ministerio if clean_text(ministerio) else "N/D"
        hechos = int(excel_aprobados_por_min.get(fold(min_label), 0))
        no_hechos = max(total - hechos, 0)
        pct = round((no_hechos / total) * 100, 2) if total else 0.0
        rows.append(
            {
                "MINISTERIO": min_label,
                "total_dotacion": total,
                "lo_hicieron_aprobado": hechos,
                "no_lo_hicieron": no_hechos,
                "pct_no_lo_hicieron": pct,
            }
        )
    universo = pd.DataFrame(rows).sort_values(
        by=["pct_no_lo_hicieron", "total_dotacion"], ascending=[False, False]
    )

    # Universo por rol (LIT_PUESTO): total en dota filtrada vs Aprobado por CUIL
    if "LIT_PUESTO" not in base.columns:
        raise SystemExit("La dotación no tiene columna LIT_PUESTO")
    role_rows = []
    base_roles = base.copy()
    base_roles["_rol"] = base_roles["LIT_PUESTO"].map(target_role_label)
    base_roles = base_roles[base_roles["_rol"].notna()]
    for role in TARGET_ROLES:
        group = base_roles[base_roles["_rol"] == role]
        total = len(group)
        hechos = int(group["_cuil"].isin(aprobados).sum())
        no_hechos = max(total - hechos, 0)
        pct = round((no_hechos / total) * 100, 2) if total else 0.0
        role_rows.append(
            {
                "ROL": role,
                "total_dotacion": total,
                "lo_hicieron_aprobado": hechos,
                "no_lo_hicieron": no_hechos,
                "pct_no_lo_hicieron": pct,
            }
        )
    universo_roles = pd.DataFrame(role_rows)

    # Orden: columnas originales + NOTA al final (antes de auxiliares)
    drop_cols = [c for c in pendientes.columns if c.startswith("_")]
    nota_series = pendientes["NOTA"] if "NOTA" in pendientes.columns else None
    pendientes = pendientes.drop(columns=drop_cols)
    if nota_series is not None:
        pendientes["NOTA"] = nota_series.values
        # dejar NOTA al final
        cols = [c for c in pendientes.columns if c != "NOTA"] + ["NOTA"]
        pendientes = pendientes[cols]

    stats = {
        "dotacion_total": len(dotacion),
        "dotacion_sin_docente_salud": len(base),
        "excluidos_regimen_docente_salud": int(dotacion["_excluir_regimen"].sum()),
        "inscripciones_filas": len(inscripciones),
        "cuils_en_inscripciones": len(aparecen),
        "cuils_aprobados": len(aprobados),
        "pendientes_generados": len(pendientes),
        "pendientes_con_nota": int(pendientes["NOTA"].notna().sum()) if "NOTA" in pendientes.columns else 0,
        "ministerios_universo": len(universo),
        "roles_universo": len(universo_roles),
    }
    return pendientes, universo, universo_roles, stats


def default_output(inscripciones_path: Path) -> Path:
    return inscripciones_path.with_name(f"{inscripciones_path.stem}_pendientes_vs_dotacion.xlsx")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pendientes curso vs dotación + hoja Universo")
    p.add_argument("inscripciones", type=Path, help="Excel de inscripciones por ministerio")
    p.add_argument(
        "--sheet",
        default="Datos",
        help="Hoja de inscripciones (default: Datos)",
    )
    p.add_argument(
        "--dotacion-excel",
        type=Path,
        help="Excel de dotación (si no se usa MySQL)",
    )
    p.add_argument(
        "--from-mysql",
        action="store_true",
        help="Leer dotación desde MySQL padron.dotacion_gcba_prueba",
    )
    p.add_argument("-o", "--output", type=Path, help="Excel de salida")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    insc_path = args.inscripciones.expanduser().resolve()
    if not insc_path.exists():
        print(f"No existe: {insc_path}", file=sys.stderr)
        return 1

    print(f"Leyendo inscripciones: {insc_path}")
    insc = load_inscripciones(insc_path, args.sheet)
    print(f"  filas={len(insc):,}")

    if args.from_mysql:
        print("Leyendo dotación desde MySQL...")
        dot = prepare_dotacion(load_dotacion_mysql())
    elif args.dotacion_excel:
        dot_path = args.dotacion_excel.expanduser().resolve()
        print(f"Leyendo dotación Excel: {dot_path}")
        dot = prepare_dotacion(load_dotacion_excel(dot_path))
    else:
        try:
            print("Leyendo dotación desde MySQL...")
            dot = prepare_dotacion(load_dotacion_mysql())
        except Exception as exc:
            fallback = REPO_ROOT / "scripts" / "personas_unicas_cuil_no_en_archivo.xlsx"
            if fallback.exists():
                print(f"MySQL no disponible ({exc}). Uso fallback: {fallback}")
                dot = prepare_dotacion(load_dotacion_excel(fallback))
            else:
                raise SystemExit(
                    f"No pude leer MySQL ({exc}). Pasá --dotacion-excel ruta.xlsx"
                )

    print(f"  dotación personas únicas={len(dot):,}")

    pendientes, universo, universo_roles, stats = build_report(insc, dot)
    print("\nResumen:")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    out = (args.output or default_output(insc_path)).expanduser().resolve()
    with pd.ExcelWriter(out, engine="openpyxl") as writer:
        pendientes.to_excel(writer, sheet_name="Pendientes", index=False)
        universo.to_excel(writer, sheet_name="Universo", index=False)
        universo_roles.to_excel(writer, sheet_name="Universo_Roles", index=False)

    print(f"\nArchivo generado: {out}")
    print("Hojas: Pendientes | Universo | Universo_Roles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
