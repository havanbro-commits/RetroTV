# «ЗВЁЗДНЫЙ ПАТРУЛЬ» — графика
P_TEXT = ['#000000', '#f2efe4', '#141414', '#f6cf3c', '#bfe8ff', '#5ab4ff', '#2a62d8', '#ffffff', '#0c1440', '#04040c']
P_STARS = ['#000000', '#02030a', '#3a4a7a', '#8ea0d8', '#f0f4ff', '#ffe6a0', '#ff9a7a', '#0a0f2a', '#141c48', '#2a1a4a']
P_SPR = ['#000000', '#08080c', '#34446a', '#7a8eb8', '#d0dcf8', '#30c8f0', '#ff8a20', '#ffe060', '#e02828', '#801010',
         '#44d044', '#187a20', '#b050e0', '#ffffff', '#ff5a10', '#7c7c90']
K = {'.': 0, 'o': 1, 'd': 2, 'm': 3, 'l': 4, 'c': 5, 'f': 6, 'y': 7, 'r': 8, 'R': 9, 'g': 10, 'G': 11, 'p': 12, 'W': 13, 'x': 14, 's': 15}

def build(G):
    ship = G.art('''
.......oo.......
......ollo......
......olmo......
.....olccmo.....
.....olccmo.....
....olmccmmo....
....olmmmmmo....
...olmmmmmmmo...
.oo.lmmmmmmd.oo.
olmolmmmmmmdomdo
olmmlmrRRrmmdmdo
olmmmmrRRrmmmmdo
ommmmmmmmmmmmmdo
.ommddooooddmmo.
..ooo.......ooo.
................''', K)
    flame1 = G.art('''
...yffy.
...yyfy.
....yf..
....f...
........
........
........
........''', K)
    flame2 = G.art('''
...fyyf.
...yWyf.
...fyy..
....yf..
....f...
........
........
........''', K)
    shot = G.art('''
...oo...
..oWWo..
..oyWo..
..oyyo..
..ofyo..
...ff...
...f....
........''', K)
    eshot = G.art('''
........
..oooo..
.orrRRo.
.orWrRo.
.oRrrRo.
.oRRRRo.
..oooo..
........''', K)
    saucer = G.art('''
................
......oooo......
.....occllo.....
....occcclmo....
..oooooooooooo..
.olmmmmmmmmmmmdo
olmWmmWmmWmmWmdo
ommmmmmmmmmmmmmo
.oddddddddddddo.
..oooooooooooo..
....oyo..oyo....
.....o....o.....
................
................
................
................''', K)
    saucer2 = [row[:] for row in saucer]
    for y, row in enumerate(saucer2):
        for x, v in enumerate(row):
            if v == 13: saucer2[y][x] = 8                    # огоньки мигают
    bug = G.art('''
...o........o...
....o......o....
.....oooooo.....
....oggggggo....
...ogGgggggGo...
..ogGWogogWGgo..
..ogGooggooGgo..
.oogggggggggGoo.
ogogGgggggggGogo
ogo.oGggggGo.ogo
oo..ooGggGoo..oo
.....ooGGoo.....
......oooo......
................
................
................''', K)
    bomber = G.art('''
....oooooooo....
...oppppppppo...
..oppWppppWppo..
.opppoppppopppo.
oppppppppppppppo
oppppooooooppppo
.oppo.oRRo.oppo.
..oo..orro..oo..
.......oo.......
................
................
................
................
................
................
................''', K)
    star = G.art('''
...oo...
..oyyo..
oooyyooo
oyyWWyyo
.oyyyyo.
.oyooyo.
oyo..oyo
oo....oo''', K)
    def boom(r):
        img = [[0] * 16 for _ in range(16)]
        import math
        for y in range(16):
            for x in range(16):
                d = math.hypot(x - 7.5, y - 7.5)
                n = (math.sin(x * 1.7 + y * 0.9 + r) + math.sin(y * 2.3 - x * 0.7)) * 0.9
                rr = r * 2.2 + n
                if d < rr * 0.45: img[y][x] = 13
                elif d < rr * 0.7: img[y][x] = 7
                elif d < rr * 0.95: img[y][x] = 14
                elif d < rr * 1.1 and r < 3.5: img[y][x] = 8
        return img
    booms = [boom(1.6), boom(2.6), boom(3.4), boom(4.2)]
    # гаснущий последний кадр — с дырами
    for y in range(16):
        for x in range(16):
            if (x * 7 + y * 3) % 5 == 0: booms[3][y][x] = 0
            elif booms[3][y][x] == 13: booms[3][y][x] = 7
    # звёзды для фона: 4 тайла с точками разной яркости
    def sky(seed, dots):
        import random
        rnd = random.Random(seed)
        t = [[0] * 8 for _ in range(8)]
        for _ in range(dots):
            x, y = rnd.randrange(8), rnd.randrange(8); t[y][x] = rnd.choice([2, 2, 3, 3, 4, 5, 6])
        return t
    skies = [[[0] * 8 for _ in range(8)]] + [sky(i, 1 + i % 2) for i in range(1, 8)]
    big = G.art('''
...4....
...4....
..434...
4434344.
..434...
...4....
...4....
........''', {'.': 0, '3': 3, '4': 4})
    skies.append(big)
    title1, tw1, th1 = G.big_text('ЗВЁЗДНЫЙ', 3, [4, 5, 6, 6], 9, shadow=8)
    title2, tw2, th2 = G.big_text('ПАТРУЛЬ', 3, [7, 4, 5, 6], 9, shadow=8)
    spr = []
    def add(name, img, w, h):
        idx = len(spr); spr.extend(G.cut(img, w, h)); return f'#define S_{name} {idx}'
    defs = [add('SHIP', ship, 2, 2), add('FLAME1', flame1, 1, 1), add('FLAME2', flame2, 1, 1), add('SHOT', shot, 1, 1),
            add('ESHOT', eshot, 1, 1), add('SAUCER', saucer, 2, 2), add('SAUCER2', saucer2, 2, 2), add('BUG', bug, 2, 2),
            add('BOMBER', bomber, 2, 2), add('STAR', star, 1, 1)]
    for i, b in enumerate(booms): defs.append(add(f'BOOM{i}', b, 2, 2))
    parts = [
        G.c_pal('pal_text', P_TEXT), G.c_pal('pal_text_y', [P_TEXT[0], '#f6cf3c'] + P_TEXT[2:]),
        G.c_pal('pal_stars', P_STARS), G.c_pal('pal_spr', P_SPR),
        '\n'.join(defs) + f'\n#define SPR_TILES {len(spr)}',
        G.c_tiles('spr_data', spr),
        f'#define SKY_TILES {len(skies)}',
        G.c_tiles('sky_data', skies),
        f'#define TITLE1_W {tw1}\n#define TITLE1_H {th1}\n#define TITLE2_W {tw2}\n#define TITLE2_H {th2}',
        G.c_tiles('title1_data', G.cut_rows(title1, tw1, th1)),
        G.c_tiles('title2_data', G.cut_rows(title2, tw2, th2)),
    ]
    return parts
