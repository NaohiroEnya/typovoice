// Central registry of selectable fonts. Each entry pairs the raw font file (loaded by
// text-plane.js via opentype.js to build 3D glyph geometry) with a CSS @font-face name
// (declared in index.css) so the font sheet can preview each font live. `scaleX` horizontally
// squeezes the glyphs (applied both to the 3D geometry and to the CSS preview), which is how the
// condensed face is made from the regular gothic without shipping another font file.
import minchoUrl from './assets/fonts/NotoSerifJP-subset.ttf?url'
import boldUrl from './assets/fonts/DelaGothicOne-subset.ttf?url'
import gothicUrl from './assets/fonts/NotoSansJP-subset.otf?url'
import maruUrl from './assets/fonts/ZenMaruGothic-subset.ttf?url'
import handUrl from './assets/fonts/YuseiMagic-subset.ttf?url'
import retroUrl from './assets/fonts/ZenAntique-subset.ttf?url'

export const FONTS = [
  {id: 'mincho', label: '明朝', url: minchoUrl, cssFamily: 'TC-Mincho', scaleX: 1},
  {id: 'bold', label: '太ゴシック', url: boldUrl, cssFamily: 'TC-Bold', scaleX: 1},
  {id: 'gothic', label: 'ゴシック', url: gothicUrl, cssFamily: 'TC-Gothic', scaleX: 1},
  {id: 'maru', label: '丸ゴシック', url: maruUrl, cssFamily: 'TC-Maru', scaleX: 1},
  {id: 'hand', label: '手書き', url: handUrl, cssFamily: 'TC-Hand', scaleX: 1},
  {id: 'condensed', label: 'コンデンス', url: gothicUrl, cssFamily: 'TC-Gothic', scaleX: 0.62},
  {id: 'retro', label: 'レトロ', url: retroUrl, cssFamily: 'TC-Retro', scaleX: 1},
]

export const DEFAULT_FONT_ID = 'gothic'

export const findFont = (fontId) => FONTS.find((f) => f.id === fontId) || FONTS.find((f) => f.id === DEFAULT_FONT_ID)
