export const COLORS = [
  {id: 'white', label: '白', hex: '#ffffff'},
  {id: 'cream', label: 'クリーム', hex: '#f3e2c0'},
  {id: 'black', label: '黒', hex: '#1c1c1e'},
  {id: 'red', label: '朱', hex: '#e8452c'},
  {id: 'orange', label: 'オレンジ', hex: '#ff8a3d'},
  {id: 'yellow', label: '黄', hex: '#ffd60a'},
  {id: 'green', label: '緑', hex: '#5fae6e'},
  {id: 'blue', label: '青', hex: '#2f7bff'},
  {id: 'pink', label: 'ピンク', hex: '#ff8fbf'},
  {id: 'gold', label: 'ゴールド', hex: '#d4af37'},
]

export const DEFAULT_COLOR_ID = 'white'

export const findColor = (colorId) => COLORS.find((c) => c.id === colorId) || COLORS.find((c) => c.id === DEFAULT_COLOR_ID)
