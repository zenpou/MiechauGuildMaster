// コマンド(タブ)の並びとラベル。main.ts の描画・icons.ts・フォントのサブセット検査が共有する。DOM に依存しない
import type { Tab } from './app';

export const TAB_DEFS: readonly { id: Tab; label: string }[] = [
  { id: 'home', label: '拠点' },
  { id: 'inbox', label: '受信箱' },
  { id: 'quests', label: '依頼' },
  { id: 'dispatch', label: '派遣' },
  { id: 'world', label: 'ワールド' },
  { id: 'recruit', label: '募集' },
  { id: 'base', label: '施設' },
  { id: 'map', label: '地図' },
  { id: 'log', label: 'ログ' },
  { id: 'records', label: '記録' },
];
