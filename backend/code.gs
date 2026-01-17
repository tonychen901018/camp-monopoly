/**
 * 高中生營隊大富翁 - Backend API v3.3 (Fast Action Response)
 *
 * 重點改動：
 * - doGet 支援「讀取」與「行動(action)」兩種模式
 *   - 讀取：?id=123
 *   - 行動：?action=USE_GLOVE&student_id=123&target_team_name=XXX （同理 BUY / USE_SHIELD）
 * - 行動會回傳：
 *   - action: { type, ok }
 *   - message: 具體原因（例如「對方有防護罩…」）
 *   - 並在同一份 response 內附上最新 dashboard（前端可立即更新畫面）
 *
 * 保留：Header 轉小寫、role/exp 讀取、商店僅回傳前2項。
 */

const SHEET_NAMES = {
  ID: "ID",
  TEAMS: "Teams",
  STATUS: "Status",
  MAP_INFO: "Map_Info",
  ACHIEVE_INFO: "Achieve_Info",
  ITEMS: "Items",
  LOGS: "Logs"
};

function getSheetByNameSafe_(ss, name) {
  const exact = ss.getSheetByName(name);
  if (exact) return exact;

  const normalized = String(name || "").trim().toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sheetName = String(sheets[i].getName() || "").trim().toLowerCase();
    if (sheetName === normalized) return sheets[i];
  }

  return null;
}

function getSheetByAliases_(ss, names) {
  for (let i = 0; i < names.length; i++) {
    const sheet = getSheetByNameSafe_(ss, names[i]);
    if (sheet) return sheet;
  }
  return null;
}

function getRequiredSheet_(ss, primaryName, aliases) {
  const list = [primaryName].concat(aliases || []);
  const sheet = getSheetByAliases_(ss, list);
  if (sheet) return sheet;
  const available = ss.getSheets().map(s => s.getName()).join(", ");
  throw new Error(`Sheet not found: ${primaryName}. Available: ${available}`);
}

// --- API 入口 ---

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const actionType = String(params.action || "").trim().toUpperCase();

    // 行動模式：用 GET 觸發，避免瀏覽器 CORS/no-cors 無法讀取 POST response 的問題
    if (actionType) {
      const studentIdForAction = String(params.student_id || "").trim();
      if (!studentIdForAction) throw new Error("Missing student_id");
      return handleActionAndReturnDashboard_(actionType, params, studentIdForAction);
    }

    // 讀取模式
    const studentId = String(params.id || "").trim();
    if (!studentId) throw new Error("Missing ID");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return jsonResponse_(buildDashboard_(ss, studentId, null));

  } catch (err) {
    return jsonResponse_({ success: false, message: err.toString() });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
  } catch (e) {
    return jsonResponse_({ success: false, message: "系統忙碌中，請稍後再試" });
  }

  try {
    const params = JSON.parse(e.postData.contents);
    const { action, student_id, item_id, target_team_name } = params;
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. 驗證學生
    const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
    const idRows = getRowsAsObjects_(idSheet);
    const student = idRows.find(r => String(r.id) === String(student_id));
    if (!student) throw new Error("無效的學生 ID");

    // 權限檢查 (忽略大小寫與空白)
    if (String(student.role || "").trim().toUpperCase() !== "LEADER") {
      throw new Error("只有小隊長可以使用此功能！");
    }

    const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS, ["Team"]);
    // 這裡我們還是要用原始方法寫入，不能用 getRowsAsObjects_ 因為要寫回
    const teamData = teamSheet.getDataRange().getValues();
    // 標題轉小寫以便尋找 index
    const headers = teamData[0].map(h => String(h).trim().toLowerCase());
    
    let myTeamIndex = -1;
    // 注意：比較值的時候不需要轉小寫，只要 key (header) 對就好
    const colTeamName = headers.indexOf("team_name");
    
    for (let i = 1; i < teamData.length; i++) {
      if (String(teamData[i][colTeamName]) === String(student.team_name)) {
        myTeamIndex = i;
        break;
      }
    }
    if (myTeamIndex === -1) throw new Error("找不到你的隊伍資料");

    // 定義欄位 Index (全部用小寫找)
    const colMoney = headers.indexOf("money");
    const colGloves = headers.indexOf("gloves");
    const colShields = headers.indexOf("shields");
    const colShieldExpiry = headers.indexOf("shield_expiry");
    const colHasEgg = headers.indexOf("has_egg");

    let currentMoney = Number(teamData[myTeamIndex][colMoney] || 0);
    let currentGloves = Number(teamData[myTeamIndex][colGloves] || 0);
    let currentShields = Number(teamData[myTeamIndex][colShields] || 0);

    let resultMessage = "";

    // --- 處理動作 ---
    if (action === "BUY") {
      const itemSheet = ss.getSheetByName(SHEET_NAMES.ITEMS);
      const items = getRowsAsObjects_(itemSheet);
      const targetItem = items.find(i => i.item_id === item_id);
      
      if (!targetItem) throw new Error("商品不存在");
      const price = Number(targetItem.price);

      if (currentMoney < price) throw new Error("資金不足！");

      teamSheet.getRange(myTeamIndex + 1, colMoney + 1).setValue(currentMoney - price);
      
      if (item_id === "glove") {
        teamSheet.getRange(myTeamIndex + 1, colGloves + 1).setValue(currentGloves + 1);
      } else if (item_id === "shield") {
        teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields + 1);
      }

      logToSheet(ss, student.team_name, "BUY", `Bought ${targetItem.item_name} by ${student.play_name}`, "Success");
      resultMessage = `購買 ${targetItem.item_name} 成功！`;

    } else if (action === "USE_SHIELD") {
      if (currentShields <= 0) throw new Error("沒有防護罩可使用");

      teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields - 1);
      
      const now = new Date();
      now.setHours(now.getHours() + 5);
      const expiryStr = now.toISOString();
      teamSheet.getRange(myTeamIndex + 1, colShieldExpiry + 1).setValue(expiryStr);

      logToSheet(ss, student.team_name, "USE_SHIELD", `Activated by ${student.play_name}`, expiryStr);
      resultMessage = "防護罩已啟動！5小時內有效。";

    } else if (action === "USE_GLOVE") {
      if (currentGloves <= 0) throw new Error("沒有黑手套可使用");
      if (!target_team_name) throw new Error("未指定偷竊目標");
      if (target_team_name === student.team_name) throw new Error("不能偷自己！");

      teamSheet.getRange(myTeamIndex + 1, colGloves + 1).setValue(currentGloves - 1);

      let targetIndex = -1;
      for (let i = 1; i < teamData.length; i++) {
        if (String(teamData[i][colTeamName]) === String(target_team_name)) {
          targetIndex = i;
          break;
        }
      }
      if (targetIndex === -1) throw new Error("目標隊伍不存在");

      const targetExpiryRaw = teamData[targetIndex][colShieldExpiry];
      let isProtected = false;
      if (targetExpiryRaw) {
        const expiryDate = new Date(targetExpiryRaw);
        if (expiryDate > new Date()) {
          isProtected = true;
        }
      }

      const successRate = isProtected ? 0.1 : 0.6;
      const roll = Math.random();
      const isSuccess = roll < successRate;

      let detailLog = `Target: ${target_team_name}, Protected: ${isProtected}, Roll: ${roll.toFixed(2)}, User: ${student.play_name}`;

      if (isSuccess) {
        const targetHasEgg = Boolean(teamData[targetIndex][colHasEgg]);
        
        if (targetHasEgg) {
          teamSheet.getRange(targetIndex + 1, colHasEgg + 1).setValue(false);
          teamSheet.getRange(myTeamIndex + 1, colHasEgg + 1).setValue(true);
          resultMessage = "💰 偷竊大成功！你偷到了傳說中的金蛋！快逃啊！";
          logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "SUCCESS_GOT_EGG");
        } else {
          resultMessage = "偷竊成功潛入...但他們家沒有金蛋，空手而回。";
          logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "SUCCESS_EMPTY");
        }
      } else {
        resultMessage = isProtected 
          ? "對方有防護罩！偷竊失敗，被保全趕出來了！" 
          : "偷竊失敗！手滑了，什麼都沒拿到。";
        logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "FAILED");
      }

    } else {
      throw new Error("Unknown Action");
    }

    lock.releaseLock();
    return jsonResponse_({ success: true, message: resultMessage });

  } catch (err) {
    lock.releaseLock();
    return jsonResponse_({ success: false, message: err.toString() });
  }
}

function logToSheet(ss, team, action, detail, result) {
  const logSheet = ss.getSheetByName(SHEET_NAMES.LOGS);
  if (logSheet) {
    logSheet.appendRow([new Date(), team, action, detail, result]);
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleActionAndReturnDashboard_(actionType, params, studentId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return jsonResponse_({ success: false, message: "系統忙碌中，請稍後再試" });
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const actionResult = runAction_(ss, actionType, params, studentId);
    const dashboard = buildDashboard_(ss, studentId, actionResult);
    lock.releaseLock();
    return jsonResponse_(dashboard);
  } catch (err) {
    lock.releaseLock();
    return jsonResponse_({ success: false, message: err.toString() });
  }
}

function buildDashboard_(ss, studentId, actionResultOrNull) {
  // 1. 驗證學生
  const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
  const idRows = getRowsAsObjects_(idSheet);
  const student = idRows.find(r => String(r.id) === String(studentId));
  if (!student) throw new Error("無效的學生 ID");

  // 2. 獲取隊伍資料
  const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS, ["Team"]);
  const teamRows = getRowsAsObjects_(teamSheet);
  const myTeam = teamRows.find(r => String(r.team_name) === String(student.team_name));
  if (!myTeam) throw new Error("找不到所屬隊伍資料");

  let shieldExpiry = myTeam.shield_expiry ? new Date(myTeam.shield_expiry) : null;
  const now = new Date();
  const isShieldActive = shieldExpiry && shieldExpiry > now;

  // 3. 其他隊伍（脫敏）
  const otherTeams = teamRows
    .filter(r => String(r.team_name) !== String(student.team_name))
    .map(r => ({ team_id: r.team_id, team_name: r.team_name }));

  // 4. 商店（僅前2）
  const itemSheet = getSheetByNameSafe_(ss, SHEET_NAMES.ITEMS);
  let shopItems = [];
  if (itemSheet) {
    const allItems = getRowsAsObjects_(itemSheet);
    shopItems = allItems.filter(i => i.item_id && i.price).slice(0, 2);
  }

  // 5. 全域狀態
  const statusSheet = getSheetByNameSafe_(ss, SHEET_NAMES.STATUS);
  const statusRow = statusSheet ? getRow2AsObject_(statusSheet) : {};

  const mapSheet = getSheetByNameSafe_(ss, SHEET_NAMES.MAP_INFO);
  const mapRows = mapSheet ? getRowsAsObjects_(mapSheet) : [];
  const mapInfo = mapRows.find(r => String(r.location_name) === String(statusRow.location_name));

  const achieveSheet = getSheetByNameSafe_(ss, SHEET_NAMES.ACHIEVE_INFO);
  const achieveRows = achieveSheet ? getRowsAsObjects_(achieveSheet) : [];
  const achievements = ["achieve_1", "achieve_2", "achieve_3"].map(key => {
    const info = achieveRows.find(r => String(r.achieve_id) === key);
    return {
      id: key,
      is_unlocked: Boolean(statusRow[key]),
      title: info ? info.title : key,
      description: info ? info.description : ""
    };
  });

  const res = {
    success: true,
    message: actionResultOrNull ? String(actionResultOrNull.message || "") : undefined,
    action: actionResultOrNull ? { type: actionResultOrNull.type, ok: Boolean(actionResultOrNull.ok) } : undefined,
    player: {
      name: String(student.play_name || ""),
      team: String(student.team_name || ""),
      id: String(student.id || ""),
      role: String(student.role || "MEMBER").trim().toUpperCase()
    },
    my_team: {
      money: Number(myTeam.money || 0),
      exp: Number(myTeam.exp || 0),
      has_egg: Boolean(myTeam.has_egg),
      gloves: Number(myTeam.gloves || 0),
      shields: Number(myTeam.shields || 0),
      shield_expiry: myTeam.shield_expiry || "",
      is_shield_active: isShieldActive
    },
    other_teams: otherTeams,
    shop_items: shopItems,
    global: {
      location: {
        name: String(statusRow.location_name || ""),
        description: mapInfo ? String(mapInfo.description) : ""
      },
      achievements: achievements
    }
  };

  return res;
}

function runAction_(ss, actionType, params, studentId) {
  // 驗證學生與 role
  const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
  const idRows = getRowsAsObjects_(idSheet);
  const student = idRows.find(r => String(r.id) === String(studentId));
  if (!student) throw new Error("無效的學生 ID");

  if (String(student.role || "").trim().toUpperCase() !== "LEADER") {
    throw new Error("只有小隊長可以使用此功能！");
  }

  const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS, ["Team"]);
  const teamData = teamSheet.getDataRange().getValues();
  const headers = teamData[0].map(h => String(h).trim().toLowerCase());

  const colTeamName = headers.indexOf("team_name");
  const colMoney = headers.indexOf("money");
  const colGloves = headers.indexOf("gloves");
  const colShields = headers.indexOf("shields");
  const colShieldExpiry = headers.indexOf("shield_expiry");
  const colHasEgg = headers.indexOf("has_egg");

  // 找我方隊伍
  let myTeamIndex = -1;
  for (let i = 1; i < teamData.length; i++) {
    if (String(teamData[i][colTeamName]) === String(student.team_name)) {
      myTeamIndex = i;
      break;
    }
  }
  if (myTeamIndex === -1) throw new Error("找不到你的隊伍資料");

  let currentMoney = Number(teamData[myTeamIndex][colMoney] || 0);
  let currentGloves = Number(teamData[myTeamIndex][colGloves] || 0);
  let currentShields = Number(teamData[myTeamIndex][colShields] || 0);

  if (actionType === "BUY") {
    const itemId = String(params.item_id || "").trim();
    if (!itemId) throw new Error("缺少 item_id");
    const itemSheet = ss.getSheetByName(SHEET_NAMES.ITEMS);
    const items = getRowsAsObjects_(itemSheet);
    const targetItem = items.find(i => String(i.item_id) === itemId);
    if (!targetItem) throw new Error("商品不存在");
    const price = Number(targetItem.price);
    if (currentMoney < price) throw new Error("資金不足！");

    teamSheet.getRange(myTeamIndex + 1, colMoney + 1).setValue(currentMoney - price);
    if (itemId === "glove") {
      teamSheet.getRange(myTeamIndex + 1, colGloves + 1).setValue(currentGloves + 1);
    } else if (itemId === "shield") {
      teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields + 1);
    }

    logToSheet(ss, student.team_name, "BUY", `Bought ${targetItem.item_name} by ${student.play_name}`, "Success");
    return { type: "BUY", ok: true, message: `購買成功：${targetItem.item_name}` };
  }

  if (actionType === "USE_SHIELD") {
    if (currentShields <= 0) throw new Error("沒有防護罩可使用");

    teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields - 1);
    const now = new Date();
    now.setHours(now.getHours() + 5);
    const expiryStr = now.toISOString();
    teamSheet.getRange(myTeamIndex + 1, colShieldExpiry + 1).setValue(expiryStr);

    logToSheet(ss, student.team_name, "USE_SHIELD", `Activated by ${student.play_name}`, expiryStr);
    return { type: "USE_SHIELD", ok: true, message: "防護罩已啟動（5 小時）" };
  }

  if (actionType === "USE_GLOVE") {
    if (currentGloves <= 0) throw new Error("沒有黑手套可使用");
    const targetTeamName = String(params.target_team_name || "").trim();
    if (!targetTeamName) throw new Error("未指定偷竊目標");
    if (targetTeamName === String(student.team_name)) throw new Error("不能偷自己！");

    // 扣道具（不論成功與否都消耗）
    teamSheet.getRange(myTeamIndex + 1, colGloves + 1).setValue(currentGloves - 1);

    let targetIndex = -1;
    for (let i = 1; i < teamData.length; i++) {
      if (String(teamData[i][colTeamName]) === targetTeamName) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) throw new Error("目標隊伍不存在");

    // 檢查對方是否有防護罩
    const targetExpiryRaw = teamData[targetIndex][colShieldExpiry];
    let isProtected = false;
    if (targetExpiryRaw) {
      const expiryDate = new Date(targetExpiryRaw);
      if (expiryDate > new Date()) isProtected = true;
    }

    const successRate = isProtected ? 0.1 : 0.6;
    const roll = Math.random();
    const isSuccess = roll < successRate;

    let detailLog = `Target: ${targetTeamName}, Protected: ${isProtected}, Roll: ${roll.toFixed(2)}, User: ${student.play_name}`;

    if (isSuccess) {
      const targetHasEgg = Boolean(teamData[targetIndex][colHasEgg]);
      if (targetHasEgg) {
        teamSheet.getRange(targetIndex + 1, colHasEgg + 1).setValue(false);
        teamSheet.getRange(myTeamIndex + 1, colHasEgg + 1).setValue(true);
        logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "SUCCESS_GOT_EGG");
        return { type: "USE_GLOVE", ok: true, message: `成功偷到金蛋！目標：${targetTeamName}` };
      }
      logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "SUCCESS_EMPTY");
      return { type: "USE_GLOVE", ok: false, message: `潛入成功，但對方沒有金蛋（目標：${targetTeamName}）` };
    }

    logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "FAILED");
    if (isProtected) {
      return { type: "USE_GLOVE", ok: false, message: `偷取失敗：對方使用防護罩（目標：${targetTeamName}）` };
    }
    return { type: "USE_GLOVE", ok: false, message: `偷取失敗：運氣不佳（目標：${targetTeamName}）` };
  }

  throw new Error("Unknown Action");
}

// ★★★ 關鍵修改：強制轉小寫 ★★★
function getRowsAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  // 將 Header 全部轉為小寫 trim
  const headers = values[0].map(h => String(h).trim().toLowerCase());
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function getRow2AsObject_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim().toLowerCase());
  const row2 = values[1] || [];
  const obj = {};
  headers.forEach((h, i) => obj[h] = row2[i]);
  return obj;
}
