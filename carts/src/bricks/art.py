# «КИРПИЧИКИ» — графика
P_TEXT = ['#000000', '#f2efe4', '#141414', '#f6cf3c', '#ffe890', '#ff9a2a', '#d8501c', '#ffffff', '#5a1a08', '#100814']
P_A = ['#000000', '#0a0e26', '#121a40', '#3a3a4c', '#6c6c80', '#acacbc', '#7a1414', '#d22c22', '#ff7c62',
       '#8a4210', '#e8801c', '#ffbe6a', '#8c7410', '#e8cc2c', '#fff28c', '#07070c']
P_B = ['#000000', '#16601c', '#2eae34', '#8ae47c', '#14307a', '#2c66d8', '#86b4ff', '#4c1876', '#9a40d4',
       '#d8a0ff', '#5a5a6c', '#9c9cb0', '#e4e4f0', '#ffffff', '#2cc0e8', '#07070c']

BRICK = '''
LLLLLLLLLLLLLLLo
LMMMMMMMMMMMMMDo
LMMMMMMMMMMMMMDo
LMMMMMMMMMMMMMDo
LMMMMMMMMMMMMMDo
LMMMMMMMMMMMMMDo
LDDDDDDDDDDDDDDo
oooooooooooooooo'''
CRACK = '''
LLLLLLLLLLLLLLLo
LMMMMoMMMMMMMMDo
LMMMMMoMMMMMMMDo
LMMMMoMMMMoMMMDo
LMMMoMMMMoMMMMDo
LMMMoMMMMMoMMMDo
LDDDDDDDDDDDDDDo
oooooooooooooooo'''

def build(G):
    bg = G.art('''
11111111
11111111
11111111
11111111
11111111
11111111
11111111
11111112''', {'1': 1, '2': 2})
    frame_h = G.art('''
oooooooo
LLLLLLLL
MMMMMMMM
MMMMMMMM
MMMMMMMM
DDDDDDDD
oooooooo
........''', {'.': 0, 'o': 15, 'L': 5, 'M': 4, 'D': 3})
    frame_v = G.art('''
oLMMMDo.
oLMMMDo.
oLMMMDo.
oLMMMDo.
oLMMMDo.
oLMMMDo.
oLMMMDo.
oLMMMDo.''', {'.': 0, 'o': 15, 'L': 5, 'M': 4, 'D': 3})
    # кирпичи: 7 цветов × 2 тайла (+ треснувший серебряный)
    shadesA = [(6, 7, 8), (9, 10, 11), (12, 13, 14)]
    shadesB = [(1, 2, 3), (4, 5, 6), (7, 8, 9), (10, 11, 12)]
    bricks = []
    for d, m, l in shadesA + shadesB:
        img = G.art(BRICK, {'.': 0, 'o': 15, 'L': l, 'M': m, 'D': d})
        bricks += G.cut_rows(img, 2, 1)
    d, m, l = shadesB[3]
    bricks += G.cut_rows(G.art(CRACK, {'.': 0, 'o': 15, 'L': l, 'M': m, 'D': d}), 2, 1)
    paddle = G.art('''
..oooooooooooooooooooooooooooo..
.oWWCCLLLLLLLLLLLLLLLLLLLLCCWWo.
oWCCMMMMMMMMMMMMMMMMMMMMMMMMCCWo
oCCMMMMMMMMMMMMMMMMMMMMMMMMMMCCo
oCCMMMMMMMMMMMMMMMMMMMMMMMMMMCCo
oCCDDDDDDDDDDDDDDDDDDDDDDDDDDCCo
.oCCDDDDDDDDDDDDDDDDDDDDDDDDCCo.
..oooooooooooooooooooooooooooo..''', {'.': 0, 'o': 15, 'W': 13, 'C': 14, 'L': 12, 'M': 11, 'D': 10})
    ball = G.art('''
........
..oooo..
.oWWLMo.
.oWLMMo.
.oLMMDo.
.oMMDDo.
..oooo..
........''', {'.': 0, 'o': 15, 'W': 13, 'L': 12, 'M': 11, 'D': 10})
    title, tw, th = G.big_text('КИРПИЧИКИ', 3, [4, 3, 5, 6], 9, shadow=8)
    tiles = [bg, frame_h, frame_v] + bricks
    parts = [
        G.c_pal('pal_text', P_TEXT), G.c_pal('pal_text_y', [P_TEXT[0], '#f6cf3c'] + P_TEXT[2:]),
        G.c_pal('pal_a', P_A), G.c_pal('pal_b', P_B),
        f'#define T_BG 0\n#define T_FRAME_H 1\n#define T_FRAME_V 2\n#define T_BRICK 3\n#define BG_TILES {len(tiles)}',
        G.c_tiles('bg_data', tiles),
        G.c_tiles('paddle_data', G.cut(paddle, 4, 1)),
        G.c_tiles('ball_data', G.cut(ball, 1, 1)),
        f'#define TITLE_W {tw}\n#define TITLE_H {th}',
        G.c_tiles('title_data', G.cut_rows(title, tw, th)),
    ]
    return parts
