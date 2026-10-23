/**
 * 结构化资产模板与中文标签（卖家发布表单 / 展示图 / AI 估值提示词共用）
 * 用户可见处一律展示中文名，不得出现英文 key。
 */

// 结构化资产模板（FR-A2：按游戏模板）
export const ASSET_TEMPLATES = {
  '王者荣耀': [
    { key: 'rank', label: '段位', type: 'text', sample: '无双王者' },
    { key: 'noble', label: '贵族等级', type: 'text', sample: 'V10' },
    { key: 'skins', label: '皮肤数', type: 'number', sample: 147 },
    { key: 'heroes', label: '英雄数', type: 'number', sample: 105 },
    { key: 'key_assets', label: '典藏/限定（逗号分隔）', type: 'tags', sample: '荣耀典藏,全限定' },
  ],
  '和平精英': [
    { key: 'rank', label: '段位', type: 'text', sample: '无敌战神' },
    { key: 'level', label: '等级', type: 'number', sample: 60 },
    { key: 'skins', label: '时装数', type: 'number', sample: 220 },
    { key: 'vehicles', label: '载具皮肤', type: 'tags', sample: '粉装套,8级车' },
    { key: 'key_assets', label: '关键资产（逗号分隔）', type: 'tags', sample: '玛莎拉蒂,粉装' },
  ],
  '原神': [
    { key: 'level', label: '冒险等级', type: 'number', sample: 60 },
    { key: 'chars', label: '角色数', type: 'number', sample: 45 },
    { key: 'lights', label: '五星武器', type: 'number', sample: 12 },
    { key: 'key_assets', label: '关键资产（逗号分隔）', type: 'tags', sample: '满命火C,专武' },
  ],
  'default': [
    { key: 'rank', label: '段位/等级', type: 'text', sample: '' },
    { key: 'skins', label: '皮肤/外观数', type: 'number', sample: 0 },
    { key: 'heroes', label: '角色/英雄数', type: 'number', sample: 0 },
    { key: 'key_assets', label: '关键资产（逗号分隔）', type: 'tags', sample: '' },
  ],
};

export function templateFor(gameName) {
  return ASSET_TEMPLATES[gameName] || ASSET_TEMPLATES.default;
}

// 英文 key → 中文名兜底（覆盖全部模板字段，模板未命中时仍展示中文）
export const ASSET_LABEL_FALLBACK = {
  rank: '段位/等级',
  noble: '贵族等级',
  skins: '皮肤/时装数',
  heroes: '英雄/角色数',
  level: '等级',
  chars: '角色数',
  lights: '五星武器',
  vehicles: '载具皮肤',
  key_assets: '关键资产',
};

export function assetLabel(key, gameName) {
  const t = templateFor(gameName).find(x => x.key === key);
  // 展示用标签去掉表单提示后缀（如「（逗号分隔）」）
  const raw = t?.label || ASSET_LABEL_FALLBACK[key] || '其他资产';
  return raw.replace(/（逗号分隔）/, '');
}

/** 把资产对象的英文 key 转成中文标签（AI 提示词、展示兜底用） */
export function assetsZh(assets, gameName) {
  const out = {};
  for (const [k, v] of Object.entries(assets || {})) out[assetLabel(k, gameName)] = v;
  return out;
}
