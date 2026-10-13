// «КИРПИЧИКИ» — картридж Tube TV: ракетка, мяч, стенка кирпичей. Серебряные — с двух ударов.
#include <genesis.h>
#include "tt.h"
#include "gfx.h"

#define COLS 19
#define ROWS 8
#define FX0 8          // поле в пикселях: x 8..312, y 24..224
#define FX1 312
#define FY0 24
#define BRICK_Y0 5     // ряд тайлов первого кирпича
#define PADDLE_Y 200
#define PW 32

#define TB (TT_FREE_BASE)
#define T_PADDLE (TB + BG_TILES)
#define T_BALL (T_PADDLE + 4)
#define TITLE_BASE (T_BALL + 1)

static const char *levels[] = {
    "..................."
    "rrrrrrrrrrrrrrrrrrr"
    "ooooooooooooooooooo"
    "yyyyyyyyyyyyyyyyyyy"
    "ggggggggggggggggggg"
    "bbbbbbbbbbbbbbbbbbb"
    "ppppppppppppppppppp"
    "...................",

    "sss.sss.sss.sss.sss"
    "r.r.o.o.y.y.g.g.b.b"
    ".r.o.o.y.y.g.g.b.b."
    "r.r.o.o.y.y.g.g.b.b"
    ".r.o.o.y.y.g.g.b.b."
    "ppppppppppppppppppp"
    "..................."
    "...................",

    "........sss........"
    ".......ryyyr......."
    "......ryyyyyr......"
    ".....ryybbbyyr....."
    "....ryybbbbbyyr...."
    ".....ryybbbyyr....."
    "......ryyyyyr......"
    ".......sssss.......",

    "s.s.s.s.s.s.s.s.s.s"
    "ggggggggggggggggggg"
    "bbb.bbb.bbb.bbb.bbb"
    "ppppppppppppppppppp"
    "ooo.ooo.ooo.ooo.ooo"
    "rrrrrrrrrrrrrrrrrrr"
    "sssssssssssssssssss"
    "...................",
};
#define NLEVELS 4

static u8 bricks[ROWS][COLS];      // 0 нет, 1..6 цвет, 7 серебро целое, 8 серебро треснуло
static u16 left;
static s32 bx, by, vx, vy;          // ×16
static s16 px;                      // ракетка
static s16 pvx;
static bool stuck;
static u8 lives, level;
static u32 score, best;
static u16 speed;                   // ×16 px за кадр
static u16 prevJoy;
static u16 hits;

// направления отскока от ракетки: 11 углов, синус/косинус ×256
static const s16 dirx[11] = { -222, -181, -137, -91, -45, 0, 45, 91, 137, 181, 222 };
static const s16 diry[11] = { -128, -181, -219, -240, -252, -256, -252, -240, -219, -181, -128 };

static const TTNote m_title[] = {
    {N_C5, 8}, {N_E5, 8}, {N_G5, 8}, {N_C6, 16}, {N_G5, 8}, {N_E5, 8}, {N_C5, 16}, {0, 8},
    {N_D5, 8}, {N_F5, 8}, {N_A5, 8}, {N_D5, 16}, {N_B4, 8}, {N_G4, 8}, {N_C5, 24}, {0, 24}, {0, 0} };
static const TTNote b_title[] = {
    {N_C3, 16}, {N_C4, 16}, {N_G3, 16}, {N_C4, 16}, {N_D3, 16}, {N_D4, 16}, {N_G3, 16}, {N_G3, 16}, {0, 0} };
static const TTNote m_clear[] = { {N_C5, 6}, {N_E5, 6}, {N_G5, 6}, {N_C6, 18}, {0, 0} };
static const TTNote b_clear[] = { {N_C4, 6}, {N_G4, 6}, {N_E4, 6}, {N_C4, 18}, {0, 0} };

static void draw_brick(u8 c, u8 r)
{
    u8 b = bricks[r][c];
    u16 x = 1 + c * 2, y = BRICK_Y0 + r;
    if (!b) { VDP_fillTileMapRect(BG_A, 0, x, y, 2, 1); return; }
    u8 col = b - 1;                           // 0..7
    u16 pal = col < 3 ? PAL1 : PAL2;
    u16 t = TB + T_BRICK + col * 2;
    VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(pal, 0, 0, 0, t), x, y);
    VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(pal, 0, 0, 0, t + 1), x + 1, y);
}

static void draw_frame(void)
{
    VDP_fillTileMapRect(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + T_BG), 0, 0, 40, 28);
    for (u16 x = 0; x < 40; x++) VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + T_FRAME_H), x, 2);
    for (u16 y = 3; y < 28; y++) {
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + T_FRAME_V), 0, y);
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 1, TB + T_FRAME_V), 39, y);
    }
}

static void hud(void)
{
    tt_text(BG_A, "ОЧКИ", 1, 0, PAL0, 1); tt_num(BG_A, score, 6, 6, 0, PAL3, 1);
    tt_text(BG_A, "УРОВЕНЬ", 14, 0, PAL0, 1); tt_num(BG_A, level + 1, 2, 22, 0, PAL3, 1);
    tt_text(BG_A, "МЯЧИ", 28, 0, PAL0, 1); tt_num(BG_A, lives, 1, 33, 0, PAL3, 1);
    tt_text(BG_A, "РЕКОРД", 14, 1, PAL0, 1); tt_num(BG_A, best, 6, 21, 1, PAL3, 1);
}

static void load_level(void)
{
    const char *L = levels[level % NLEVELS];
    left = 0;
    for (u8 r = 0; r < ROWS; r++)
        for (u8 c = 0; c < COLS; c++) {
            char ch = L[r * COLS + c];
            u8 b = 0;
            switch (ch) { case 'r': b = 1; break; case 'o': b = 2; break; case 'y': b = 3; break; case 'g': b = 4; break;
                          case 'b': b = 5; break; case 'p': b = 6; break; case 's': b = 7; break; }
            bricks[r][c] = b; if (b) left++;
            draw_brick(c, r);
        }
    speed = 40 + (level > 6 ? 6 : level) * 4;    // 2,5 px/кадр и быстрее с уровнем
    hits = 0;
}

static void serve(void)
{
    stuck = TRUE; vx = 0; vy = 0;
    tt_textc(BG_A, "НАЖМИТЕ A - ПОДАЧА", 18, PAL3, 1);
}

static void new_game(void)
{
    VDP_clearPlane(BG_A, TRUE);
    draw_frame();
    score = 0; lives = 3; level = 0;
    px = 160 - PW / 2; pvx = 0;
    load_level(); hud(); serve();
    tt_music_stop();
}

static void launch(void)
{
    stuck = FALSE;
    u8 d = 5 + (tt_rand(2) ? 2 : -2);
    vx = (dirx[d] * speed) >> 8; vy = (diry[d] * speed) >> 8;
    tt_clear_row(BG_A, 18);
    tt_sfx(0, N_G4, N_C5, 6, 2);
}

/* удар в кирпич в клетке тайлов (tx, ty) — вернёт TRUE, если там был кирпич */
static bool hit_cell(s16 tx, s16 ty)
{
    s16 r = ty - BRICK_Y0, c = (tx - 1) >> 1;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || tx < 1) return FALSE;
    u8 b = bricks[r][c];
    if (!b) return FALSE;
    if (b == 7) { bricks[r][c] = 8; score += 5; tt_sfx(1, 1400, 1100, 5, 2); }
    else {
        bricks[r][c] = 0; left--;
        score += (b == 8) ? 50 : (ROWS - r) * 10;
        tt_sfx(1, 700 + (ROWS - r) * 120, 900 + (ROWS - r) * 120, 5, 1);
        hits++;
        if ((hits & 7) == 0 && speed < 88) speed += 4;      // разгоняемся понемногу
    }
    draw_brick(c, r);
    hud();
    return TRUE;
}

static void renorm(void)
{
    // держим модуль скорости ≈ speed, не даём мячу лететь почти горизонтально
    s32 ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy;
    if (ay < speed / 3) { ay = speed / 3; vy = vy < 0 ? -ay : ay; }
    s32 len = ax > ay ? ax + ay / 2 : ay + ax / 2;          // быстрая оценка модуля
    if (len) { vx = vx * speed / len; vy = vy * speed / len; }
}

static void lose_ball(void)
{
    tt_sfx(0, N_E4, N_C3, 30, 1); tt_noise(20, 4, PSG_NOISE_TYPE_WHITE, PSG_NOISE_FREQ_CLOCK8);
    if (lives) lives--;
    hud();
    if (!lives) {
        if (score > best) best = score;
        hud();
        tt_textc(BG_A, " ИГРА ОКОНЧЕНА ", 16, PAL3, 1);
        tt_textc(BG_A, " НАЖМИТЕ START ", 18, PAL0, 1);
        stuck = TRUE; vy = 0;
        return;
    }
    serve();
}

static void update_ball(void)
{
    if (stuck) { bx = (px + PW / 2 - 3) * 16; by = (PADDLE_Y - 7) * 16; return; }
    s32 nx = bx + vx, ny = by + vy;
    s16 x = nx >> 4, y = ny >> 4;                            // мяч 6×6, верхний левый угол (+1 в спрайте)
    // стены
    if (x < FX0) { x = FX0; nx = x << 4; vx = -vx; tt_sfx(2, 500, 450, 3, 4); }
    if (x + 6 > FX1) { x = FX1 - 6; nx = x << 4; vx = -vx; tt_sfx(2, 500, 450, 3, 4); }
    if (y < FY0) { y = FY0; ny = y << 4; vy = -vy; tt_sfx(2, 500, 450, 3, 4); }
    // кирпичи: по осям отдельно
    s16 ox = bx >> 4, oy = by >> 4;
    if (vy && (hit_cell((x + 3) >> 3, (vy < 0 ? y : y + 5) >> 3))) { vy = -vy; ny = by; }
    else if (vx && (hit_cell((vx < 0 ? x : x + 5) >> 3, (oy + 3) >> 3))) { vx = -vx; nx = bx; }
    (void) ox;
    // ракетка
    if (vy > 0 && y + 6 >= PADDLE_Y && y + 6 <= PADDLE_Y + 6 && x + 6 >= px && x <= px + PW) {
        s16 off = (x + 3) - px;                              // 0..32
        s16 d = (off * 11) / (PW + 1); if (d < 0) d = 0; if (d > 10) d = 10;
        d += pvx > 1 ? 1 : (pvx < -1 ? -1 : 0);               // «подкрутка» ракеткой
        if (d < 0) d = 0;
        if (d > 10) d = 10;
        vx = (dirx[d] * speed) >> 8; vy = (diry[d] * speed) >> 8;
        ny = (PADDLE_Y - 6) << 4;
        tt_sfx(0, 350, 420, 5, 2);
    }
    bx = nx; by = ny;
    renorm();
    if ((by >> 4) > 228) lose_ball();
    if (!left) {
        level++;
        tt_music(m_clear, b_clear, FALSE);
        tt_textc(BG_A, " УРОВЕНЬ ПРОЙДЕН! ", 16, PAL3, 1);
        for (u8 f = 0; f < 90; f++) { tt_sound_update(); SYS_doVBlankProcess(); }
        tt_clear_row(BG_A, 16);
        load_level(); hud(); serve();
    }
}

static void draw_sprites(void)
{
    VDP_setSpriteFull(0, bx >> 4, (by >> 4) - 1, SPRITE_SIZE(1, 1), TILE_ATTR_FULL(PAL2, 1, 0, 0, T_BALL), 1);
    VDP_setSpriteFull(1, px, PADDLE_Y, SPRITE_SIZE(4, 1), TILE_ATTR_FULL(PAL2, 1, 0, 0, T_PADDLE), 0);
    VDP_updateSprites(2, DMA_QUEUE);
}

static void title(void)
{
    VDP_clearPlane(BG_A, TRUE);
    draw_frame();
    u16 x0 = (40 - TITLE_W) / 2;
    for (u16 y = 0; y < TITLE_H; y++) for (u16 x = 0; x < TITLE_W; x++)
        VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, 1, 0, 0, TITLE_BASE + y * TITLE_W + x), x0 + x, 6 + y);
    // витрина кирпичей
    for (u8 c = 0; c < 7; c++) { bricks[7][c + 6] = c + 1; draw_brick(c + 6, 7); }
    tt_textc(BG_A, "ВЫБЕЙ ВСЕ КИРПИЧИ!", 14, PAL0, 1);
    tt_textc(BG_A, "КРЕСТОВИНА - РАКЕТКА", 17, PAL0, 1);
    tt_textc(BG_A, "A - ПОДАЧА, START - ПАУЗА", 19, PAL0, 1);
    tt_textc(BG_A, "TUBE TV 1995", 27, PAL0, 1);
    px = 144; bx = 157 * 16; by = 150 * 16; stuck = FALSE;
    tt_music(m_title, b_title, TRUE);
    u16 f = 0;
    while (1) {
        u16 j = JOY_readJoypad(JOY_1);
        if ((j & (BUTTON_START | BUTTON_A | BUTTON_B | BUTTON_C)) && !(prevJoy & (BUTTON_START | BUTTON_A | BUTTON_B | BUTTON_C))) { prevJoy = j; break; }
        prevJoy = j;
        if ((f % 40) == 0) tt_textc(BG_A, "НАЖМИТЕ START", 22, PAL3, 1);
        if ((f % 40) == 26) tt_clear_row(BG_A, 22);
        // мяч прыгает по заставке
        bx = (40 + (f * 3) % 240) * 16; by = (PADDLE_Y - 8 - (abs(((s16) (f * 4) % 120) - 60))) * 16;
        px = (bx >> 4) - 13;
        draw_sprites();
        f++;
        tt_sound_update(); SYS_doVBlankProcess();
    }
    setRandomSeed(f * 17 + 3);
}

int main(bool hard)
{
    tt_init(font_data, FONT_TILES);
    VDP_loadTileData(bg_data, TB, BG_TILES, DMA);
    VDP_loadTileData(paddle_data, T_PADDLE, 4, DMA);
    VDP_loadTileData(ball_data, T_BALL, 1, DMA);
    VDP_loadTileData(title_data, TITLE_BASE, TITLE_W * TITLE_H, DMA);
    PAL_setPalette(PAL0, pal_text, DMA);
    PAL_setPalette(PAL1, pal_a, DMA);
    PAL_setPalette(PAL2, pal_b, DMA);
    PAL_setPalette(PAL3, pal_text_y, DMA);
    VDP_setBackgroundColor(16 + 1);
    best = 0;
    title();
    new_game();
    bool paused = FALSE;
    while (1) {
        u16 j = JOY_readJoypad(JOY_1), pressed = j & ~prevJoy;
        prevJoy = j;
        if (!lives) {
            if (pressed & BUTTON_START) new_game();
        } else {
            if (pressed & BUTTON_START && !stuck) {
                paused = !paused;
                if (paused) tt_textc(BG_A, " ПАУЗА ", 18, PAL3, 1); else tt_clear_row(BG_A, 18);
            }
            if (!paused) {
                s16 acc = (j & (BUTTON_B | BUTTON_C)) ? 2 : 1;          // B/C — быстрее
                if (j & BUTTON_LEFT) pvx = pvx > -5 * acc ? pvx - acc : -5 * acc;
                else if (j & BUTTON_RIGHT) pvx = pvx < 5 * acc ? pvx + acc : 5 * acc;
                else pvx = pvx / 2;
                px += pvx;
                if (px < FX0) { px = FX0; pvx = 0; }
                if (px > FX1 - PW) { px = FX1 - PW; pvx = 0; }
                if (stuck && (pressed & (BUTTON_A | BUTTON_B | BUTTON_C | BUTTON_UP))) launch();
                update_ball();
            }
        }
        draw_sprites();
        tt_sound_update();
        SYS_doVBlankProcess();
    }
    return 0;
}
