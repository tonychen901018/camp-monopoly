export interface PlayerData {
  name: string;
  id: string;
  team: string;
  role: string; // 'LEADER' | 'MEMBER'
}

export interface MyTeamData {
  team_id?: string;
  money: number;
  exp: number; // 新增經驗值
  has_egg: boolean;
  gloves: number;
  shields: number;
  shield_expiry: string;
  glove_cooldown_until?: string;
  is_shield_active: boolean;
}

export interface OtherTeamData {
  team_id: string;
  team_name: string;
}

export interface ShopItem {
  item_id: string;
  item_name: string;
  price: number;
  description: string;
}

export interface LocationData {
  id?: string;
  name: string;
  description: string;
}

export interface AchievementData {
  id: string;
  is_unlocked: boolean;
  title: string;
  description: string;
}

export interface GlobalData {
  location: LocationData;
  achievements: AchievementData[];
}

export interface ApiResponse {
  success: boolean;
  message?: string;
  action?: {
    type: string;
    ok: boolean;
  };
  player?: PlayerData;
  my_team?: MyTeamData;
  other_teams?: OtherTeamData[];
  shop_items?: ShopItem[];
  global?: GlobalData;
}
