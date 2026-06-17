import dotenv from "dotenv";
import { google } from "googleapis";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: join(root, ".env") });

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID?.trim();
const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

if (!raw || !spreadsheetId) {
  console.error("Faltan GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SPREADSHEET_ID");
  process.exit(1);
}

let credentials;
try {
  credentials = JSON.parse(raw);
  credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
} catch (e) {
  console.error("JSON inválido:", e.message);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

try {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
  console.log("OK: acceso al spreadsheet");
  console.log("Título libro:", meta.data.properties?.title);
  console.log("Pestañas:", titles.join(", ") || "(ninguna)");

  const testSheet = `test-${Date.now()}`;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: testSheet } } }] }
  });
  console.log("OK: creó pestaña de prueba:", testSheet);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteSheet: { sheetId: (await sheets.spreadsheets.get({ spreadsheetId })).data.sheets?.find((s) => s.properties?.title === testSheet)?.properties?.sheetId } }] }
  });
  console.log("OK: borró pestaña de prueba");
} catch (err) {
  console.error("ERROR:", err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
}
