#!/usr/bin/env python3
"""
Cruza un Excel/CSV de personas con BASE_ACREDITADOS.personas por CUIL
y completa telefono + email_form cuando hay match.

La salida conserva todas las filas/columnas originales y solo agrega
telefono y email_form (si no existían).

Uso (desde la raíz del repo, con VPN/MySQL accesible):

  py -m pip install -r scripts/requirements-enrich-phones.txt
  py scripts/enrich_phones_from_base_acreditados.py "ruta/a/tu_base.xlsx"
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pandas as pd
import pymysql
from dotenv import load_dotenv
import os

REPO_ROOT = Path(__file__).resolve().parents[1]

CUIL_CANDIDATES = (
    "cuil",
    "cuit",
    "nro_cuil",
    "nro_cuit",
    "numero_cuil",
    "cuil_cuit",
    "cuit_cuil",
)
PHONE_CANDIDATES = (
    "telefono",
    "teléfono",
    "telefono_movil",
    "celular",
    "cel",
    "phone",
    "tel",
)


def digits(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return re.sub(r"\D", "", str(value))


def normalize_cuil(value) -> str | None:
    cuil = digits(value)
    if len(cuil) == 11:
        return cuil
    # Excel a veces lo lee como float / pierde ceros
    if len(cuil) == 10:
        padded = cuil.zfill(11)
        return padded
    return None


def normalize_header(name: str) -> str:
    text = str(name).strip().lower()
    text = (
        text.replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("ñ", "n")
    )
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def find_column(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    normalized = {normalize_header(c): c for c in columns}
    for candidate in candidates:
        if candidate in normalized:
            return normalized[candidate]
    for key, original in normalized.items():
        if any(candidate in key for candidate in candidates):
            return original
    return None


def load_table(path: Path, sheet: str | None) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        return pd.read_excel(path, sheet_name=sheet or 0, dtype=str)
    if suffix == ".csv":
        for sep in (",", ";", "\t"):
            try:
                df = pd.read_csv(path, sep=sep, dtype=str, encoding="utf-8-sig")
                if df.shape[1] > 1:
                    return df
            except Exception:
                continue
        return pd.read_csv(path, dtype=str, encoding="latin-1")
    raise SystemExit(f"Formato no soportado: {suffix}. Usá .xlsx o .csv")


def mysql_config() -> dict:
    load_dotenv(REPO_ROOT / ".env")
    host = os.getenv("ACREDITADOS_MYSQL_HOST", "").strip()
    user = os.getenv("ACREDITADOS_MYSQL_USER", "").strip()
    password = os.getenv("ACREDITADOS_MYSQL_PASSWORD", "")
    port = int(os.getenv("ACREDITADOS_MYSQL_PORT", "3306"))
    database = os.getenv("BASE_ACREDITADOS_MYSQL_DATABASE", "BASE_ACREDITADOS").strip() or "BASE_ACREDITADOS"
    if not host or not user or not password:
        raise SystemExit(
            "Faltan ACREDITADOS_MYSQL_HOST / USER / PASSWORD en el .env de la raíz del repo."
        )
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": database,
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor,
        "connect_timeout": 20,
        "read_timeout": 120,
        "write_timeout": 120,
    }


def _clean_text(value) -> str | None:
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


def fetch_contact_by_cuil(cuils: list[str], batch_size: int = 800) -> dict[str, dict[str, str]]:
    """Devuelve {cuil: {telefono?, email_form?}} desde BASE_ACREDITADOS.personas."""
    if not cuils:
        return {}

    cfg = mysql_config()
    database = cfg.pop("database")
    result: dict[str, dict[str, str]] = {}

    connection = pymysql.connect(**cfg, database=database)
    try:
        with connection.cursor() as cursor:
            for i in range(0, len(cuils), batch_size):
                chunk = cuils[i : i + batch_size]
                placeholders = ",".join(["%s"] * len(chunk))
                cursor.execute(
                    f"""
                    SELECT cuil, telefono, email_form
                    FROM personas
                    WHERE cuil IN ({placeholders})
                      AND (
                        (telefono IS NOT NULL AND TRIM(telefono) <> '')
                        OR (email_form IS NOT NULL AND TRIM(email_form) <> '')
                      )
                    """,
                    chunk,
                )
                for row in cursor.fetchall():
                    cuil = digits(row["cuil"])
                    if not cuil or cuil in result:
                        continue
                    phone = _clean_text(row.get("telefono"))
                    email = _clean_text(row.get("email_form"))
                    if not phone and not email:
                        continue
                    entry: dict[str, str] = {}
                    if phone:
                        entry["telefono"] = phone
                    if email:
                        entry["email_form"] = email
                    result[cuil] = entry
    finally:
        connection.close()
    return result


def enrich(
    df: pd.DataFrame,
    *,
    cuil_col: str | None,
    phone_col: str | None,
    overwrite: bool,
    dry_run: bool,
) -> tuple[pd.DataFrame, dict]:
    original_columns = list(df.columns)
    cuil_column = cuil_col or find_column(original_columns, CUIL_CANDIDATES)
    if not cuil_column:
        raise SystemExit(
            "No encontré columna de CUIL/CUIT. Pasá --cuil-col NOMBRE_COLUMNA. "
            f"Columnas: {', '.join(map(str, original_columns))}"
        )

    phone_column = phone_col or find_column(original_columns, PHONE_CANDIDATES) or "telefono"
    email_column = "email_form"
    if phone_column not in df.columns:
        df[phone_column] = pd.NA
    if email_column not in df.columns:
        df[email_column] = pd.NA

    normalized = df[cuil_column].map(normalize_cuil)
    unique_cuils = sorted({c for c in normalized if c})
    contact_map = fetch_contact_by_cuil(unique_cuils)

    phones_filled = 0
    emails_filled = 0
    matched = 0
    phone_skipped = 0
    email_skipped = 0

    for idx, cuil in normalized.items():
        if not cuil:
            continue
        contact = contact_map.get(cuil)
        if not contact:
            continue

        matched += 1
        phone = contact.get("telefono")
        email = contact.get("email_form")

        if phone:
            current_phone = digits(df.at[idx, phone_column])
            if current_phone and not overwrite:
                phone_skipped += 1
            elif not dry_run:
                df.at[idx, phone_column] = phone
                phones_filled += 1
            else:
                phones_filled += 1

        if email:
            current_email = _clean_text(df.at[idx, email_column])
            if current_email and not overwrite:
                email_skipped += 1
            elif not dry_run:
                df.at[idx, email_column] = email
                emails_filled += 1
            else:
                emails_filled += 1

    # Misma estructura: columnas originales + telefono/email_form si se agregaron
    output_columns = list(original_columns)
    for extra in (phone_column, email_column):
        if extra not in output_columns:
            output_columns.append(extra)
    df = df[output_columns]

    file_cuils_with_value = [c for c in normalized if c]
    sin_match = sum(1 for c in file_cuils_with_value if c not in contact_map)

    stats = {
        "filas": len(df),
        "cuils_validos_en_archivo": len(file_cuils_with_value),
        "cuils_unicos": len(unique_cuils),
        "matches_con_dato_en_base": matched,
        "filas_sin_match": sin_match,
        "telefonos_completados": phones_filled,
        "emails_completados": emails_filled,
        "telefonos_omitidos_por_ya_tener": phone_skipped,
        "emails_omitidos_por_ya_tener": email_skipped,
        "cuil_column": cuil_column,
        "phone_column": phone_column,
        "email_column": email_column,
        "overwrite": overwrite,
        "dry_run": dry_run,
    }
    return df, stats


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}_enriquecido{input_path.suffix or '.xlsx'}")


def save_table(df: pd.DataFrame, path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        df.to_csv(path, index=False, encoding="utf-8-sig")
        return
    if suffix not in {".xlsx", ".xlsm", ".xls"}:
        path = path.with_suffix(".xlsx")
    df.to_excel(path, index=False)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Completa teléfonos cruzando CUIL contra BASE_ACREDITADOS.personas"
    )
    parser.add_argument("input", type=Path, help="Excel o CSV de entrada")
    parser.add_argument("-o", "--output", type=Path, help="Archivo de salida (default: *_enriquecido.xlsx)")
    parser.add_argument("--sheet", help="Nombre de hoja si el Excel tiene varias")
    parser.add_argument("--cuil-col", help="Nombre exacto de la columna CUIL/CUIT")
    parser.add_argument("--phone-col", help="Nombre de la columna de teléfono a completar")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Sobrescribe teléfono existente (por defecto solo completa vacíos)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo informa estadísticas; no escribe archivo ni cambia teléfonos",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    if not input_path.exists():
        print(f"No existe el archivo: {input_path}", file=sys.stderr)
        return 1

    print(f"Leyendo {input_path} ...")
    df = load_table(input_path, args.sheet)
    print(f"Filas: {len(df):,} | Columnas: {len(df.columns)}")

    enriched, stats = enrich(
        df,
        cuil_col=args.cuil_col,
        phone_col=args.phone_col,
        overwrite=args.overwrite,
        dry_run=args.dry_run,
    )

    print("\nResultado del cruce:")
    for key, value in stats.items():
        print(f"  {key}: {value}")

    if args.dry_run:
        print("\nDry-run: no se generó archivo de salida.")
        return 0

    output_path = (args.output or default_output_path(input_path)).expanduser().resolve()
    save_table(enriched, output_path)
    print(f"\nArchivo generado: {output_path}")
    print("Misma base original + columnas telefono y email_form (solo completadas si hubo match).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
