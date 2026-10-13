# «ЗМЕЙКА» — графика
P_FIELD = ['#000000', '#24501a', '#2f6a21', '#3d8429', '#4a1f0e', '#8a3e1c', '#b8602c', '#d9b07a',
           '#1a1a1a', '#5e5a50', '#8c8778']
P_SNAKE = ['#000000', '#0c2408', '#2a7a1c', '#4fae2c', '#9fe066', '#f6f6ec', '#101010', '#7c0c0c',
           '#d42418', '#ff9a78', '#3c9c2c', '#6a3a10', '#9c6c0c', '#e8bc30', '#fff094', '#ff3a5a']
P_TEXT = ['#000000', '#f2efe4', '#141414', '#f6cf3c', '#ffe890', '#e88c20', '#b4501c', '#ff6a3a', '#5a1a08', '#1c0c04']

def build(G):
    k1 = {'.': 0, 'd': 1, 'm': 2, 'l': 3, 'B': 4, 'r': 5, 'R': 6, 'w': 7}
    grassA = G.art('''
mmmmmmmm
mmmmlmmm
mmmmmmmm
mdmmmmmm
mmmmmmlm
mmmmmmmm
mmmmmmmm
mmlmmmdm''', k1)
    grassB = G.art('''
dddddddd
ddmddddd
dddddddd
dddddmdd
dddddddd
dmdddddd
ddddddmd
dddddddd''', k1)
    wall = G.art('''
rrrRrrrw
rrrrrrrw
BBBBBBBw
wwwwwwww
rrwrrrRr
rrwrrrrr
BBwBBBBB
wwwwwwww''', k1)
    k2 = {'.': 0, 'o': 1, 'd': 2, 'm': 3, 'l': 4, 'W': 5, 'p': 6, 'a': 7, 'A': 8, 'h': 9, 'g': 10, 's': 11,
          'y': 12, 'Y': 13, 'Z': 14, 't': 15}
    head_r = G.art('''
.oooooo.
ommmlmmo
ommWWmmo
ommWpmdtt
ommmmmdo
omddddmo
ommmmmmo
.oooooo.''', k2)
    head_r = [r[:8] for r in head_r]
    head_u = G.art('''
...tt...
.oooooo.
oWWmmWWo
oWpmmWpo
ommllmmo
ommmmmmo
ommddmmo
ommmmmmo''', k2)
    body = G.art('''
.oooooo.
ommlmmmo
omlmmmdo
ommmmmdo
ommmmddo
omddmmdo
ommmmmmo
.oooooo.''', k2)
    tail = G.art('''
........
..oooo..
.ommmmo.
.omlmdo.
.ommddo.
.omdddo.
..oooo..
........''', k2)
    apple = G.art('''
....sg..
...sgg..
.oAAoAA.
oAhAAAAo
oAhAAAAo
oAAAAAao
.oAAAao.
..oooo..''', k2)
    pear = G.art('''
....s...
...sg...
...oYo..
..oYZYo.
.oYZYYYo
.oYYYYyo
.oYYYyyo
..oooo..''', k2)
    tiles = [grassA, grassB, wall, head_r, head_u, body, tail, apple, pear]
    title, tw, th = G.big_text('ЗМЕЙКА', 4, [4, 3, 5, 6], 9, shadow=8)
    title_tiles = G.cut_rows(title, tw, th)
    parts = [
        G.c_pal('pal_field', P_FIELD), G.c_pal('pal_snake', P_SNAKE), G.c_pal('pal_text', P_TEXT),
        G.c_pal('pal_text_y', [P_TEXT[0], '#f6cf3c'] + P_TEXT[2:]),
        f'#define T_GRASS_A 0\n#define T_GRASS_B 1\n#define T_WALL 2\n#define T_HEAD_R 3\n#define T_HEAD_U 4\n#define T_BODY 5\n#define T_TAIL 6\n#define T_APPLE 7\n#define T_PEAR 8\n#define GAME_TILES {len(tiles)}',
        G.c_tiles('game_data', [G.cut(t, 1, 1)[0] for t in tiles]),
        f'#define TITLE_W {tw}\n#define TITLE_H {th}',
        G.c_tiles('title_data', title_tiles),
    ]
    return parts
