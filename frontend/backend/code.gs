/**
 * 高中生營隊大富翁 - Google Apps Script Backend (Web App)
 *
 * Sheets:
 * - ID: id, team_name, play_name
 * - Team: team_id, team_name, money
 * - Status: location_name, achieve_1, achieve_2, achieve_3 (有效資料只在第 2 列)
 * - Map_Info: location_name, description
 * - Achieve_Info: achieve_id, title, description
 */

const SHEET_NAMES = {
  ID: "ID",
  TEAM: "Team",
  STATUS: "Status",
  MAP_INFO: "Map_Info",
  ACHIEVE_INFO: "Achieve_Info",
};

function doGet(e) {
  try {
    const studentId = e && e.parameter ? e.parameter.id : "";
    if (!studentId) {
      return jsonResponse_({ success: false, message: "Missing 'id' parameter" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Step 1: 查人 (ID)
    const idSheet = ss.getSheetByName(SHEET_NAMES.ID);
    if (!idSheet) return jsonResponse_({ success: false, message: "Sheet not found: ID" });
    const idRows = getRowsAsObjects_(idSheet);
    const student = idRows.find((r) => String(r.id) === String(studentId));
    if (!student) {
      return jsonResponse_({ success: false, message: "Invalid id" });
    }

    // Step 2: 關聯隊伍 (Team)
    const teamSheet = ss.getSheetByName(SHEET_NAMES.TEAM);
    if (!teamSheet) return jsonResponse_({ success: false, message: "Sheet not found: Team" });
    const teamRows = getRowsAsObjects_(teamSheet);
    const teamRow = teamRows.find((r) => String(r.team_name) === String(student.team_name));
    if (!teamRow) {
      return jsonResponse_({ success: false, message: "Team not found for player" });
    }

    const teamMoney = Number(teamRow.money) || 0;

    // Step 3: 讀取全域狀態 (Status Row 2)
    const statusSheet = ss.getSheetByName(SHEET_NAMES.STATUS);
    if (!statusSheet) return jsonResponse_({ success: false, message: "Sheet not found: Status" });
    const statusObj = getRow2AsObject_(statusSheet);

    const locationName = String(statusObj.location_name || "");
    const achieveIds = ["achieve_1", "achieve_2", "achieve_3"];
    const achieveFlags = achieveIds.map((key) => Boolean(statusObj[key]));

    // Look-up: Map_Info location description
    const mapInfoSheet = ss.getSheetByName(SHEET_NAMES.MAP_INFO);
    if (!mapInfoSheet) return jsonResponse_({ success: false, message: "Sheet not found: Map_Info" });
    const mapInfoRows = getRowsAsObjects_(mapInfoSheet);
    const mapInfoRow = mapInfoRows.find((r) => String(r.location_name) === locationName);
    const locationDescription = mapInfoRow && mapInfoRow.description != null ? String(mapInfoRow.description) : "";

    // Look-up: Achieve_Info details
    const achieveInfoSheet = ss.getSheetByName(SHEET_NAMES.ACHIEVE_INFO);
    if (!achieveInfoSheet) return jsonResponse_({ success: false, message: "Sheet not found: Achieve_Info" });
    const achieveInfoRows = getRowsAsObjects_(achieveInfoSheet);

    const achievements = achieveIds.map((id, idx) => {
      const info = achieveInfoRows.find((r) => String(r.achieve_id) === id);
      return {
        id: id,
        is_unlocked: Boolean(achieveFlags[idx]),
        title: info && info.title != null ? String(info.title) : "",
        description: info && info.description != null ? String(info.description) : "",
      };
    });

    return jsonResponse_({
      success: true,
      player: { name: String(student.play_name || ""), id: String(student.id || "") },
      team: { name: String(teamRow.team_name || ""), money: teamMoney },
      global: {
        location: {
          name: locationName,
          description: locationDescription,
        },
        achievements: achievements,
      },
    });
  } catch (err) {
    return jsonResponse_({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getRowsAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  const headers = values[0].map((h) => String(h).trim());
  const rows = values.slice(1);

  return rows
    .filter((row) => row.some((cell) => cell !== "" && cell != null))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i];
      });
      return obj;
    });
}

function getRow2AsObject_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values && values[0] ? values[0].map((h) => String(h).trim()) : [];
  const row2 = values && values[1] ? values[1] : [];
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row2[i];
  });
  return obj;
}


