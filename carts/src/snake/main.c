// «ЗМЕЙКА» — картридж Tube TV. Двор 38×22 клетки, яблоки, золотые груши, скорость растёт.
#include <genesis.h>
#include "tt.h"
#include "gfx.h"

#define GW 38
#define GH 22
#define OX 1          // поле на экране: x 1..38, y 4..25
#define OY 4
#define MAXLEN (GW * GH)

#define TB (TT_FREE_BASE)
#define TITLE_BASE (TB + GAME_TILES)

static u8 sx[MAXLEN], sy[MAXLEN];
static u16 head, len;               // кольцевой буфер: голова — sx[head]
static s8 dx, dy;
static s8 qdx[2], qdy[2]; static u8 qn;
static u8 grid[GW][GH];             // 1 — змея
static u8 ax, ay, px, py; static bool pear; static u16 pearTimer;
static u16 score, best, eaten;
static u8 speed, tick;
static bool alive, paused;
static u16 prevJoy;

static const TTNote m_title[] = {
    {N_E4, 10}, {N_G4, 10}, {N_A4, 10}, {N_G4, 10}, {N_E4, 10}, {N_D4, 10}, {N_C4, 20},
    {N_D4, 10}, {N_E4, 10}, {N_G4, 10}, {N_E4, 10}, {N_D4, 20}, {0, 20},
    {N_E4, 10}, {N_G4, 10}, {N_A4, 10}, {N_C5, 10}, {N_B4, 10}, {N_G4, 10}, {N_A4, 20},
    {N_G4, 10}, {N_E4, 10}, {N_D4, 10}, {N_E4, 10}, {N_C4, 30}, {0, 30}, {0, 0} };
static const TTNote b_title[] = {
    {N_C3, 20}, {N_G3, 20}, {N_A3, 20}, {N_E3, 20}, {N_F3, 20}, {N_C3, 20}, {N_G3, 40}, {0, 20},
    {N_C3, 20}, {N_G3, 20}, {N_A3, 20}, {N_E3, 20}, {N_F3, 20}, {N_G3, 20}, {N_C3, 40}, {0, 20}, {0, 0} };

static void cell(u8 x, u8 y, u16 tile, u16 pal, bool fh, bool fv)
{
    VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(pal, 1, fv, fh, TB + tile), OX + x, OY + y);
}
static void clear_cell(u8 x, u8 y) { VDP_setTileMapXY(BG_A, 0, OX + x, OY + y); }

static void draw_field(void)
{
    for (u16 y = 0; y < GH; y++)
        for (u16 x = 0; x < GW; x++)
            VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + (((x + y) & 1) ? T_GRASS_A : T_GRASS_B)), OX + x, OY + y);
    for (u16 x = 0; x < 40; x++) {
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + T_WALL), x, OY - 1);
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + T_WALL), x, OY + GH);
    }
    for (u16 y = OY - 1; y <= OY + GH; y++) {
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + T_WALL), 0, y);
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TB + T_WALL), 39, y);
    }
}

static void hud(void)
{
    tt_text(BG_A, "ОЧКИ", 2, 1, PAL0, 1); tt_num(BG_A, score, 5, 7, 1, PAL3, 1);
    tt_text(BG_A, "РЕКОРД", 25, 1, PAL0, 1); tt_num(BG_A, best, 5, 32, 1, PAL3, 1);
    tt_text(BG_A, "ДЛИНА", 14, 2, PAL0, 1); tt_num(BG_A, len, 3, 20, 2, PAL3, 1);
}

static void place_apple(void)
{
    do { ax = tt_rand(GW); ay = tt_rand(GH); } while (grid[ax][ay] || (pear && ax == px && ay == py));
    cell(ax, ay, T_APPLE, PAL2, 0, 0);
}
static void place_pear(void)
{
    do { px = tt_rand(GW); py = tt_rand(GH); } while (grid[px][py] || (px == ax && py == ay));
    pear = TRUE; pearTimer = 60 * 7;
    cell(px, py, T_PEAR, PAL2, 0, 0);
    tt_sfx(2, N_C6, N_G5, 10, 3);
}

static void draw_head(void)
{
    u8 x = sx[head], y = sy[head];
    if (dx) cell(x, y, T_HEAD_R, PAL2, dx < 0, 0);
    else cell(x, y, T_HEAD_U, PAL2, 0, dy > 0);
}

static void new_game(void)
{
    memset(grid, 0, sizeof(grid));
    VDP_clearPlane(BG_A, TRUE);
    draw_field();
    len = 4; head = len - 1;
    for (u16 i = 0; i < len; i++) { sx[i] = 8 + i; sy[i] = GH / 2; grid[sx[i]][sy[i]] = 1; }
    for (u16 i = 1; i < len - 1; i++) cell(sx[i], sy[i], T_BODY, PAL2, 0, 0);
    cell(sx[0], sy[0], T_TAIL, PAL2, 0, 0);
    dx = 1; dy = 0; qn = 0;
    draw_head();
    score = 0; eaten = 0; speed = 8; tick = 0; pear = FALSE;
    alive = TRUE; paused = FALSE;
    place_apple();
    hud();
    tt_music_stop();
}

static void die(void)
{
    alive = FALSE;
    tt_noise(40, 0, PSG_NOISE_TYPE_WHITE, PSG_NOISE_FREQ_CLOCK4);
    tt_sfx(0, N_A4, N_C3, 40, 2);
    if (score > best) best = score;
    // змейка мигает
    for (u8 k = 0; k < 6; k++) {
        for (u16 i = 0; i < len; i++) {
            u16 j = (head + MAXLEN - i) % MAXLEN;
            if (k & 1) cell(sx[j], sy[j], i ? T_BODY : T_HEAD_U, PAL2, 0, 0); else clear_cell(sx[j], sy[j]);
        }
        for (u8 f = 0; f < 8; f++) { tt_sound_update(); SYS_doVBlankProcess(); }
    }
    tt_textc(BG_A, " ИГРА ОКОНЧЕНА ", 13, PAL3, 1);
    tt_textc(BG_A, " НАЖМИТЕ START ", 15, PAL0, 1);
    hud();
}

static void step(void)
{
    if (qn) { dx = qdx[0]; dy = qdy[0]; qdx[0] = qdx[1]; qdy[0] = qdy[1]; qn--; }
    s16 nx = sx[head] + dx, ny = sy[head] + dy;
    bool grow = (nx == ax && ny == ay) || (pear && nx == px && ny == py);
    u16 tailI = (head + MAXLEN - (len - 1)) % MAXLEN;
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || (grid[nx][ny] && !(nx == sx[tailI] && ny == sy[tailI] && !grow))) { die(); return; }
    // старая голова становится телом
    cell(sx[head], sy[head], T_BODY, PAL2, 0, 0);
    if (!grow) {
        grid[sx[tailI]][sy[tailI]] = 0; clear_cell(sx[tailI], sy[tailI]);
        u16 nt = (tailI + 1) % MAXLEN; cell(sx[nt], sy[nt], T_TAIL, PAL2, 0, 0);
    } else len++;
    head = (head + 1) % MAXLEN;
    sx[head] = nx; sy[head] = ny; grid[nx][ny] = 1;
    draw_head();
    if (nx == ax && ny == ay) {
        score += 10 + (8 - (speed > 8 ? 8 : speed)) * 2; eaten++;
        tt_sfx(1, N_C5, N_C6, 6, 1);
        if (eaten % 4 == 0 && speed > 3) speed--;
        place_apple();
        if (eaten % 5 == 0 && !pear) place_pear();
        hud();
    } else if (pear && nx == px && ny == py) {
        score += 100; pear = FALSE;
        tt_sfx(1, N_E5, N_C6, 4, 1); tt_sfx(2, N_G5, N_C6, 12, 2);
        hud();
    }
}

static void title(void)
{
    VDP_clearPlane(BG_A, TRUE); VDP_clearPlane(BG_B, TRUE);
    draw_field();
    // крупная надпись
    u16 x0 = (40 - TITLE_W) / 2, y0 = 6;
    for (u16 y = 0; y < TITLE_H; y++) for (u16 x = 0; x < TITLE_W; x++)
        VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, 1, 0, 0, TITLE_BASE + y * TITLE_W + x), x0 + x, y0 + y);
    tt_textc(BG_A, "ВО ДВОРЕ, ГДЕ РАСТУТ ЯБЛОНИ", 14, PAL0, 1);
    tt_textc(BG_A, "КРЕСТОВИНА - ПОВОРОТЫ", 18, PAL0, 1);
    tt_textc(BG_A, "ЗОЛОТАЯ ГРУША - 100 ОЧКОВ", 20, PAL0, 1);
    tt_textc(BG_A, "TUBE TV 1995", 25, PAL0, 1);
    tt_music(m_title, b_title, TRUE);
    u16 f = 0;
    while (1) {
        u16 j = JOY_readJoypad(JOY_1);
        if ((j & (BUTTON_START | BUTTON_A | BUTTON_B | BUTTON_C)) && !(prevJoy & (BUTTON_START | BUTTON_A | BUTTON_B | BUTTON_C))) { prevJoy = j; break; }
        prevJoy = j;
        if ((f % 40) == 0) tt_textc(BG_A, "НАЖМИТЕ START", 22, PAL3, 1);
        if ((f % 40) == 26) tt_clear_row(BG_A, 22);
        f++;
        tt_sound_update(); SYS_doVBlankProcess();
    }
    setRandomSeed(f * 31 + 7);
}

int main(bool hard)
{
    tt_init(font_data, FONT_TILES);
    VDP_loadTileData(game_data, TB, GAME_TILES, DMA);
    VDP_loadTileData(title_data, TITLE_BASE, TITLE_W * TITLE_H, DMA);
    PAL_setPalette(PAL0, pal_text, DMA);
    PAL_setPalette(PAL1, pal_field, DMA);
    PAL_setPalette(PAL2, pal_snake, DMA);
    PAL_setPalette(PAL3, pal_text_y, DMA);   // жёлтые буквы
    VDP_setBackgroundColor(0);
    best = 0;
    title();
    new_game();
    while (1) {
        u16 j = JOY_readJoypad(JOY_1), pressed = j & ~prevJoy;
        prevJoy = j;
        if (!alive) {
            if (pressed & (BUTTON_START | BUTTON_A | BUTTON_B | BUTTON_C)) new_game();
        } else {
            if (pressed & BUTTON_START) {
                paused = !paused;
                if (paused) tt_textc(BG_A, " ПАУЗА ", 13, PAL3, 1); else { draw_field(); /* перерисовка не нужна для змеи — она на плоскости A */ tt_clear_row(BG_A, 13);
                    for (u16 i = 0; i < len; i++) { u16 k = (head + MAXLEN - i) % MAXLEN; if (i == 0) draw_head(); else cell(sx[k], sy[k], i == len - 1 ? T_TAIL : T_BODY, PAL2, 0, 0); }
                    cell(ax, ay, T_APPLE, PAL2, 0, 0); if (pear) cell(px, py, T_PEAR, PAL2, 0, 0); }
            }
            if (!paused) {
                // повороты: очередь из двух нажатий, разворот на 180° запрещён
                s8 ndx = 0, ndy = 0;
                if (pressed & BUTTON_UP) ndy = -1; else if (pressed & BUTTON_DOWN) ndy = 1;
                else if (pressed & BUTTON_LEFT) ndx = -1; else if (pressed & BUTTON_RIGHT) ndx = 1;
                if (ndx || ndy) {
                    s8 ldx = qn ? qdx[qn - 1] : dx, ldy = qn ? qdy[qn - 1] : dy;
                    if (!(ndx == -ldx && ndy == -ldy) && !(ndx == ldx && ndy == ldy) && qn < 2) { qdx[qn] = ndx; qdy[qn] = ndy; qn++; }
                }
                if (pear && --pearTimer == 0) { pear = FALSE; clear_cell(px, py); }
                if (++tick >= speed) { tick = 0; step(); }
            }
        }
        tt_sound_update();
        SYS_doVBlankProcess();
    }
    return 0;
}
