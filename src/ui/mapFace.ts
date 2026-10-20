import { div, h } from './dom';
import { artPath } from './dungeonArt';
import { mapFaceAsset, type MapFaceMember } from './mapFaceData';
import './mapFace.css';

/** 頭専用の透過素材。画像が失われた場合も他人の顔には置き換えない。 */
export function mapFace(member: MapFaceMember, className = ''): HTMLElement {
  const face = div(`map-face ${className}`, { role: 'img', 'aria-label': member.name });
  const asset = mapFaceAsset(member);
  const fallback = () => {
    face.replaceChildren(document.createTextNode(member.name.slice(0, 1)));
    face.classList.add('map-face-fallback');
  };
  if (!asset) { fallback(); return face; }
  const image = h('img', {
    src: artPath(asset.file), alt: '', draggable: 'false',
    style: `width:${asset.atlasSize / asset.size * 100}%;height:${asset.atlasSize / asset.size * 100}%;left:${-asset.x / asset.size * 100}%;top:${-asset.y / asset.size * 100}%`,
  });
  image.addEventListener('error', fallback, { once: true });
  face.append(image);
  return face;
}
