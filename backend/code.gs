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

// Cache settings (seconds)
const CACHE_TTL = {
  STATIC: 300, // map/achieve/items rarely change
  ID: 60 // ID list changes infrequently
};

// --- Team Attack (Charge) settings ---
const ATTACK_WINDOW_MS = 20 * 1000;
const ATTACK_STATUS_CACHE_TTL = 120; // seconds
const ATTACK_CLICKS_CACHE_TTL = 600; // seconds
const ATTACK_RESULT_CACHE_TTL = 120; // seconds

function getCachedJson_(key, loaderFn, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }
  const fresh = loaderFn();
  if (fresh) {
    cache.put(key, JSON.stringify(fresh), ttlSeconds);
  }
  return fresh;
}

function getAttackStatusCacheKey_(teamId) {
  return `cache:atk_status:${teamId}`;
}

function getAttackClicksCacheKey_(teamId) {
  return `cache:atk_clicks:${teamId}`;
}

function getAttackResultCacheKey_(teamId) {
  return `cache:atk_result:${teamId}`;
}

function readAttackStatusFromSheet_(ss, teamId) {
  const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS);
  const teamData = teamSheet.getDataRange().getValues();
  const headers = teamData[0].map(h => String(h).trim().toLowerCase());
  const colTeamId = headers.indexOf("team_id");
  const colAttackWindowEnd = headers.indexOf("attack_window_end");
  const colCurrentTargetId = headers.indexOf("current_target_id");
  if (colTeamId === -1) throw new Error("缺少欄位 team_id");
  if (colAttackWindowEnd === -1 || colCurrentTargetId === -1) throw new Error("缺少欄位 attack_window_end / current_target_id");

  let idx = -1;
  for (let i = 1; i < teamData.length; i++) {
    if (String(teamData[i][colTeamId]) === String(teamId)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) throw new Error("找不到隊伍資料");

  return {
    success: true,
    attack_window_end: teamData[idx][colAttackWindowEnd] || "",
    current_target_id: teamData[idx][colCurrentTargetId] || ""
  };
}

function checkAttackStatusFast_(ss, teamId) {
  const cache = CacheService.getScriptCache();
  const key = getAttackStatusCacheKey_(teamId);
  const cached = cache.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      const end = parsed?.attack_window_end ? new Date(parsed.attack_window_end) : null;
      if (end && end > new Date()) return parsed;
      cache.remove(key);
    } catch (e) {
      cache.remove(key);
    }
  }

  const status = readAttackStatusFromSheet_(ss, teamId);
  const end2 = status.attack_window_end ? new Date(status.attack_window_end) : null;
  if (end2 && end2 > new Date()) {
    cache.put(key, JSON.stringify(status), ATTACK_STATUS_CACHE_TTL);
  }
  return status;
}

function checkAttackResultFast_(teamId) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(getAttackResultCacheKey_(teamId));
  if (!cached) return { success: true, result: null };
  try {
    return { success: true, result: JSON.parse(cached) };
  } catch (e) {
    cache.remove(getAttackResultCacheKey_(teamId));
    return { success: true, result: null };
  }
}

function submitClicksFast_(ss, teamId, clicksRaw) {
  const clicks = Math.max(0, Math.floor(Number(clicksRaw || 0)));
  if (!clicks) return { success: true };

  const cache = CacheService.getScriptCache();
  const statusKey = getAttackStatusCacheKey_(teamId);
  let status = null;
  const cached = cache.get(statusKey);
  if (cached) {
    try { status = JSON.parse(cached); } catch (e) {}
  }
  if (!status) {
    // cache miss: 讀一次 sheet，若仍有效就回填 cache 後繼續（避免 cache 被清掉造成隊員點擊全丟）
    const sheetStatus = readAttackStatusFromSheet_(ss, teamId);
    const end = sheetStatus.attack_window_end ? new Date(sheetStatus.attack_window_end) : null;
    if (!end || end <= new Date()) return { success: false, message: "目前沒有攻擊窗口" };
    cache.put(statusKey, JSON.stringify(sheetStatus), ATTACK_STATUS_CACHE_TTL);
    status = sheetStatus;
  }
  const end2 = status.attack_window_end ? new Date(status.attack_window_end) : null;
  if (!end2 || end2 <= new Date()) return { success: false, message: "攻擊窗口已結束" };

  const clicksKey = getAttackClicksCacheKey_(teamId);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(2000);
  } catch (e) {
    return { success: false, message: "系統忙碌中，請稍後再試" };
  }
  try {
    const current = Number(cache.get(clicksKey) || 0);
    cache.put(clicksKey, String(current + clicks), ATTACK_CLICKS_CACHE_TTL);
    lock.releaseLock();
    return { success: true };
  } catch (err) {
    lock.releaseLock();
    return { success: false, message: err.toString() };
  }
}

function getRowsAsObjectsCached_(sheet, cacheKey, ttlSeconds) {
  if (!sheet) return [];
  return getCachedJson_(cacheKey, () => getRowsAsObjects_(sheet), ttlSeconds) || [];
}

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
      if (actionType === "USE_GLOVE") {
        return jsonResponse_({ success: false, message: "USE_GLOVE 已停用，請使用 START_ATTACK（集氣）" });
      }
      // --- Team Attack (Charge) APIs ---
      if (actionType === "CHECK_ATTACK_STATUS") {
        const teamId = String(params.team_id || "").trim();
        const studentId = String(params.student_id || "").trim();
        const password = String(params.pw || "").trim();
        if (!teamId || !studentId) throw new Error("Missing params");
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        
        // 額外驗證
        const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
        const idRows = getRowsAsObjectsCached_(idSheet, "cache:id_rows", CACHE_TTL.ID);
        const student = idRows.find(r => String(r.id) === String(studentId));
        if (!student) throw new Error("無效學生");
        verifyTeamPassword_(ss, student, password);

        return jsonResponse_(checkAttackStatusFast_(ss, teamId));
      }
      if (actionType === "CHECK_ATTACK_RESULT") {
        const teamId = String(params.team_id || "").trim();
        const studentId = String(params.student_id || "").trim();
        const password = String(params.pw || "").trim();
        if (!teamId || !studentId) throw new Error("Missing params");
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        
        // 額外驗證
        const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
        const idRows = getRowsAsObjectsCached_(idSheet, "cache:id_rows", CACHE_TTL.ID);
        const student = idRows.find(r => String(r.id) === String(studentId));
        if (!student) throw new Error("無效學生");
        verifyTeamPassword_(ss, student, password);

        return jsonResponse_(checkAttackResultFast_(teamId));
      }
      if (actionType === "SUBMIT_CLICKS") {
        const teamId = String(params.team_id || "").trim();
        const studentId = String(params.student_id || "").trim();
        const password = String(params.pw || "").trim();
        if (!teamId || !studentId) throw new Error("Missing params");
        const clicks = Number(params.clicks || 0);
        const ss = SpreadsheetApp.getActiveSpreadsheet();

        // 額外驗證
        const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
        const idRows = getRowsAsObjectsCached_(idSheet, "cache:id_rows", CACHE_TTL.ID);
        const student = idRows.find(r => String(r.id) === String(studentId));
        if (!student) throw new Error("無效學生");
        verifyTeamPassword_(ss, student, password);

        return jsonResponse_(submitClicksFast_(ss, teamId, clicks));
      }
      if (actionType === "START_ATTACK" || actionType === "FINALIZE_ATTACK") {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        return jsonResponse_(handleTeamAttackAction_(ss, actionType, params));
      }

      const studentIdForAction = String(params.student_id || "").trim();
      if (!studentIdForAction) throw new Error("Missing student_id");
      return handleActionAndReturnDashboard_(actionType, params, studentIdForAction);
    }

    // 讀取模式
    const studentId = String(params.id || "").trim();
    const password = String(params.pw || "").trim();
    if (!studentId) throw new Error("Missing ID");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return jsonResponse_(buildDashboard_(ss, studentId, password, null));

  } catch (err) {
    return jsonResponse_({ success: false, message: err.toString() });
  }
}

/**
 * 驗證密碼 (從 ID 表的 password 欄位驗證)
 */
function verifyTeamPassword_(ss, student, password) {
  // 從 student 物件中直接獲取預期的密碼
  // 假設 ID 表有 "password" 欄位
  const correctPw = String(student.password || "").trim();
  const inputPw = String(password || "").trim();
  
  if (!correctPw) {
    // 如果 ID 表沒設定密碼，暫時允許通過，或拋出錯誤 (視需求而定)
    // 這裡我們嚴格一點，要求必須設定密碼
    throw new Error("系統錯誤：該帳號未設定密碼，請聯繫管理員");
  }

  if (correctPw !== inputPw) {
    throw new Error("密碼錯誤！");
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
    const { action, student_id, item_id, target_team_name, qty, item_qty } = params;
    
    if (action === "USE_GLOVE") {
      throw new Error("USE_GLOVE 已停用，請使用 START_ATTACK（集氣）");
    }

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

    const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS);
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

      const qtyRaw = (typeof qty !== "undefined" ? qty : (typeof item_qty !== "undefined" ? item_qty : 1));
      const buyQty = Math.floor(Number(qtyRaw || 1));
      if (!buyQty || buyQty < 1) throw new Error("購買數量無效");

      const totalPrice = price * buyQty;
      if (currentMoney < totalPrice) throw new Error("資金不足！");

      teamSheet.getRange(myTeamIndex + 1, colMoney + 1).setValue(currentMoney - totalPrice);
      
      if (item_id === "glove") {
        teamSheet.getRange(myTeamIndex + 1, colGloves + 1).setValue(currentGloves + buyQty);
      } else if (item_id === "shield") {
        teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields + buyQty);
      }

      logToSheet(ss, student.team_name, "BUY", `Bought ${targetItem.item_name} x${buyQty} by ${student.play_name}`, "Success");
      resultMessage = `購買 ${targetItem.item_name} x${buyQty} 成功！`;

    } else if (action === "USE_SHIELD") {
      if (currentShields <= 0) throw new Error("沒有防護罩可使用");

      teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields - 1);
      
      const now = new Date();
      now.setHours(now.getHours() + 1);
      const expiryStr = now.toISOString();
      teamSheet.getRange(myTeamIndex + 1, colShieldExpiry + 1).setValue(expiryStr);

      logToSheet(ss, student.team_name, "USE_SHIELD", `Activated by ${student.play_name}`, expiryStr);
      resultMessage = "防護罩已啟動！1小時內有效。";

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

      const successRate = isProtected ? 0.3 : 0.6;
      const roll = Math.random();
      const isSuccess = roll < successRate;

      let detailLog = `Target: ${target_team_name}, Protected: ${isProtected}, Roll: ${roll.toFixed(2)}, User: ${student.play_name}`;

      if (isSuccess) {
        const targetHasEgg = Boolean(teamData[targetIndex][colHasEgg]);
        
        if (targetHasEgg) {
          teamSheet.getRange(targetIndex + 1, colHasEgg + 1).setValue(false);
          teamSheet.getRange(myTeamIndex + 1, colHasEgg + 1).setValue(true);
          // 金蛋被偷走時，若目標隊伍有防護罩效果，也要一併失效（避免沒金蛋還持續開盾）
          if (colShieldExpiry !== -1) {
            teamSheet.getRange(targetIndex + 1, colShieldExpiry + 1).setValue("");
          }
          resultMessage = "💰 偷竊大成功！你偷到了傳說中的金蛋！快逃啊！";
          logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "SUCCESS_GOT_EGG");
        } else {
          resultMessage = "偷竊成功潛入...但他們家沒有金蛋，空手而回。";
          logToSheet(ss, student.team_name, "STEAL_EGG", detailLog, "SUCCESS_EMPTY");
        }
      } else {
        resultMessage = isProtected 
          ? "對方有防護罩！偷竊失敗！" 
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

function handleTeamAttackAction_(ss, actionType, params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, message: "系統忙碌中，請稍後再試" };
  }

  try {
    const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS);
    const teamData = teamSheet.getDataRange().getValues();
    const headers = teamData[0].map(h => String(h).trim().toLowerCase());

    const colTeamId = headers.indexOf("team_id");
    const colTeamName = headers.indexOf("team_name");
    const colMoney = headers.indexOf("money");
    const colGloves = headers.indexOf("gloves");
    const colShieldExpiry = headers.indexOf("shield_expiry");
    const colHasEgg = headers.indexOf("has_egg");
    const colAttackWindowEnd = headers.indexOf("attack_window_end");
    const colCurrentTargetId = headers.indexOf("current_target_id");
    const colTempClicks = headers.indexOf("temp_clicks");
    const colGloveWindowStart = headers.indexOf("glove_window_start");
    const colGloveWindowCount = headers.indexOf("glove_window_count");
    const colGloveCooldownUntil = headers.indexOf("glove_cooldown_until");

    if (colTeamId === -1) throw new Error("缺少欄位 team_id");
    if (colTeamName === -1) throw new Error("缺少欄位 team_name");
    if (colAttackWindowEnd === -1 || colCurrentTargetId === -1 || colTempClicks === -1) {
      throw new Error("缺少欄位 attack_window_end / current_target_id / temp_clicks");
    }
    if (colGloves === -1) throw new Error("缺少欄位 gloves");
    if (colGloveWindowStart === -1 || colGloveWindowCount === -1 || colGloveCooldownUntil === -1) {
      throw new Error("缺少冷卻欄位：glove_window_start / glove_window_count / glove_cooldown_until");
    }

    const studentId = String(params.student_id || "").trim();
    const password = String(params.pw || "").trim();
    if (!studentId) throw new Error("Missing student_id");
    const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
    const idRows = getRowsAsObjectsCached_(idSheet, "cache:id_rows", CACHE_TTL.ID);
    const student = idRows.find(r => String(r.id) === String(studentId));
    if (!student) throw new Error("無效的學生 ID");

    // 驗證密碼
    verifyTeamPassword_(ss, student, password);

    if (String(student.role || "").trim().toUpperCase() !== "LEADER") {
      throw new Error("只有小隊長可以使用此功能！");
    }

    // 找到隊長所屬隊伍 row
    let attackerIdx = -1;
    for (let i = 1; i < teamData.length; i++) {
      if (String(teamData[i][colTeamName]) === String(student.team_name)) {
        attackerIdx = i;
        break;
      }
    }
    if (attackerIdx === -1) throw new Error("找不到你的隊伍資料");
    const attackerTeamId = String(teamData[attackerIdx][colTeamId]);

    if (actionType === "START_ATTACK") {
      const targetTeamId = String(params.target_team_id || "").trim();
      if (!targetTeamId) throw new Error("Missing target_team_id");

      // 目標存在
      let targetIdx = -1;
      for (let i = 1; i < teamData.length; i++) {
        if (String(teamData[i][colTeamId]) === String(targetTeamId)) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx === -1) throw new Error("目標隊伍不存在");

      // 手套 + 冷卻
      const currentGloves = Number(teamData[attackerIdx][colGloves] || 0);
      if (currentGloves <= 0) throw new Error("沒有黑手套可使用");

      const now = new Date();
      const cooldownRaw = teamData[attackerIdx][colGloveCooldownUntil];
      if (cooldownRaw) {
        const cooldownUntil = new Date(cooldownRaw);
        if (cooldownUntil > now) throw new Error("黑手套冷卻中");
      }

      // 防止重複開窗
      const existingWindowEnd = teamData[attackerIdx][colAttackWindowEnd];
      if (existingWindowEnd && new Date(existingWindowEnd) > now) throw new Error("攻擊正在進行中");

      // 扣手套 + 更新冷卻視窗（與 USE_GLOVE 同規則）
      const windowStartRaw = teamData[attackerIdx][colGloveWindowStart];
      const windowCountRaw = teamData[attackerIdx][colGloveWindowCount];
      const windowStart = windowStartRaw ? new Date(windowStartRaw) : null;
      const windowCount = Math.max(0, Math.floor(Number(windowCountRaw || 0)));
      const within5Min = windowStart ? (now.getTime() - windowStart.getTime() <= 5 * 60 * 1000) : false;
      const nextWindowStart = within5Min ? windowStart : now;
      const nextCount = within5Min ? windowCount + 1 : 1;

      teamSheet.getRange(attackerIdx + 1, colGloves + 1).setValue(currentGloves - 1);
      teamSheet.getRange(attackerIdx + 1, colGloveWindowStart + 1).setValue(nextWindowStart.toISOString());
      teamSheet.getRange(attackerIdx + 1, colGloveWindowCount + 1).setValue(nextCount);

      if (nextCount >= 5) {
        const cdUntil = new Date(now.getTime() + 20 * 60 * 1000);
        teamSheet.getRange(attackerIdx + 1, colGloveCooldownUntil + 1).setValue(cdUntil.toISOString());
        teamSheet.getRange(attackerIdx + 1, colGloveWindowStart + 1).setValue("");
        teamSheet.getRange(attackerIdx + 1, colGloveWindowCount + 1).setValue(0);
      }

      const windowEnd = new Date(now.getTime() + ATTACK_WINDOW_MS);
      const windowEndStr = windowEnd.toISOString();
      teamSheet.getRange(attackerIdx + 1, colAttackWindowEnd + 1).setValue(windowEndStr);
      teamSheet.getRange(attackerIdx + 1, colCurrentTargetId + 1).setValue(String(targetTeamId));
      teamSheet.getRange(attackerIdx + 1, colTempClicks + 1).setValue(0);

      // Cache：狀態 + 點擊歸零
      const cache = CacheService.getScriptCache();
      cache.put(getAttackStatusCacheKey_(attackerTeamId), JSON.stringify({ success: true, attack_window_end: windowEndStr, current_target_id: String(targetTeamId) }), ATTACK_STATUS_CACHE_TTL);
      cache.put(getAttackClicksCacheKey_(attackerTeamId), "0", ATTACK_CLICKS_CACHE_TTL);

      lock.releaseLock();
      return { success: true, attack_window_end: windowEndStr, current_target_id: String(targetTeamId) };
    }

    if (actionType === "FINALIZE_ATTACK") {
      const now = new Date();

      // 讀取目標與窗口（優先 sheet；若 sheet 空但 cache 有，仍可結算）
      let windowEndStr = String(teamData[attackerIdx][colAttackWindowEnd] || "");
      let targetTeamId = String(teamData[attackerIdx][colCurrentTargetId] || "").trim();

      if (!windowEndStr || !targetTeamId) {
        const cached = CacheService.getScriptCache().get(getAttackStatusCacheKey_(attackerTeamId));
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            windowEndStr = String(parsed.attack_window_end || "");
            targetTeamId = String(parsed.current_target_id || "").trim();
          } catch (e) {}
        }
      }
      if (!windowEndStr || !targetTeamId) throw new Error("目前沒有攻擊窗口");

      const windowEnd = new Date(windowEndStr);
      if (windowEnd > now) throw new Error("攻擊窗口尚未結束");

      // 目標 index
      let targetIdx = -1;
      for (let i = 1; i < teamData.length; i++) {
        if (String(teamData[i][colTeamId]) === String(targetTeamId)) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx === -1) throw new Error("目標隊伍不存在");

      const cache = CacheService.getScriptCache();
      const cachedClicks = Math.max(0, Math.floor(Number(cache.get(getAttackClicksCacheKey_(attackerTeamId)) || 0)));
      const sheetClicks = Math.max(0, Math.floor(Number(teamData[attackerIdx][colTempClicks] || 0)));
      const totalClicks = cachedClicks + sheetClicks;

      // 盾判定
      const targetExpiryRaw = colShieldExpiry !== -1 ? teamData[targetIdx][colShieldExpiry] : "";
      let isProtected = false;
      if (targetExpiryRaw) {
        const expiryDate = new Date(targetExpiryRaw);
        if (expiryDate > new Date()) isProtected = true;
      }

      const baseRate = isProtected ? 0.1 : 0.6;
      // 新邏輯：每 20 下 +1%，最高加成 +70% (1400 下即滿)
      const bonusRate = Math.min(0.7, (totalClicks / 20) * 0.01);
      const successRate = Math.min(0.95, baseRate + bonusRate);
      const roll = Math.random();
      const isSuccess = roll < successRate;

      let stolen = false;
      let message = "";
      const attackerTeamName = String(teamData[attackerIdx][colTeamName] || "");
      const targetTeamName = String(teamData[targetIdx][colTeamName] || "");
      const detail = `Target=${targetTeamName}(${targetTeamId}), Clicks=${totalClicks}, Base=${baseRate.toFixed(2)}, Bonus=${bonusRate.toFixed(2)}, Rate=${successRate.toFixed(2)}, Roll=${roll.toFixed(2)}, Protected=${isProtected}`;

      if (isSuccess) {
        const targetHasEgg = Boolean(teamData[targetIdx][colHasEgg]);
        if (targetHasEgg) {
          teamSheet.getRange(targetIdx + 1, colHasEgg + 1).setValue(false);
          teamSheet.getRange(attackerIdx + 1, colHasEgg + 1).setValue(true);
          if (colShieldExpiry !== -1) {
            teamSheet.getRange(targetIdx + 1, colShieldExpiry + 1).setValue("");
          }
          stolen = true;
          message = "偷竊成功！搶到金蛋！";
          logToSheet(ss, attackerTeamName, "TEAM_ATTACK", detail, "SUCCESS_GOT_EGG");
        } else {
          message = "結算成功，但對方沒有金蛋";
          logToSheet(ss, attackerTeamName, "TEAM_ATTACK", detail, "SUCCESS_EMPTY");
        }
      } else {
        // --- 偷竊失敗：偷錢補償機制 ---
        const stealOptions = [100, 150, 200, 250, 300];
        const wantSteal = stealOptions[Math.floor(Math.random() * stealOptions.length)];
        
        const targetMoney = Number(teamData[targetIdx][colMoney] || 0);
        const actualStolen = Math.min(targetMoney, wantSteal);
        
        const attackerMoney = Number(teamData[attackerIdx][colMoney] || 0);
        
        // 更新雙方金錢
        if (actualStolen > 0) {
          teamSheet.getRange(targetIdx + 1, colMoney + 1).setValue(targetMoney - actualStolen);
          teamSheet.getRange(attackerIdx + 1, colMoney + 1).setValue(attackerMoney + actualStolen);
        }

        message = (isProtected ? "偷竊失敗：對方有防護罩" : "偷竊失敗：運氣不佳") + 
                  (actualStolen > 0 ? `，但順手牽羊偷走了 $${actualStolen}！` : "。");
        
        logToSheet(ss, attackerTeamName, "TEAM_ATTACK", detail + `, StolenMoney=${actualStolen}`, "FAILED_BUT_STOLE_MONEY");
      }

      // 清理 sheet
      teamSheet.getRange(attackerIdx + 1, colAttackWindowEnd + 1).setValue("");
      teamSheet.getRange(attackerIdx + 1, colCurrentTargetId + 1).setValue("");
      teamSheet.getRange(attackerIdx + 1, colTempClicks + 1).setValue(0);

      // 清理 cache（狀態/點擊），並寫入結果快取供隊員讀取
      const resultPayload = {
        result_id: String(new Date().getTime()),
        stolen: stolen,
        message: message,
        total_clicks: totalClicks
      };
      cache.put(getAttackResultCacheKey_(attackerTeamId), JSON.stringify(resultPayload), ATTACK_RESULT_CACHE_TTL);
      cache.remove(getAttackStatusCacheKey_(attackerTeamId));
      cache.remove(getAttackClicksCacheKey_(attackerTeamId));

      lock.releaseLock();
      return { success: true, stolen: stolen, message: message, total_clicks: totalClicks, result_id: resultPayload.result_id };
    }

    lock.releaseLock();
    return { success: false, message: "Unknown Action" };
  } catch (err) {
    lock.releaseLock();
    return { success: false, message: err.toString() };
  }
}

function handleActionAndReturnDashboard_(actionType, params, studentId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return jsonResponse_({ success: false, message: "系統忙碌中，請稍後再試" });
  }

  try {
    const password = String(params.pw || "").trim();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const actionResult = runAction_(ss, actionType, params, studentId, password);
    const dashboard = buildDashboard_(ss, studentId, password, actionResult);
    lock.releaseLock();
    return jsonResponse_(dashboard);
  } catch (err) {
    lock.releaseLock();
    return jsonResponse_({ success: false, message: err.toString() });
  }
}

function buildDashboard_(ss, studentId, password, actionResultOrNull) {
  // 1. 驗證學生
  const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
  const idRows = getRowsAsObjectsCached_(idSheet, "cache:id_rows", CACHE_TTL.ID);
  const student = idRows.find(r => String(r.id) === String(studentId));
  if (!student) throw new Error("無效的學生 ID");

  // 驗證密碼
  verifyTeamPassword_(ss, student, password);

  // 2. 獲取隊伍資料
  const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS);
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
    const allItems = getRowsAsObjectsCached_(itemSheet, "cache:item_rows", CACHE_TTL.STATIC);
    shopItems = allItems.filter(i => i.item_id && i.price).slice(0, 2);
  }

  // 5. 全域狀態
  const statusSheet = getSheetByNameSafe_(ss, SHEET_NAMES.STATUS);
  const statusRow = statusSheet ? getRow2AsObject_(statusSheet) : {};

  const mapSheet = getSheetByNameSafe_(ss, SHEET_NAMES.MAP_INFO);
  const mapRows = mapSheet ? getRowsAsObjectsCached_(mapSheet, "cache:map_rows", CACHE_TTL.STATIC) : [];
  const mapInfo = mapRows.find(r => String(r.location_name) === String(statusRow.location_name));

  const achieveSheet = getSheetByNameSafe_(ss, SHEET_NAMES.ACHIEVE_INFO);
  const achieveRows = achieveSheet ? getRowsAsObjectsCached_(achieveSheet, "cache:achieve_rows", CACHE_TTL.STATIC) : [];
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
      team_id: String(myTeam.team_id || ""),
      money: Number(myTeam.money || 0),
      exp: Number(myTeam.exp || 0),
      has_egg: Boolean(myTeam.has_egg),
      gloves: Number(myTeam.gloves || 0),
      shields: Number(myTeam.shields || 0),
      shield_expiry: myTeam.shield_expiry || "",
      glove_cooldown_until: myTeam.glove_cooldown_until || "",
      is_shield_active: isShieldActive
    },
    other_teams: otherTeams,
    shop_items: shopItems,
    global: {
      location: {
        id: String(statusRow.location_id || ""),
        name: String(statusRow.location_name || ""),
        description: mapInfo ? String(mapInfo.description) : ""
      },
      achievements: achievements
    }
  };

  return res;
}

function runAction_(ss, actionType, params, studentId, password) {
  // 驗證學生與 role
  const idSheet = getRequiredSheet_(ss, SHEET_NAMES.ID);
  const idRows = getRowsAsObjectsCached_(idSheet, "cache:id_rows", CACHE_TTL.ID);
  const student = idRows.find(r => String(r.id) === String(studentId));
  if (!student) throw new Error("無效的學生 ID");

  // 驗證密碼
  verifyTeamPassword_(ss, student, password);

  if (String(student.role || "").trim().toUpperCase() !== "LEADER") {
    throw new Error("只有小隊長可以使用此功能！");
  }

  const teamSheet = getRequiredSheet_(ss, SHEET_NAMES.TEAMS);
  const teamData = teamSheet.getDataRange().getValues();
  const headers = teamData[0].map(h => String(h).trim().toLowerCase());

  const colTeamName = headers.indexOf("team_name");
  const colMoney = headers.indexOf("money");
  const colGloves = headers.indexOf("gloves");
  const colShields = headers.indexOf("shields");
  const colShieldExpiry = headers.indexOf("shield_expiry");
  const colHasEgg = headers.indexOf("has_egg");
  // 黑手套冷卻系統（Teams 表需新增以下欄位）
  // - glove_window_start: ISO string（5 分鐘視窗起點）
  // - glove_window_count: number（視窗內已使用次數）
  // - glove_cooldown_until: ISO string（冷卻結束時間）
  const colGloveWindowStart = headers.indexOf("glove_window_start");
  const colGloveWindowCount = headers.indexOf("glove_window_count");
  const colGloveCooldownUntil = headers.indexOf("glove_cooldown_until");

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
    const items = getRowsAsObjectsCached_(itemSheet, "cache:item_rows", CACHE_TTL.STATIC);
    const targetItem = items.find(i => String(i.item_id) === itemId);
    if (!targetItem) throw new Error("商品不存在");
    const price = Number(targetItem.price);
    const qtyRaw = String(params.qty || params.item_qty || "1").trim();
    const buyQty = Math.floor(Number(qtyRaw || 1));
    if (!buyQty || buyQty < 1) throw new Error("購買數量無效");

    const totalPrice = price * buyQty;
    if (currentMoney < totalPrice) throw new Error("資金不足！");

    teamSheet.getRange(myTeamIndex + 1, colMoney + 1).setValue(currentMoney - totalPrice);
    if (itemId === "glove") {
      teamSheet.getRange(myTeamIndex + 1, colGloves + 1).setValue(currentGloves + buyQty);
    } else if (itemId === "shield") {
      teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields + buyQty);
    }

    logToSheet(ss, student.team_name, "BUY", `Bought ${targetItem.item_name} x${buyQty} by ${student.play_name}`, "Success");
    return { type: "BUY", ok: true, message: `購買成功：${targetItem.item_name} x${buyQty}` };
  }

  if (actionType === "USE_SHIELD") {
    if (currentShields <= 0) throw new Error("沒有防護罩可使用");

    teamSheet.getRange(myTeamIndex + 1, colShields + 1).setValue(currentShields - 1);
    const now = new Date();
    now.setHours(now.getHours() + 1);
    const expiryStr = now.toISOString();
    teamSheet.getRange(myTeamIndex + 1, colShieldExpiry + 1).setValue(expiryStr);

    logToSheet(ss, student.team_name, "USE_SHIELD", `Activated by ${student.play_name}`, expiryStr);
    return { type: "USE_SHIELD", ok: true, message: "防護罩已啟動（1 小時）" };
  }

  if (actionType === "USE_GLOVE") {
    if (currentGloves <= 0) throw new Error("沒有黑手套可使用");
    const targetTeamName = String(params.target_team_name || "").trim();
    if (!targetTeamName) throw new Error("未指定偷竊目標");
    if (targetTeamName === String(student.team_name)) throw new Error("不能偷自己！");

    // --- 黑手套 CD 規則 ---
    // 5 分鐘內使用第 5 次後，進入 20 分鐘冷卻（第五次仍允許出手）
    if (colGloveWindowStart === -1 || colGloveWindowCount === -1 || colGloveCooldownUntil === -1) {
      throw new Error("缺少冷卻欄位：請在 Teams 新增 glove_window_start / glove_window_count / glove_cooldown_until");
    }

    const now = new Date();
    const cooldownRaw = teamData[myTeamIndex][colGloveCooldownUntil];
    if (cooldownRaw) {
      const cooldownUntil = new Date(cooldownRaw);
      if (cooldownUntil > now) {
        const remainingMs = cooldownUntil.getTime() - now.getTime();
        const remainingSec = Math.ceil(remainingMs / 1000);
        const mm = Math.floor(remainingSec / 60);
        const ss2 = remainingSec % 60;
        throw new Error(`黑手套冷卻中：${mm}:${String(ss2).padStart(2, "0")}`);
      }
    }

    const windowStartRaw = teamData[myTeamIndex][colGloveWindowStart];
    const windowCountRaw = teamData[myTeamIndex][colGloveWindowCount];
    const windowStart = windowStartRaw ? new Date(windowStartRaw) : null;
    const windowCount = Math.max(0, Math.floor(Number(windowCountRaw || 0)));
    const within5Min = windowStart ? (now.getTime() - windowStart.getTime() <= 5 * 60 * 1000) : false;

    let nextWindowStart = within5Min ? windowStart : now;
    let nextCount = within5Min ? windowCount + 1 : 1;

    // 先寫回視窗統計
    teamSheet.getRange(myTeamIndex + 1, colGloveWindowStart + 1).setValue(nextWindowStart.toISOString());
    teamSheet.getRange(myTeamIndex + 1, colGloveWindowCount + 1).setValue(nextCount);

    if (nextCount >= 5) {
      const cdUntil = new Date(now.getTime() + 20 * 60 * 1000);
      teamSheet.getRange(myTeamIndex + 1, colGloveCooldownUntil + 1).setValue(cdUntil.toISOString());
      // 重置視窗，避免冷卻結束後立刻因舊數據觸發
      teamSheet.getRange(myTeamIndex + 1, colGloveWindowStart + 1).setValue("");
      teamSheet.getRange(myTeamIndex + 1, colGloveWindowCount + 1).setValue(0);
    }

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

    const successRate = isProtected ? 0.3 : 0.6;
    const roll = Math.random();
    const isSuccess = roll < successRate;

    let detailLog = `Target: ${targetTeamName}, Protected: ${isProtected}, Roll: ${roll.toFixed(2)}, User: ${student.play_name}`;

    if (isSuccess) {
      const targetHasEgg = Boolean(teamData[targetIndex][colHasEgg]);
      if (targetHasEgg) {
        teamSheet.getRange(targetIndex + 1, colHasEgg + 1).setValue(false);
        teamSheet.getRange(myTeamIndex + 1, colHasEgg + 1).setValue(true);
        // 金蛋被偷走時，若目標隊伍有防護罩效果，也要一併失效（避免沒金蛋還持續開盾）
        if (colShieldExpiry !== -1) {
          teamSheet.getRange(targetIndex + 1, colShieldExpiry + 1).setValue("");
        }
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
