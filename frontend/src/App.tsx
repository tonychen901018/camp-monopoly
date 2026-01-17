import React, { useEffect, useRef, useState } from 'react';
import { Coins, Info, MapPin, Trophy, X, ShoppingBag, Shield, Hand, Egg, Star, Lock, CheckCircle, XCircle } from 'lucide-react';
import type { ApiResponse, AchievementData, ShopItem } from './types';

// ★★★ 請確認此處網址為最新部署版本 ★★★
const API_URL = "https://script.google.com/macros/s/AKfycbwiDBvrNzKCs45hvwvCXhb65IJgGL0Ae1XZQYtkcBCI7_Xs_GZ4n2WF6J5Bp2Tg8-7Hew/exec";

// 自動更新間隔 (毫秒)
// 行動改為「同一個 response 回傳最新 dashboard」後，可以降低輪詢頻率
const POLLING_INTERVAL = 10000;
const LS_ID_KEY = 'camp_student_id';
const LS_CACHE_PREFIX = 'camp_dashboard_cache_v1:'; // + studentId

function App() {
  const [inputId, setInputId] = useState('');
  const [loading, setLoading] = useState(false);
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
  
  const [targetTeam, setTargetTeam] = useState<string>('');
  
  // 修改：控制道具彈窗狀態 (取代展開)
  const [activeItemModal, setActiveItemModal] = useState<null | 'shield' | 'glove'>(null);

  // 權限判斷修正
  const rawRole = data?.player?.role || '';
  const isLeader = rawRole.trim().toUpperCase() === 'LEADER';
  
  const pollTimerRef = useRef<number | null>(null);

  // --- API Calls ---

  const fetchDashboardData = async (studentId: string) => {
    const trimmedId = studentId.trim();
    if (!trimmedId) return null;
    
    try {
      // 加上時間戳記 timestamp 防止快取
      const timestamp = new Date().getTime();
      const response = await fetch(`${API_URL}?id=${trimmedId}&t=${timestamp}`);
      const json = await response.json();
      return json;
    } catch (err) {
      console.error("Fetch error:", err);
      return null;
    }
  };

  const handleAction = async (action: 'BUY' | 'USE_SHIELD' | 'USE_GLOVE', itemId?: string, targetName?: string) => {
    if (!data?.player?.id) return;

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
      qs.set('t', String(timestamp));
      if (itemId) qs.set('item_id', itemId);
      if (targetName) qs.set('target_team_name', targetName);

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
      setTargetTeam('');

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

  // --- Auth & Init ---

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchDashboardData(inputId);
      if (json && json.success) {
        setData(json);
        setIsLoggedIn(true);
        localStorage.setItem(LS_ID_KEY, inputId.trim());
        localStorage.setItem(`${LS_CACHE_PREFIX}${inputId.trim()}`, JSON.stringify({ t: Date.now(), data: json }));
      } else {
        setError(json?.message || "登入失敗，請確認 ID");
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
    setInputId('');
    localStorage.removeItem(LS_ID_KEY);
  };

  useEffect(() => {
    const init = async () => {
      const savedId = localStorage.getItem(LS_ID_KEY) || '';
      if (!savedId) return;
      setInputId(savedId);

      // 先用快取秒開（體感更快）
      const cachedRaw = localStorage.getItem(`${LS_CACHE_PREFIX}${savedId}`);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.data && cached.data.success) {
            setData(cached.data);
            setIsLoggedIn(true);
          }
        } catch {}
      }

      setLoading(true);
      try {
        const json = await fetchDashboardData(savedId);
        if (json && json.success) {
          setData(json);
          setIsLoggedIn(true);
          localStorage.setItem(`${LS_CACHE_PREFIX}${savedId}`, JSON.stringify({ t: Date.now(), data: json }));
        } else {
          localStorage.removeItem(LS_ID_KEY);
        }
      } catch (err) {} finally {
        setLoading(false);
      }
    };
    void init();
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !data?.player?.id) {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const playerId = data.player.id;

    const startPolling = () => {
      pollTimerRef.current = window.setInterval(async () => {
        if (document.visibilityState !== 'visible') return;
        const json = await fetchDashboardData(playerId);
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
              營隊大富翁
            </h1>
            <form onSubmit={handleLogin} className="space-y-6">
              <input
                type="text"
                placeholder="輸入 ID (e.g. 1001)"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                className="w-full px-4 py-4 bg-white border-4 border-black text-2xl font-bold rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              />
              {error && <div className="bg-white border-4 border-black p-2 text-red-600 font-bold">{error}</div>}
              <button type="submit" disabled={loading} className="w-full bg-yellow-400 doodle-btn py-4 text-2xl rounded-xl hover:bg-yellow-300">
                {loading ? "讀取中..." : "開始遊戲"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (!data || !data.player || !data.my_team) return null;

  const isShieldActive = Boolean(data.my_team.is_shield_active);
  const shieldUntil = data.my_team.shield_expiry ? new Date(data.my_team.shield_expiry) : null;
  // 前5個隊伍 (排除自己) 用於偷竊列表
  const otherTeams5 = (data.other_teams || []).slice(0, 5);

  return (
    <div className={`min-h-screen pb-24 relative overflow-x-hidden ${data.my_team.has_egg ? 'bg-yellow-50' : 'bg-[#fdf6e3]'} text-black font-sans transition-colors duration-500`}>
      
      {/* Golden Egg Alert Banner */}
      {data.my_team.has_egg && (
        <div className="fixed top-0 left-0 w-full bg-yellow-400 border-b-4 border-black z-50 py-2 px-4 shadow-lg animate-pulse flex items-center justify-center gap-2">
          <Egg className="animate-bounce" size={24} strokeWidth={3} />
          <span className="font-black text-lg">警告：你的隊伍持有金蛋！快開啟防護罩！</span>
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
              onClick={() => setIsShopOpen(true)}
              className="bg-[#FFD93D] border-2 border-black px-3 py-1 rounded-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none transition-all flex items-center gap-1 font-bold text-sm rotate-1"
            >
              <ShoppingBag size={14} /> 商店
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {/* 防護罩卡片 */}
            <div className={`doodle-card p-3 rounded-2xl relative transition-all duration-300 ${data?.my_team && data.my_team.shields > 0 ? 'bg-blue-50 hover:bg-blue-100 cursor-pointer' : 'bg-gray-100 opacity-80'}`}
                 onClick={() => data?.my_team && data.my_team.shields > 0 && setActiveItemModal('shield')}>
               <div className="flex justify-between items-start">
                 <div>
                   <h4 className="font-black text-lg flex items-center gap-1 text-blue-900">
                     <Shield className={data?.my_team && data.my_team.shields > 0 ? "fill-blue-400 text-blue-900" : "text-gray-400"} size={20} />
                     防護罩
                   </h4>
                   <p className="text-sm font-bold text-gray-600 mt-1">x {data?.my_team?.shields}</p>
                 </div>
               </div>
               <p className="text-[10px] font-bold text-gray-500 mt-2">點擊使用...</p>
            </div>

            {/* 黑手套卡片 */}
            <div className={`doodle-card p-3 rounded-2xl relative transition-all duration-300 ${data?.my_team && data.my_team.gloves > 0 ? 'bg-red-50 hover:bg-red-100 cursor-pointer' : 'bg-gray-100 opacity-80'}`}
                 onClick={() => data?.my_team && data.my_team.gloves > 0 && setActiveItemModal('glove')}>
               <div className="flex justify-between items-start">
                 <div>
                   <h4 className="font-black text-lg flex items-center gap-1 text-red-900">
                     <Hand className={data?.my_team && data.my_team.gloves > 0 ? "fill-red-400 text-red-900" : "text-gray-400"} size={20} />
                     黑手套
                   </h4>
                   <p className="text-sm font-bold text-gray-600 mt-1">x {data?.my_team?.gloves}</p>
                 </div>
               </div>
               <p className="text-[10px] font-bold text-gray-500 mt-2">點擊偷竊...</p>
            </div>
          </div>
        </div>

        {/* 3. 戰況 */}
        <div className="doodle-card p-5 rounded-3xl bg-white relative">
          <div className="flex items-center gap-2 mb-4">
            <MapPin size={24} strokeWidth={3} />
            <h3 className="text-xl font-black">目前戰況</h3>
          </div>

          <button onClick={() => setIsLocationModalOpen(true)} className="w-full mb-6 bg-gray-100 p-4 border-4 border-black rounded-2xl hover:bg-gray-200 transition-all text-left relative active:scale-[0.98]">
            <div className="absolute top-2 right-2"><Info size={16}/></div>
            <span className="text-xs font-bold text-gray-500">LOCATION</span>
            <span className="text-2xl font-black block">{data.global?.location?.name || "未知領域"}</span>
          </button>

          <div className="flex justify-center gap-4">
            {data.global?.achievements?.map((ach) => (
              <button 
                key={ach.id} 
                onClick={() => setSelectedAchievement(ach)}
                className={`w-16 h-16 rounded-full border-4 border-black flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-all ${ach.is_unlocked ? 'bg-yellow-400' : 'bg-gray-200'}`}
              >
                {ach.is_unlocked ? <Trophy strokeWidth={3} className="text-white drop-shadow-md" /> : <span className="font-black text-gray-400">?</span>}
              </button>
            ))}
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
                        開啟後保護隊伍 5 小時，大幅降低被偷竊成功的機率（降至 10%）。
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
                        偷竊成功率 60%，若對方有防護罩則降為 10%。成功可獲得對方金蛋！
                    </p>
                    <p className="text-sm font-black text-gray-800 mb-2">選擇目標隊伍：</p>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                        {otherTeams5.map((t) => (
                            <button
                                key={t.team_id}
                                onClick={() => setTargetTeam(t.team_name)}
                                className={`text-sm font-bold py-3 px-2 rounded-xl border-2 transition-all ${targetTeam === t.team_name ? 'bg-black text-white border-black shadow-[2px_2px_0px_0px_rgba(100,100,100,1)] transform -translate-y-0.5' : 'bg-white text-black border-gray-300 hover:bg-gray-50'}`}
                            >
                                {t.team_name}
                            </button>
                        ))}
                    </div>
                    <button 
                      disabled={actionLoading || data.my_team.gloves <= 0 || !isLeader || !targetTeam}
                      onClick={() => handleAction('USE_GLOVE', undefined, targetTeam)}
                      className="w-full mt-2 bg-red-500 text-white border-2 border-black font-black py-3 rounded-xl hover:bg-red-600 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none transition-all"
                    >
                      {targetTeam ? `確認偷竊 ${targetTeam}！` : "請先選擇目標"}
                    </button>
                </div>
            )}
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
            <p className="text-lg font-bold text-gray-600 mb-6 whitespace-pre-wrap">{resultModal.message}</p>
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
              {data.shop_items?.map((item: ShopItem) => (
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
                  <button 
                    disabled={actionLoading || !isLeader}
                    onClick={() => handleAction('BUY', item.item_id)}
                    className="w-full bg-yellow-400 border-2 border-black font-black py-2 rounded-lg hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 active:shadow-none transition-all text-sm"
                  >
                    {actionLoading ? "..." : isLeader ? "購買" : "權限不足"}
                  </button>
                </div>
              ))}
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
