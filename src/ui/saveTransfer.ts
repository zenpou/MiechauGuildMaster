// セーブの書き出しと読み込み。セーブはブラウザの localStorage にしか無く、サイトのデータを消すと進行も消えるので、
// 控えを取れるようにする。別の端末への引っ越しにも使える。
import { deserialize, serialize } from '../core/save';
import { commit, replaceState, state, toast } from './app';
import { div, h, span } from './dom';

export function exportSave(): void {
  const url = URL.createObjectURL(new Blob([serialize(state)], { type: 'application/json' }));
  const link = h('a', { href: url, download: `miechau-save-day${state.day}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  // すぐ解放するとダウンロードが始まる前に消える端末がある
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('セーブを書き出しました');
}

/** 読めたセーブで今の進行を置き換える。読めなければ今の進行には触らない */
export async function importSave(file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return toast('ファイルを読めませんでした', true);
  }
  const next = deserialize(text);
  if (!next) return toast('セーブとして読めませんでした(別のファイルか、壊れています)', true);
  if (!window.confirm(`今の進行(${state.day}日目)を、このセーブ(${next.day}日目)で置き換えます。よろしいですか?`)) return;
  replaceState(next);
  commit();
  toast(`${next.day}日目のセーブを読み込みました`);
}

/** ラベルの中に隠したファイル入力を置くのは、iOS でボタンから input.click() するとファイル選択が開かないことがあるため */
export function saveTransferRow(): HTMLElement {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-save-input': '' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void importSave(file);
  });
  return div('row',
    h('button', { onclick: exportSave }, 'セーブを書き出す'),
    h('label', { class: 'filebtn' }, 'セーブを読み込む', input),
    span('dim small', 'ブラウザのデータを消すと進行も消えます。控えを取っておくと、別の端末にも移せます。'),
  );
}
