import React, { useEffect, useRef, useState } from 'react';
import { Coins, Info, MapPin, Trophy, X, ShoppingBag, Shield, Hand, Egg, Star, Lock, CheckCircle, XCircle, Anchor, Martini, Dumbbell, Wand2, Music, Gem } from 'lucide-react';
import type { ApiResponse, AchievementData, ShopItem } from './types';

// ★★★ 請確認此處網址為最新部署版本 ★★★
const API_URL = "https://script.google.com/macros/s/AKfycbzY581zhk_lGnZ3Bjh9Nk0wrWlqjWksfG6taYEoC4RoBfZv6zqxVpzhSIYKfjRDoNMQSA/exec";

// 自動更新間隔 (毫秒)
// 行動改為「同一個 response 回傳最新 dashboard」後，可以降低輪詢頻率
const POLLING_INTERVAL = 10000;
const LS_ID_KEY = 'camp_student_id';
const LS_CACHE_PREFIX = 'camp_dashboard_cache_v1:'; // + studentId

// 預先載入所有地圖圖片
// 確保路徑完全匹配，包含 ./ 前綴
const mapImages = import.meta.glob('./assets/*.png', { eager: true, import: 'default' }) as Record<string, string>;

const getTeamIcon = (teamName: string) => {
  if (teamName.includes('派瑞特')) return <Anchor size={20} strokeWidth={3} />;
  if (teamName.includes('莫吉托')) return <Martini size={20} strokeWidth={3} />;
  if (teamName.includes('海格力士')) return <Dumbbell size={20} strokeWidth={3} />;
  if (teamName.includes('魔卡洛斯')) return <Wand2 size={20} strokeWidth={3} />;
  if (teamName.includes('柴可夫')) return <Music size={20} strokeWidth={3} />;
  if (teamName.includes('梅林')) return <Gem size={20} strokeWidth={3} />;
  return <Shield size={20} strokeWidth={3} />;
};

function App() {
  const [inputId, setInputId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("正在與雞哥進行連接...");
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [resultModal, setResultModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error';
    title: string;
    message: string;
  }>({ isOpen: false, type: 'success', title: '', message: '' });
  
  const [data, setData] = useState<ApiResponse | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementData | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [shopQtyByItemId, setShopQtyByItemId] = useState<Record<string, number>>({});
  
  const [targetTeamId, setTargetTeamId] = useState<string>('');
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [isChargeOpen, setIsChargeOpen] = useState(false);
  const [chargeClicks, setChargeClicks] = useState(0);
  const [chargeWindowEnd, setChargeWindowEnd] = useState<string>('');
  const [chargeTargetId, setChargeTargetId] = useState<string>('');
  const [lastAttackResultId, setLastAttackResultId] = useState<string>('');
  
  // 修改：控制道具彈窗狀態 (取代展開)
  const [activeItemModal, setActiveItemModal] = useState<null | 'shield' | 'glove'>(null);

  // 權限判斷修正
  const rawRole = data?.player?.role || '';
  const isLeader = rawRole.trim().toUpperCase() === 'LEADER';
  
  const pollTimerRef = useRef<number | null>(null);
  const fetchInFlightRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const chargeClicksRef = useRef(0);
  const chargeSubmitTimerRef = useRef<number | null>(null);
  const finalizeTimerRef = useRef<number | null>(null);

  // 用於判斷是否已有記憶的 ID
  const savedId = localStorage.getItem(LS_ID_KEY) || '';

  // --- API Calls ---

  const fetchDashboardData = async (studentId: string, pw: string, options?: { force?: boolean }) => {
    const trimmedId = studentId.trim();
    if (!trimmedId) return null;

    if (fetchInFlightRef.current && !options?.force) return null;
    fetchInFlightRef.current = true;
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    try {
      const qs = new URLSearchParams();
      qs.set('id', trimmedId);
      qs.set('pw', pw);
      qs.set('t', String(Date.now()));
      const response = await fetch(`${API_URL}?${qs.toString()}`, { signal: controller.signal });
      const json = await response.json();
      return json;
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        console.error("Fetch error:", err);
      }
      return null;
    } finally {
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
      }
      fetchInFlightRef.current = false;
    }
  };

  const handleAction = async (action: 'BUY' | 'USE_SHIELD' | 'USE_GLOVE', itemId?: string, targetName?: string, qty?: number) => {
    if (!data?.player?.id || !password) return;

    // 先跳彈窗（體感更快）
    setResultModal({
      isOpen: true,
      type: 'success',
      title: '處理中…',
      message: '請稍等 1～2 秒'
    });
    // 關閉道具彈窗
    setActiveItemModal(null);

    if (!isLeader) {
      setResultModal({
        isOpen: true,
        type: 'error',
        title: '權限不足',
        message: '只有小隊長可以使用此功能！'
      });
      return;
    }

    setActionLoading(true);
    try {
      const timestamp = Date.now();
      const qs = new URLSearchParams();
      qs.set('action', action);
      qs.set('student_id', data.player.id);
      qs.set('pw', password);
      qs.set('t', String(timestamp));
      if (itemId) qs.set('item_id', itemId);
      if (targetName) qs.set('target_team_name', targetName);
      if (action === 'BUY' && typeof qty === 'number') qs.set('qty', String(qty));

      const res = await fetch(`${API_URL}?${qs.toString()}`);
      const json: ApiResponse = await res.json();

      if (!json.success) {
        setResultModal({
          isOpen: true,
          type: 'error',
          title: '行動失敗',
          message: json.message || '未知錯誤'
        });
        return;
      }

      // 後端會把最新 dashboard 一起回傳：立即更新畫面
      setData(json);
      localStorage.setItem(`${LS_CACHE_PREFIX}${json.player?.id || data.player.id}`, JSON.stringify({ t: Date.now(), data: json }));

      // 行動成功後，關閉彈窗與清空目標
      setTargetTeamId('');

      const ok = json.action?.ok ?? true;
      setResultModal({
        isOpen: true,
        type: ok ? 'success' : 'error',
        title: ok ? '成功' : '失敗',
        message: json.message || '完成'
      });
    } catch (err) {
      console.error(err);
      setResultModal({
        isOpen: true,
        type: 'error',
        title: '連線錯誤',
        message: '網路連線異常，請稍後再試'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const checkAttackStatus = async (teamId: string) => {
    if (!data?.player?.id || !password) return { success: false };
    const qs = new URLSearchParams();
    qs.set('action', 'CHECK_ATTACK_STATUS');
    qs.set('team_id', teamId);
    qs.set('student_id', data.player.id);
    qs.set('pw', password);
    qs.set('t', String(Date.now()));
    const res = await fetch(`${API_URL}?${qs.toString()}`);
    return res.json();
  };

  const submitClicks = async (teamId: string, clicks: number) => {
    if (!data?.player?.id || !password) return { success: false };
    const qs = new URLSearchParams();
    qs.set('action', 'SUBMIT_CLICKS');
    qs.set('team_id', teamId);
    qs.set('clicks', String(clicks));
    qs.set('student_id', data.player.id);
    qs.set('pw', password);
    qs.set('t', String(Date.now()));
    const res = await fetch(`${API_URL}?${qs.toString()}`);
    return res.json();
  };

  const checkAttackResult = async (teamId: string) => {
    if (!data?.player?.id || !password) return { success: false };
    const qs = new URLSearchParams();
    qs.set('action', 'CHECK_ATTACK_RESULT');
    qs.set('team_id', teamId);
    qs.set('student_id', data.player.id);
    qs.set('pw', password);
    qs.set('t', String(Date.now()));
    const res = await fetch(`${API_URL}?${qs.toString()}`);
    return res.json();
  };

  const startAttack = async (attackerTeamId: string, targetTeamIdParam: string) => {
    if (!data?.player?.id || !password) return { success: false };
    const qs = new URLSearchParams();
    qs.set('action', 'START_ATTACK');
    qs.set('attacker_team_id', attackerTeamId);
    qs.set('target_team_id', targetTeamIdParam);
    qs.set('student_id', data.player.id);
    qs.set('pw', password);
    qs.set('t', String(Date.now()));
    const res = await fetch(`${API_URL}?${qs.toString()}`);
    return res.json();
  };

  const finalizeAttack = async (attackerTeamId: string) => {
    if (!data?.player?.id || !password) return { success: false };
    const qs = new URLSearchParams();
    qs.set('action', 'FINALIZE_ATTACK');
    qs.set('attacker_team_id', attackerTeamId);
    qs.set('student_id', data.player.id);
    qs.set('pw', password);
    qs.set('t', String(Date.now()));
    const res = await fetch(`${API_URL}?${qs.toString()}`);
    return res.json();
  };

  // --- Auth & Init ---

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = savedId || inputId.trim();
    if (!targetId || !password.trim()) {
      setError("請輸入 ID 與密碼");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const json = await fetchDashboardData(targetId, password.trim());
      if (json && json.success) {
        setData(json);
        setIsLoggedIn(true);
        localStorage.setItem(LS_ID_KEY, targetId);
        localStorage.setItem(`${LS_CACHE_PREFIX}${targetId}`, JSON.stringify({ t: Date.now(), data: json }));
      } else {
        setError(json?.message || "登入失敗，請確認 ID 與密碼");
      }
    } catch (err) {
      setError("網路連線錯誤");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setData(null);
    setPassword('');
    // 不清除 LS_ID_KEY，讓下次開啟時還記得 ID
  };

  const handleSwitchAccount = () => {
    localStorage.removeItem(LS_ID_KEY);
    window.location.reload();
  };

  useEffect(() => {
    const init = async () => {
      const savedId = localStorage.getItem(LS_ID_KEY) || '';
      if (!savedId) return;
      setInputId(savedId);

      // 注意：這裡不自動登入，因為我們需要密碼
      // 僅載入快取用於顯示介面（若有）
      const cachedRaw = localStorage.getItem(`${LS_CACHE_PREFIX}${savedId}`);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.data && cached.data.success) {
            // 先不設定為 isLoggedIn，除非我們有了密碼並重新驗證
          }
        } catch {}
      }
    };
    void init();
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !data?.player?.id || !password) {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const playerId = data.player.id;
    const currentPw = password;

    const startPolling = () => {
      pollTimerRef.current = window.setInterval(async () => {
        if (document.visibilityState !== 'visible') return;
        const json = await fetchDashboardData(playerId, currentPw);
        if (json && json.success) {
          setData(() => json);
          localStorage.setItem(`${LS_CACHE_PREFIX}${playerId}`, JSON.stringify({ t: Date.now(), data: json }));
        }
      }, POLLING_INTERVAL);
    };

    startPolling();

    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
      }
    };
  }, [isLoggedIn, data?.player?.id]);

  // 登入文案輪播
  useEffect(() => {
    if (!loading) return;
    const messages = ["正在與雞哥進行連接...", "凱因斯計算模型中..."];
    let idx = 0;
    const timer = window.setInterval(() => {
      idx = (idx + 1) % messages.length;
      setLoadingMessage(messages[idx]);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loading]);

  // 倒數計時用（提高頻率讓進度條流暢）
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const submitPendingClicks = async (teamId: string) => {
    const pending = chargeClicksRef.current;
    if (pending <= 0) return;
    chargeClicksRef.current = 0;
    try {
      await submitClicks(teamId, pending);
    } catch (err) {
      console.error(err);
    }
  };

  // SyncManager：輪詢攻擊窗口（每 3 秒）
  useEffect(() => {
    if (!isLoggedIn || !data?.my_team?.team_id) return;
    const teamId = data.my_team.team_id;
    const timer = window.setInterval(async () => {
      try {
        const json = await checkAttackStatus(teamId);
        if (!json?.success) return;
        const windowEnd = String(json.attack_window_end || "");
        const targetId = String(json.current_target_id || "");
        const isValidWindow = Boolean(windowEnd) && !Number.isNaN(new Date(windowEnd).getTime()) && new Date(windowEnd) > new Date();
        if (isValidWindow && targetId) {
          setChargeWindowEnd(windowEnd);
          setChargeTargetId(targetId);
          setIsChargeOpen(true);
        } else {
          // 隊員：窗口結束就關閉
          // 隊長：保留結束時間與目標，讓結算流程能跑完
          if (!isLeader) {
            setChargeWindowEnd("");
            setChargeTargetId("");
            setIsChargeOpen(false);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isLoggedIn, data?.my_team?.team_id, isLeader]);

  // 集氣期間：每 5 秒上傳一次點擊
  useEffect(() => {
    if (!isChargeOpen || !data?.my_team?.team_id) return;
    const teamId = data.my_team.team_id;
    if (chargeSubmitTimerRef.current) {
      window.clearInterval(chargeSubmitTimerRef.current);
    }
    chargeSubmitTimerRef.current = window.setInterval(() => {
      void submitPendingClicks(teamId);
    }, 2000);
    return () => {
      if (chargeSubmitTimerRef.current) {
        window.clearInterval(chargeSubmitTimerRef.current);
        chargeSubmitTimerRef.current = null;
      }
      void submitPendingClicks(teamId);
    };
  }, [isChargeOpen, data?.my_team?.team_id]);

  // 隊長自動結算（以攻擊結束時間排程）
  useEffect(() => {
    if (!isLeader || !data?.my_team?.team_id || !chargeWindowEnd) return;
    const teamId = data.my_team.team_id;
    const windowEnd = new Date(chargeWindowEnd);
    const delayMs = Math.max(0, windowEnd.getTime() - Date.now() + 1000);
    if (finalizeTimerRef.current) return;
    finalizeTimerRef.current = window.setTimeout(async () => {
      await submitPendingClicks(teamId);
      const json = await finalizeAttack(teamId);
      setIsChargeOpen(false);
      setChargeWindowEnd("");
      setChargeTargetId("");
      setChargeClicks(0);
      chargeClicksRef.current = 0;

      if (!json?.success) {
        setResultModal({
          isOpen: true,
          type: 'error',
          title: '結算失敗',
          message: json?.message || '未知錯誤'
        });
      } else {
        if (json?.result_id) setLastAttackResultId(String(json.result_id));
        setResultModal({
          isOpen: true,
          type: json.stolen ? 'success' : 'error',
          title: json.stolen ? '偷竊成功' : '偷竊失敗',
          message: json.message || (json.stolen ? '成功奪回金蛋' : '未能偷到金蛋')
        });
        if (data?.player?.id) {
          const refreshed = await fetchDashboardData(data.player.id, password, { force: true });
          if (refreshed && refreshed.success) {
            setData(refreshed);
          }
        }
      }
      finalizeTimerRef.current = null;
    }, delayMs);
    return () => {
      if (finalizeTimerRef.current) {
        window.clearTimeout(finalizeTimerRef.current);
        finalizeTimerRef.current = null;
      }
    };
  }, [chargeWindowEnd, isLeader, data?.my_team?.team_id, data?.player?.id]);

  // 一般隊員：輪詢結果，結束後顯示彈窗
  useEffect(() => {
    if (!isLoggedIn || !data?.my_team?.team_id || isLeader) return;
    const teamId = data.my_team.team_id;
    const timer = window.setInterval(async () => {
      try {
        const json = await checkAttackResult(teamId);
        const result = json?.result;
        if (!result?.result_id) return;
        if (String(result.result_id) === lastAttackResultId) return;
        setLastAttackResultId(String(result.result_id));
        setResultModal({
          isOpen: true,
          type: result.stolen ? 'success' : 'error',
          title: result.stolen ? '偷竊成功' : '偷竊失敗',
          message: result.message || (result.stolen ? '成功奪回金蛋' : '未能偷到金蛋')
        });
      } catch (err) {
        console.error(err);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isLoggedIn, data?.my_team?.team_id, isLeader, lastAttackResultId]);

  // 開啟新一輪集氣時重置
  useEffect(() => {
    if (!isChargeOpen) {
      setChargeClicks(0);
      chargeClicksRef.current = 0;
    }
  }, [isChargeOpen]);


  const handleChargeClick = () => {
    if (!isAttackActive) return;
    chargeClicksRef.current += 1;
    setChargeClicks(prev => prev + 1);
  };

  const handleStartAttack = async () => {
    if (!data?.my_team?.team_id) {
      setResultModal({
        isOpen: true,
        type: 'error',
        title: '缺少隊伍 ID',
        message: '請確認 Teams 表有 team_id，並重新部署後再試一次。'
      });
      return;
    }
    if (!targetTeamId) {
      setResultModal({
        isOpen: true,
        type: 'error',
        title: '請先選擇目標',
        message: '請先選擇要偷竊的隊伍'
      });
      return;
    }
    if (!isLeader) {
      setResultModal({
        isOpen: true,
        type: 'error',
        title: '權限不足',
        message: '只有小隊長可以發起攻擊'
      });
      return;
    }
    setActionLoading(true);
    try {
      const json = await startAttack(data.my_team.team_id, targetTeamId);
      if (!json?.success) {
        setResultModal({
          isOpen: true,
          type: 'error',
          title: '發起失敗',
          message: json?.message || '未知錯誤'
        });
        return;
      }
      setActiveItemModal(null);
      setChargeWindowEnd(String(json.attack_window_end || ""));
      setChargeTargetId(String(json.current_target_id || targetTeamId));
      setIsChargeOpen(true);
      setChargeClicks(0);
      chargeClicksRef.current = 0;
      setTargetTeamId('');
    } catch (err) {
      console.error(err);
      setResultModal({
        isOpen: true,
        type: 'error',
        title: '連線錯誤',
        message: '網路連線異常，請稍後再試'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const closeAllModals = () => {
    setSelectedAchievement(null);
    setIsLocationModalOpen(false);
    setIsShopOpen(false);
    setActiveItemModal(null);
    setResultModal(prev => ({ ...prev, isOpen: false }));
  };

  // --- UI Renders ---

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#fdf6e3]">
        <div className="w-full max-w-md relative z-10">
          <div className="doodle-card bg-[#FF6B6B] p-8 -rotate-1 rounded-3xl">
            <h1 className="text-5xl font-weird text-white mb-8 text-center drop-shadow-[4px_4px_0px_rgba(0,0,0,1)]">
              經濟之國
            </h1>
            <form onSubmit={handleLogin} className="space-y-4">
              {savedId ? (
                <div className="space-y-2">
                  <div className="bg-white/20 border-2 border-white/30 p-3 rounded-xl text-white text-center">
                    <p className="text-sm font-bold opacity-80">歡迎回來</p>
                    <p className="text-2xl font-black">ID: {savedId}</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={handleSwitchAccount}
                    className="w-full text-xs text-yellow-200 underline font-bold"
                  >
                    切換其他帳號
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="輸入 ID (e.g. 1001)"
                  value={inputId}
                  onChange={(e) => setInputId(e.target.value)}
                  className="w-full px-4 py-4 bg-white border-4 border-black text-2xl font-bold rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                />
              )}
              
              <input
                type="password"
                placeholder="輸入隊伍密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-4 bg-white border-4 border-black text-2xl font-bold rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              />

              {error && <div className="bg-white border-4 border-black p-2 text-red-600 font-bold">{error}</div>}
              
              <button type="submit" disabled={loading} className="w-full bg-yellow-400 doodle-btn py-4 text-xl rounded-xl hover:bg-yellow-300">
                {loading ? loadingMessage : "開始遊戲"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (!data || !data.player || !data.my_team) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fdf6e3]">
        <div className="text-2xl font-black animate-bounce">
          資料讀取中...
        </div>
        <button onClick={() => { setIsLoggedIn(false); localStorage.removeItem(LS_ID_KEY); window.location.reload(); }} className="absolute bottom-10 text-sm underline text-gray-500">
          卡住了？點此重置
        </button>
      </div>
    );
  }

  const isShieldActive = Boolean(data.my_team.is_shield_active);
  const shieldUntil = data.my_team.shield_expiry ? new Date(data.my_team.shield_expiry) : null;
  const gloveCooldownUntil = data.my_team.glove_cooldown_until ? new Date(data.my_team.glove_cooldown_until) : null;
  const gloveCooldownRemainingMs = gloveCooldownUntil ? gloveCooldownUntil.getTime() - nowTick : 0;
  const isGloveOnCooldown = gloveCooldownRemainingMs > 0;
  const gloveCooldownLabel = isGloveOnCooldown
    ? (() => {
        const s = Math.ceil(gloveCooldownRemainingMs / 1000);
        const mm = Math.floor(s / 60);
        const ss = s % 60;
        return `${mm}:${String(ss).padStart(2, '0')}`;
      })()
    : '';
  // 前5個隊伍 (排除自己) 用於偷竊列表
  const otherTeams5 = (data.other_teams || []).slice(0, 5);
  const attackWindowEndDate = chargeWindowEnd ? new Date(chargeWindowEnd) : null;
  const attackRemainingMs = attackWindowEndDate ? attackWindowEndDate.getTime() - nowTick : 0;
  const attackRemainingSec = Math.max(0, Math.ceil(attackRemainingMs / 1000));
  const isAttackActive = attackRemainingMs > 0;
  const attackProgressPercent = Math.max(0, Math.min(100, (attackRemainingMs / (20 * 1000)) * 100));
  const currentTargetName = (data.other_teams || []).find(t => String(t.team_id) === String(chargeTargetId))?.team_name || "未知目標";

  return (
    <div className={`min-h-screen pb-24 relative overflow-x-hidden ${data.my_team.has_egg ? 'bg-yellow-50' : 'bg-[#fdf6e3]'} text-black font-sans transition-colors duration-500`}>
      
      {/* Golden Egg Alert Banner */}
      {data.my_team.has_egg && (
        <div className="fixed top-0 left-0 w-full bg-yellow-400 border-b-4 border-black z-50 py-2 px-4 shadow-lg animate-pulse flex items-center justify-center gap-2">
          <Egg className="animate-bounce" size={24} strokeWidth={3} />
          <span className="font-black text-[13px] sm:text-lg whitespace-nowrap">你的隊伍有金蛋，快開啟防護罩</span>
        </div>
      )}

      {/* Header */}
      <header className={`p-4 mb-2 transition-all duration-300 ${data.my_team.has_egg ? 'mt-12' : ''}`}>
        <div className="max-w-lg mx-auto flex justify-between items-center bg-white border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 rounded-2xl rotate-1">
          <div>
            <div className="flex items-center gap-2">
              <span className={`border-2 border-black text-white px-2 py-0.5 text-xs font-bold rounded ${isLeader ? 'bg-purple-500' : 'bg-blue-400'}`}>
                {isLeader ? 'LEADER' : 'PLAYER'}
              </span>
              <span className="font-black text-sm">ID: {data.player.id}</span>
            </div>
            <p className="text-xl font-black mt-1">玩家：{data.player.name}</p>
            <p className="text-xs font-bold text-gray-500 mt-1">歡迎來到經濟之國</p>
          </div>
          <button onClick={handleLogout} className="bg-red-400 text-white font-bold border-2 border-black px-3 py-1 rounded-xl text-sm -rotate-2 hover:translate-y-1">
            登出
          </button>
        </div>
      </header>

      <div className="px-4 space-y-6 max-w-lg mx-auto relative z-20">
        
        {/* 1. 隊伍資源 (My Team) */}
        <div className={`doodle-card p-5 rounded-3xl -rotate-1 relative transition-colors duration-300 ${data.my_team.has_egg ? 'bg-yellow-300 ring-4 ring-yellow-500 ring-offset-4' : 'bg-[#4ECDC4]'}`}>
          <div className="flex flex-col mb-4">
            <h2 className="text-3xl font-black flex items-center gap-2 flex-wrap text-white drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]">
              {getTeamIcon(data.player.team)}
              {data.player.team}
              {isShieldActive && (
                 <span className="text-sm bg-blue-600 text-white px-2 py-1 rounded-full border-2 border-white animate-pulse shadow-sm flex items-center gap-1">
                    <Shield size={12} fill="currentColor" /> 防護生效中
                 </span>
              )}
            </h2>
            
            {/* EXP 移到這裡當小標 */}
            <div className="mt-1 flex items-center gap-2 text-white/90 font-bold text-sm">
                <Star size={14} className="fill-yellow-300 text-yellow-500" />
                EXP: {data.my_team.exp}
                {isShieldActive && shieldUntil && (
                  <span className="text-xs opacity-80">
                    (至 {shieldUntil.getHours()}:{String(shieldUntil.getMinutes()).padStart(2, '0')})
                  </span>
                )}
            </div>
          </div>

          {data.my_team.has_egg && (
            <div className="absolute top-4 right-4 animate-bounce">
              <Egg size={40} className="fill-yellow-400 text-black drop-shadow-md" />
            </div>
          )}

          {/* 金幣放大 */}
          <div className="bg-white border-4 border-black p-4 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between">
            <div className="text-sm font-black text-gray-400">ASSETS</div>
            <p className="text-4xl font-black text-green-600 flex items-center gap-2">
              <Coins size={32} strokeWidth={3} className="text-yellow-500 fill-yellow-300" /> 
              {Number(data.my_team.money).toLocaleString()}
            </p>
          </div>
        </div>

        {/* 2. 背包與商店區塊 */}
        <div>
          <div className="flex justify-between items-center mb-3 px-2">
            <h3 className="text-xl font-black flex items-center gap-2">
              <div className="bg-black text-white p-1 rounded"><ShoppingBag size={16}/></div>
              背包與道具
            </h3>
            
            <button 
              onClick={() => {
                const next: Record<string, number> = {};
                (data?.shop_items || []).forEach((it) => {
                  next[it.item_id] = Math.max(1, Number(shopQtyByItemId[it.item_id] || 1));
                });
                setShopQtyByItemId(next);
                setIsShopOpen(true);
              }}
              className="bg-[#FFD93D] border-2 border-black px-3 py-1 rounded-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none transition-all flex items-center gap-1 font-bold text-sm rotate-1"
            >
              <ShoppingBag size={14} /> 商店
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {/* 防護罩卡片 */}
            <div
              className={`doodle-card p-3 rounded-2xl relative transition-all duration-300 ${
                data?.my_team && data.my_team.shields > 0 ? 'bg-blue-50 hover:bg-blue-100 cursor-pointer' : 'bg-gray-100 opacity-80 cursor-pointer'
              }`}
              onClick={() => {
                if (data?.my_team && data.my_team.shields > 0) {
                  setActiveItemModal('shield');
                  return;
                }
                setIsShopOpen(true);
                setResultModal({
                  isOpen: true,
                  type: 'error',
                  title: '沒有防護罩',
                  message: '你目前沒有防護罩，已為你打開道具商店。'
                });
              }}
            >
               <div className="flex justify-between items-start">
                 <div>
                   <h4 className="font-black text-lg flex items-center gap-1 text-blue-900">
                     <Shield className={data?.my_team && data.my_team.shields > 0 ? "fill-blue-400 text-blue-900" : "text-gray-400"} size={20} />
                     防護罩
                   </h4>
                  <p className="text-lg font-black text-gray-700 mt-1">x {data?.my_team?.shields}</p>
                 </div>
               </div>
            </div>

            {/* 黑手套卡片 */}
            <div
              className={`doodle-card p-3 rounded-2xl relative transition-all duration-300 ${
                data?.my_team && data.my_team.gloves > 0 ? 'bg-red-50 hover:bg-red-100 cursor-pointer' : 'bg-gray-100 opacity-80 cursor-pointer'
              }`}
              onClick={() => {
                if (data?.my_team && data.my_team.gloves > 0) {
                  if (isGloveOnCooldown) {
                    setResultModal({
                      isOpen: true,
                      type: 'error',
                      title: '黑手套冷卻中',
                      message: `請等待 ${gloveCooldownLabel} 後再使用。`
                    });
                    return;
                  }
                  setActiveItemModal('glove');
                  return;
                }
                setIsShopOpen(true);
                setResultModal({
                  isOpen: true,
                  type: 'error',
                  title: '沒有黑手套',
                  message: '你目前沒有黑手套，已為你打開道具商店。'
                });
              }}
            >
               <div className="flex justify-between items-start">
                 <div>
                   <h4 className="font-black text-lg flex items-center gap-1 text-red-900">
                     <Hand className={data?.my_team && data.my_team.gloves > 0 ? "fill-red-400 text-red-900" : "text-gray-400"} size={20} />
                     黑手套
                   </h4>
                  <p className="text-lg font-black text-gray-700 mt-1">x {data?.my_team?.gloves}</p>
                 </div>
               </div>
               {isGloveOnCooldown && (
                 <div className="mt-2 text-[10px] font-black text-red-700 bg-red-100 border-2 border-red-300 rounded-lg px-2 py-1 inline-block">
                   冷卻中：{gloveCooldownLabel}
                 </div>
               )}
            </div>
          </div>
        </div>

        {/* 3. 戰況 */}
        <div className="doodle-card p-5 rounded-3xl bg-white relative overflow-hidden">
          {data.global?.location?.id && mapImages[`./assets/${data.global.location.id}.png`] && (
            <div className="absolute inset-0 z-0">
               <img 
                  src={mapImages[`./assets/${data.global.location.id}.png`]} 
                  alt="" 
                  className="w-full h-full object-cover opacity-50"
                />
            </div>
          )}
          
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-xl w-fit border-2 border-black/10 shadow-sm">
              <MapPin size={20} strokeWidth={3} />
              <h3 className="text-lg font-black">目前座標</h3>
            </div>

            <button onClick={() => setIsLocationModalOpen(true)} className="w-full mb-6 bg-white/90 backdrop-blur-sm p-4 border-4 border-black rounded-2xl hover:bg-white transition-all text-left relative active:scale-[0.98] flex items-center gap-4">
              <div className="w-16 h-16 bg-white rounded-xl border-2 border-black overflow-hidden flex-shrink-0 shadow-sm">
                {data.global?.location?.id && mapImages[`./assets/${data.global.location.id}.png`] ? (
                  <img 
                    src={mapImages[`./assets/${data.global.location.id}.png`]} 
                    alt="Location" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold bg-gray-200">
                    <MapPin size={24} />
                  </div>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                 <div className="flex justify-between items-start">
                   <span className="text-xs font-bold text-gray-500">LOCATION</span>
                   <Info size={16} className="text-gray-400"/>
                 </div>
                 <span className="text-2xl font-black block truncate">{data.global?.location?.name || "未知領域"}</span>
              </div>
            </button>

            <div className="flex justify-center gap-4">
              {data.global?.achievements?.map((ach) => (
                <button 
                  key={ach.id} 
                  onClick={() =>
                    setSelectedAchievement({
                      ...ach,
                      title: ach.is_unlocked ? (ach.title || "未知成就") : "未知成就",
                      description: ach.is_unlocked ? (ach.description || "") : "？？？？"
                    })
                  }
                  className={`w-16 h-16 rounded-full border-4 border-black flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-all ${ach.is_unlocked ? 'bg-yellow-400' : 'bg-gray-200'}`}
                >
                  {ach.is_unlocked ? <Trophy strokeWidth={3} className="text-white drop-shadow-md" /> : <span className="font-black text-gray-400">?</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* --- Debug Info (Only for testing) --- */}
      <div className="px-4 py-2 text-center text-xs text-gray-400 font-mono mt-8 mb-4">
        API Role: "{rawRole}" | IsLeader: {isLeader ? 'YES' : 'NO'}
      </div>


      {/* --- Modals --- */}

      {/* Item Action Modals */}
      {activeItemModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={closeAllModals}>
          <div className="bg-white border-4 border-black p-6 rounded-3xl max-w-sm w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 border-b-4 border-black pb-2">
              <h3 className="text-2xl font-black flex items-center gap-2">
                {activeItemModal === 'shield' ? <Shield className="fill-blue-400" /> : <Hand className="fill-red-400" />}
                {activeItemModal === 'shield' ? '使用防護罩' : '使用黑手套'}
              </h3>
              <button onClick={() => setActiveItemModal(null)}><X size={24}/></button>
            </div>
            
            {activeItemModal === 'shield' && (
                <div className="space-y-4">
                    <p className="text-md font-bold text-gray-600 bg-blue-50 p-3 rounded-xl border-2 border-blue-200">
                        開啟後保護隊伍 1 小時，降低被偷竊成功的機率（降至 30%）。
                    </p>
                    <div className="flex items-center justify-between text-sm font-bold text-gray-500 mb-2">
                        <span>剩餘數量：{data.my_team.shields}</span>
                    </div>
                    {isShieldActive ? (
                        <button disabled className="w-full bg-gray-300 text-gray-500 font-black py-3 rounded-xl border-2 border-gray-400 cursor-not-allowed">
                            目前已在保護中
                        </button>
                    ) : (
                        <button 
                          disabled={actionLoading || data.my_team.shields <= 0 || !isLeader}
                          onClick={() => handleAction('USE_SHIELD')}
                          className="w-full bg-blue-500 text-white border-2 border-black font-black py-3 rounded-xl hover:bg-blue-600 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none transition-all"
                        >
                          確認使用 (消耗 1 個)
                        </button>
                    )}
                </div>
            )}

            {activeItemModal === 'glove' && (
                <div className="space-y-4">
                    <p className="text-md font-bold text-gray-600 bg-red-50 p-3 rounded-xl border-2 border-red-200">
                        基礎成功率：無盾 60% / 有盾 10%。集氣每 20 點 +1%（最多 +70%）。
                    </p>
                    {isGloveOnCooldown && (
                      <div className="bg-red-100 border-2 border-red-400 text-red-800 font-black p-3 rounded-xl">
                        黑手套冷卻中：{gloveCooldownLabel}
                      </div>
                    )}
                    <p className="text-sm font-black text-gray-800 mb-2">選擇目標隊伍：</p>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                        {otherTeams5.map((t) => (
                            <button
                                key={t.team_id}
                                onClick={() => setTargetTeamId(String(t.team_id))}
                                className={`p-2 rounded-xl border-2 font-bold text-left transition-all flex flex-col items-center gap-1 ${
                                    String(targetTeamId) === String(t.team_id)
                                    ? 'bg-black text-white border-black scale-[1.02] shadow-[2px_2px_0px_0px_rgba(100,100,100,1)] transform -translate-y-0.5' 
                                    : 'bg-white text-black border-gray-300 hover:bg-gray-50'
                                }`}
                            >
                                <span className="flex-shrink-0">{getTeamIcon(t.team_name)}</span>
                                <span className="text-xs truncate">{t.team_name}</span>
                            </button>
                        ))}
                    </div>
                    <button 
                      disabled={actionLoading || data.my_team.gloves <= 0 || !isLeader || !targetTeamId || isGloveOnCooldown}
                      onClick={handleStartAttack}
                      className="w-full mt-2 bg-red-500 text-white border-2 border-black font-black py-3 rounded-xl hover:bg-red-600 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none transition-all"
                    >
                      {isGloveOnCooldown ? `冷卻中 ${gloveCooldownLabel}` : targetTeamId ? `開始集氣攻擊 ${otherTeams5.find(t => String(t.team_id) === String(targetTeamId))?.team_name || ""}` : "請先選擇目標"}
                    </button>
                </div>
            )}
          </div>
        </div>
      )}

      {/* Charge Modal */}
      {isChargeOpen && attackWindowEndDate && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border-4 border-black p-6 rounded-3xl max-w-sm w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="text-2xl font-black mb-2">黑手套集氣中！</h3>
            <p className="text-sm font-bold text-gray-600 mb-3">目標：{currentTargetName}</p>
            <div className="w-full h-3 bg-gray-200 border-2 border-black rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-red-500 transition-all"
                style={{ width: `${attackProgressPercent}%` }}
              />
            </div>
            <div className="text-4xl font-black text-center mb-4">{attackRemainingSec}s</div>
            <button
              onClick={handleChargeClick}
              disabled={!isAttackActive}
              className={`w-full h-32 border-4 border-black rounded-2xl font-black text-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-colors duration-200 disabled:opacity-50 ${
                chargeClicks >= 90 ? 'bg-red-600 text-white' : 
                chargeClicks >= 50 ? 'bg-orange-500 text-white' : 
                'bg-yellow-400 text-black'
              }`}
            >
              {chargeClicks >= 90 ? "無情爆點機器⚙️！" : 
               chargeClicks >= 50 ? "🔥瘋狂爆點🔥!" : 
               "狂點集氣"}
            </button>
            <div className="mt-4 text-center">
              <div className="text-xl font-black">Combo：{chargeClicks}</div>
              <div className="text-xs font-bold text-gray-500 mt-1">
                {isLeader ? "指揮中…" : "自動上傳中…"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Result Modal */}
      {resultModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
          <div className="bg-white border-4 border-black p-6 rounded-3xl max-w-sm w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center">
            <div className="mb-4 flex justify-center">
                {resultModal.type === 'success' && resultModal.title !== '處理中…' ? (
                    <CheckCircle size={64} className="text-green-500 animate-bounce" />
                ) : resultModal.title === '處理中…' ? (
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-black"></div>
                ) : (
                    <XCircle size={64} className="text-red-500 animate-pulse" />
                )}
            </div>
            <h3 className="text-2xl font-black mb-2">{resultModal.title}</h3>
            <p className="text-lg font-bold text-gray-600 mb-6 whitespace-pre-wrap">
                {resultModal.message.includes('：') ? resultModal.message.split('：')[1] : resultModal.message}
            </p>
            {resultModal.title !== '處理中…' && (
                <button 
                onClick={() => setResultModal(prev => ({ ...prev, isOpen: false }))}
                className="w-full bg-black text-white font-black py-3 rounded-xl hover:bg-gray-800 transition-all shadow-[4px_4px_0px_0px_rgba(100,100,100,1)] active:translate-y-1 active:shadow-none"
                >
                確定
                </button>
            )}
          </div>
        </div>
      )}

      {/* Shop Modal */}
      {isShopOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#fdf6e3] w-full max-w-lg border-4 border-black rounded-3xl p-6 relative max-h-[85vh] overflow-y-auto shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]">
            <button onClick={closeAllModals} className="absolute top-4 right-4 bg-red-500 text-white border-2 border-black rounded p-1 hover:bg-red-600 transition-colors"><X size={20} strokeWidth={3} /></button>
            <h2 className="text-3xl font-black mb-6 border-b-4 border-black pb-2 flex items-center gap-2">
              <ShoppingBag strokeWidth={3} /> 道具商店
            </h2>
            
            {!isLeader && (
              <div className="mb-4 bg-red-100 border-2 border-red-500 p-2 rounded-lg text-red-700 font-bold flex items-center gap-2">
                <Lock size={20} /> 只有小隊長可以購買道具
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {(() => {
                const shopItems = [...(data.shop_items || [])].sort((a, b) => {
                  const order: Record<string, number> = { shield: 0, glove: 1 };
                  return (order[a.item_id] ?? 99) - (order[b.item_id] ?? 99);
                });
                return shopItems.map((item: ShopItem) => (
                <div key={item.item_id} className="bg-white border-4 border-black p-3 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] flex flex-col justify-between hover:-translate-y-1 transition-transform h-full">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-black text-lg leading-tight">{item.item_name}</h3>
                    </div>
                    <div className="bg-green-100 text-green-800 font-black px-2 py-1 rounded border-2 border-green-800 inline-block text-sm mb-2">
                      ${item.price}
                    </div>
                    <p className="text-xs text-gray-600 font-bold mb-3">{item.description}</p>
                  </div>
                  {(() => {
                    const unitPrice = Number(item.price || 0);
                    const money = Number(data.my_team?.money ?? 0);
                    const maxAffordable = unitPrice > 0 ? Math.floor(money / unitPrice) : 0;
                    const currentQty = Math.max(1, Number(shopQtyByItemId[item.item_id] || 1));
                    const safeQty = maxAffordable > 0 ? Math.min(currentQty, maxAffordable) : currentQty;
                    const totalPrice = unitPrice * safeQty;
                    const isEnough = maxAffordable > 0 && safeQty <= maxAffordable;
                    const canBuy = isLeader && !actionLoading && isEnough;

                    return (
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <span className="text-xs font-black text-gray-500">數量</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label="減少購買數量"
                              onClick={() => {
                                setShopQtyByItemId(prev => {
                                  const prevQty = Math.max(1, Number(prev[item.item_id] || 1));
                                  const nextQty = Math.max(1, prevQty - 1);
                                  return { ...prev, [item.item_id]: nextQty };
                                });
                              }}
                              className="w-8 h-8 bg-white border-2 border-black rounded-md font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none"
                            >
                              -
                            </button>
                            <div className="min-w-8 text-center font-black text-base">{safeQty}</div>
                            <button
                              type="button"
                              aria-label="增加購買數量"
                              onClick={() => {
                                setShopQtyByItemId(prev => {
                                  const prevQty = Math.max(1, Number(prev[item.item_id] || 1));
                                  const nextQty = maxAffordable > 0 ? Math.min(maxAffordable, prevQty + 1) : prevQty + 1;
                                  return { ...prev, [item.item_id]: nextQty };
                                });
                              }}
                              className="w-8 h-8 bg-white border-2 border-black rounded-md font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs font-black">
                          <span className="text-gray-500">總價</span>
                          <span className={isEnough ? "text-green-700" : "text-red-600"}>${totalPrice}</span>
                        </div>
                        <div className="text-[10px] font-bold text-gray-500">
                          你有 ${money.toLocaleString()}｜最多可買 {Math.max(0, maxAffordable)}
                        </div>

                        <button 
                          disabled={!canBuy}
                          onClick={() => handleAction('BUY', item.item_id, undefined, safeQty)}
                          className="w-full bg-yellow-400 border-2 border-black font-black py-2 rounded-lg hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none transition-all text-sm"
                        >
                          {actionLoading ? "..." : !isLeader ? "權限不足" : !isEnough ? "金額不足" : `購買 x${safeQty}`}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Info Modals (Location/Achievement) */}
      {(isLocationModalOpen || selectedAchievement) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={closeAllModals}>
          <div className="bg-white border-4 border-black p-6 rounded-3xl max-w-sm w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <h3 className="text-2xl font-black mb-4 border-b-4 border-black pb-2">
              {isLocationModalOpen ? data.global?.location?.name : selectedAchievement?.title}
            </h3>
            <p className="text-lg font-bold leading-relaxed whitespace-pre-wrap">
              {isLocationModalOpen ? data.global?.location?.description : selectedAchievement?.description}
            </p>
            <button onClick={closeAllModals} className="mt-6 w-full bg-black text-white font-bold py-3 rounded-xl hover:bg-gray-800 transition-colors shadow-[4px_4px_0px_0px_rgba(100,100,100,1)] active:translate-y-1 active:shadow-none">關閉</button>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
