# Графика картриджей Tube TV: шрифт (Press Start 2P, OFL) и пиксель-арт из текстовых рисунков
# → тайлы 4 бит/пиксель для VDP Mega Drive (C-массивы u32).
# Запуск: python3 gfx.py <game> <out.h>
import sys, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.environ.get('PS2P_DIR', os.path.join(HERE, 'fonts'))

# ---------- шрифт: латиница (32..95) + кириллица А..Я, Ё ----------
CYR = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯЁ'
def glyph(ch):
    fn = os.path.join(FONT_DIR, 'ps2p-cyrillic.ttf' if ord(ch) >= 0x400 else 'ps2p-latin.ttf')
    font = ImageFont.truetype(fn, 8)
    im = Image.new('L', (8, 8), 0); ImageDraw.Draw(im).text((0, 0), ch, font=font, fill=255)
    return [[1 if im.getpixel((x, y)) > 127 else 0 for x in range(8)] for y in range(8)]

def font_tiles():
    chars = [chr(c) for c in range(32, 96)] + list(CYR)
    tiles = []
    for ch in chars:
        g = glyph(ch)
        # цвет 1 — буква, 2 — тень снизу-справа (читается на любом фоне)
        t = [[0] * 8 for _ in range(8)]
        for y in range(8):
            for x in range(8):
                if g[y][x]: t[y][x] = 1
                elif (y > 0 and x > 0 and g[y - 1][x - 1]): t[y][x] = 2
        tiles.append(t)
    return chars, tiles

def pack(tile):
    words = []
    for row in tile:
        v = 0
        for p in row: v = (v << 4) | (p & 15)
        words.append(v)
    return words

def art(text, keymap):
    """текстовый рисунок → двумерный массив индексов палитры; '.' — прозрачно"""
    rows = [r for r in text.strip('\n').split('\n')]
    w = max(len(r) for r in rows)
    return [[keymap.get(c, 0) for c in r.ljust(w, '.')] for r in rows]

def cut(img, tw, th):
    """картинка w×h (кратно 8) → тайлы в порядке столбцов (как у спрайтов VDP)"""
    tiles = []
    for tx in range(tw):
        for ty in range(th):
            tiles.append([[img[ty * 8 + y][tx * 8 + x] for x in range(8)] for y in range(8)])
    return tiles

def cut_rows(img, tw, th):
    """в порядке строк — для фона"""
    tiles = []
    for ty in range(th):
        for tx in range(tw):
            tiles.append([[img[ty * 8 + y][tx * 8 + x] for x in range(8)] for y in range(8)])
    return tiles

def big_text(text, scale, grad, outline, shadow=None, gap=1):
    """крупная надпись: буквы шрифта ×scale, вертикальный градиент grad (индексы палитры),
    обводка outline и тень shadow; результат — картинка, кратная 8 по обеим сторонам"""
    letters = list(text)
    w = len(letters) * (8 * scale) + 6
    h = 8 * scale + 6
    W = (w + 7) // 8 * 8; H = (h + 7) // 8 * 8
    img = [[0] * W for _ in range(H)]
    ox = (W - (len(letters) * 8 * scale)) // 2; oy = 2
    mask = [[0] * W for _ in range(H)]
    for i, ch in enumerate(letters):
        if ch == ' ': continue
        g = glyph(ch)
        for y in range(8):
            for x in range(8):
                if g[y][x]:
                    for dy in range(scale):
                        for dx in range(scale):
                            X = ox + i * 8 * scale + x * scale + dx; Y = oy + y * scale + dy
                            if 0 <= X < W and 0 <= Y < H: mask[Y][X] = 1
    for Y in range(H):
        for X in range(W):
            if mask[Y][X]:
                k = min(len(grad) - 1, max(0, (Y - oy) * len(grad) // (7 * scale)))
                img[Y][X] = grad[k]
            else:
                near = any(0 <= Y + dy < H and 0 <= X + dx < W and mask[Y + dy][X + dx]
                           for dy in (-1, 0, 1, 2) for dx in (-1, 0, 1, 2))
                if near: img[Y][X] = outline
                elif shadow is not None and 2 <= Y < H and 2 <= X < W and mask[Y - 3][X - 3]: img[Y][X] = shadow
    return img, W // 8, H // 8

def c_tiles(name, tiles):
    out = [f'static const u32 {name}[{len(tiles) * 8}] = {{']
    for t in tiles:
        out.append('    ' + ', '.join(f'0x{w:08X}' for w in pack(t)) + ',')
    out.append('};')
    return '\n'.join(out)

def c_pal(name, cols):
    """цвета #rrggbb → VDP 0BGR (по 3 бита)"""
    def v(c):
        r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
        q = lambda x: min(7, (x + 16) // 32)
        return (q(b) << 9) | (q(g) << 5) | (q(r) << 1)
    vals = [v(c) for c in cols] + [0] * (16 - len(cols))
    return f'static const u16 {name}[16] = {{ ' + ', '.join(f'0x{x:04X}' for x in vals[:16]) + ' };'

def emit(path, parts, font=True):
    lines = ['// создано tools/gfx.py — не править руками', '#pragma once', '#include <genesis.h>']
    if font:
        chars, ft = font_tiles()
        lines.append(f'#define FONT_TILES {len(ft)}')
        lines.append('// порядок: ASCII 32..95, затем ' + CYR)
        lines.append(c_tiles('font_data', ft))
    lines += parts
    open(path, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('gfx ->', path)

if __name__ == '__main__':
    game = sys.argv[1]; out = sys.argv[2]
    sys.path.insert(0, os.path.join(HERE, '..', game))
    import art as A        # у каждой игры свой art.py
    emit(out, A.build(sys.modules[__name__]))
