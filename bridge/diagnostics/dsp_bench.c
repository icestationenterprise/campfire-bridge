/*
 * dsp_bench.c — portable single-thread audio-DSP benchmark for Campfire Bridge.
 *
 * Purpose: produce ONE number that can be compared across boards you own and
 * boards you are thinking of buying, so you can predict whether a cheaper SoC
 * can run the Campfire audio path before spending money on it.
 *
 * It runs three kernels that stand in for the real work PulseAudio does:
 *   1. fir     — 32-tap float FIR  (stands in for shairport-sync soxr interpolation)
 *   2. subband — 8-band int32 analysis butterfly (stands in for SBC A2DP encoding)
 *   3. mix     — N-stream float mix + per-stream volume (stands in for the
 *                null-sink + module-loopback fan-out)
 *
 * Each kernel processes exactly SECONDS of 44.1kHz stereo audio. The score is
 * the realtime factor (RTF): how many seconds of audio the board can push
 * through that kernel per second of CPU time. RTF 50 = 50x realtime = the
 * kernel costs 2% of one core per stream.
 *
 * Single-threaded on purpose. The production bottleneck is one PulseAudio
 * thread, so extra cores do not help and must not flatter the score.
 *
 * Every kernel cycles through a multi-block input ring and feeds its own
 * accumulator back into the input. That serial dependency is deliberate: it
 * stops the compiler hoisting identical blocks out of the loop, which would
 * otherwise report impossible scores.
 *
 * Build:  cc -O2 -o dsp_bench dsp_bench.c -lm
 * Run:    taskset -c 0 ./dsp_bench
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <time.h>

#define SR       44100
#define SECONDS  60
#define BLOCK    1024
#define RING     16     /* blocks of input cycled through, ~128 KB working set */
#define TAPS     32
#define STREAMS  4      /* 3 BT speakers + 1 built-in — the Extended SKU worst case */

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

static volatile double sink_f;   /* keeps the optimiser honest */
static volatile long   sink_i;

/* ---- kernel 1: 32-tap FIR over stereo, mimics soxr resampling ------------- */
static double bench_fir(long frames) {
    size_t ringlen = (size_t)BLOCK * 2 * RING;
    float *in   = malloc(ringlen * sizeof(float));
    float *hist = calloc(TAPS * 2, sizeof(float));
    float coef[TAPS];
    double t0, acc = 0.0;
    long i, n, t, done = 0, blk = 0;

    for (i = 0; i < TAPS; i++) coef[i] = (float)(0.5 - 0.5 * cos(2.0 * M_PI * i / TAPS)) / TAPS;
    for (i = 0; i < (long)ringlen; i++) in[i] = (float)sin(i * 0.01);

    t0 = now_s();
    while (done < frames) {
        long off = (blk % RING) * BLOCK * 2;
        in[off] += (float)(acc * 1e-9);          /* serial dependency */
        for (n = 0; n < BLOCK; n++) {
            float l = 0.f, r = 0.f;
            memmove(hist + 2, hist, (TAPS - 1) * 2 * sizeof(float));
            hist[0] = in[off + n * 2];
            hist[1] = in[off + n * 2 + 1];
            for (t = 0; t < TAPS; t++) { l += hist[t * 2] * coef[t]; r += hist[t * 2 + 1] * coef[t]; }
            acc += l + r;
        }
        done += BLOCK;
        blk++;
    }
    sink_f = acc;
    free(in); free(hist);
    return now_s() - t0;
}

/* ---- kernel 2: 8-subband int analysis, mimics SBC encode ------------------ */
static double bench_subband(long frames) {
    size_t ringlen = (size_t)BLOCK * 2 * RING;
    int32_t *pcm = malloc(ringlen * sizeof(int32_t));
    int32_t  band[8];
    double t0;
    long i, n, b, done = 0, blk = 0, acc = 0;

    for (i = 0; i < (long)ringlen; i++) pcm[i] = (int32_t)(sin(i * 0.013) * 20000);

    t0 = now_s();
    while (done < frames) {
        long off = (blk % RING) * BLOCK * 2;
        pcm[off] += (int32_t)(acc & 0x7);        /* serial dependency */
        for (n = 0; n + 8 <= BLOCK; n += 8) {
            for (b = 0; b < 8; b++) {
                int32_t s = 0;
                for (i = 0; i < 8; i++)
                    s += (pcm[off + (n + i) * 2] * (int32_t)((b * i) % 7 + 1)) >> 3;
                band[b] = s;
            }
            for (b = 0; b < 8; b++) {            /* scale-factor + quantise pass */
                int32_t v = band[b] < 0 ? -band[b] : band[b];
                int sf = 0;
                while (v > (1 << sf) && sf < 15) sf++;
                acc += (band[b] >> (sf > 3 ? sf - 3 : 0)) & 0xFF;
            }
        }
        done += BLOCK;
        blk++;
    }
    sink_i = acc;
    free(pcm);
    return now_s() - t0;
}

/* ---- kernel 3: N-stream mix + volume, mimics loopback fan-out ------------- */
static double bench_mix(long frames) {
    size_t ringlen = (size_t)BLOCK * 2 * RING;
    float *src = malloc(ringlen * sizeof(float));
    float *out[STREAMS];
    float  vol[STREAMS];
    double t0, acc = 0.0;
    long i, n, s, done = 0, blk = 0;

    for (s = 0; s < STREAMS; s++) { out[s] = malloc(BLOCK * 2 * sizeof(float)); vol[s] = 0.3f + 0.15f * s; }
    for (i = 0; i < (long)ringlen; i++) src[i] = (float)sin(i * 0.007);

    t0 = now_s();
    while (done < frames) {
        long off = (blk % RING) * BLOCK * 2;
        src[off] += (float)(acc * 1e-9);         /* serial dependency */
        for (s = 0; s < STREAMS; s++)
            for (n = 0; n < BLOCK * 2; n++)
                out[s][n] = src[off + n] * vol[s];
        for (s = 0; s < STREAMS; s++)            /* read back, varying index */
            acc += out[s][blk % (BLOCK * 2)];
        done += BLOCK;
        blk++;
    }
    sink_f = acc;
    free(src);
    for (s = 0; s < STREAMS; s++) free(out[s]);
    return now_s() - t0;
}

int main(void) {
    long frames = (long)SR * SECONDS;
    double t_fir, t_sub, t_mix, total;
    char model[128] = "unknown";
    FILE *f = fopen("/proc/device-tree/model", "r");
    if (f) { if (!fgets(model, sizeof model, f)) strcpy(model, "unknown"); fclose(f); }

    printf("board          : %s\n", model);
    printf("audio          : %d s of %d Hz stereo per kernel, single thread\n\n", SECONDS, SR);

    t_fir = bench_fir(frames);
    t_sub = bench_subband(frames);
    t_mix = bench_mix(frames);
    total = t_fir + t_sub + t_mix;

    printf("%-10s %10s %12s %14s\n", "kernel", "seconds", "realtime x", "cost %of 1 core");
    printf("%-10s %10.3f %12.1f %14.2f\n", "fir",     t_fir, SECONDS / t_fir, 100.0 * t_fir / SECONDS);
    printf("%-10s %10.3f %12.1f %14.2f\n", "subband", t_sub, SECONDS / t_sub, 100.0 * t_sub / SECONDS);
    printf("%-10s %10.3f %12.1f %14.2f\n", "mix",     t_mix, SECONDS / t_mix, 100.0 * t_mix / SECONDS);
    printf("%-10s %10.3f %12.1f %14.2f\n", "TOTAL",   total, SECONDS / total, 100.0 * total / SECONDS);
    printf("\nSCORE=%.1f\n", SECONDS / total);
    printf("# Higher is faster. Compare boards with this one number.\n");
    printf("# 'mix' is expected to be near-free (small in-cache buffers); it is here\n");
    printf("# to catch boards with pathological memory bandwidth, not to dominate.\n");
    printf("# These percentages are NOT the real PulseAudio cost -- they exclude the\n");
    printf("# kernel, BlueZ and syscall overhead. Use SCORE only as a RELATIVE\n");
    printf("# predictor, calibrated against a measured run on a board you own.\n");
    return 0;
}
