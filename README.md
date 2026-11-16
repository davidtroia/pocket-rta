# Pocket RTA by Balance Digital LLC — GUI prototype and asset pack (v1.0)

A working, mobile-first prototype of Pocket RTA, a measurement app for sound engineers, plus store-ready artwork.

Live: https://davidtroia.github.io/pocket-rta/

## Open the prototype

Microphone access only works over `http://localhost` or HTTPS, so serve the folder rather than opening the file directly:

```bash
cd pocket-rta
python3 -m http.server 8765
# then open http://localhost:8765
```

- On a desktop the app appears inside a phone frame (390 × 844). On a phone it fills the screen. Add `?frame=0` or `?frame=1` to force either layout.
- The app starts with a **simulated signal**: pink noise through a typical room response, with an occasional ringing tone. Tap **SIM** (top right) or Settings → *Use microphone* to switch to the live mic.
- Desktop keys: `1`–`5` switch screens, `F` freeze, `R` reset peaks, `M` mic on/off. Touch or hover over the RTA or waterfall to read the frequency and level at the cursor.

## Screens

| Screen | What it does |
|---|---|
| **RTA** | 1/1, 1/3 (31 bands, 20 Hz–20 kHz), 1/6 and 1/12-octave bars. Smoothed curve, peak hold, Z/A/C weighting, Fast (125 ms) / Slow (1 s) / Infinite averaging, Freeze, Reset peaks. |
| **SPL** | Large dB SPL readout, A/C/Z weighting, Fast/Slow. Leq, Max, Min, integration time and a 2-minute level history with an 85 dB line. |
| **Waterfall** | Scrolling spectrogram at 1/24-octave resolution. 10/30/60 s history, 40/60/80 dB range, live dominant-frequency readout. |
| **Generator** | Pink noise, white noise, sine (20 Hz–20 kHz, ±⅓-octave steps, presets) and a log sweep (1/5/10/20 s), all played through Web Audio. Level is set in dBFS RMS, with a live output meter and output spectrum. |
| **Settings** | Input source, device picker, sample rate, analyzer details. Mic calibration (manual offset, or 3-second auto-calibration against a 94/104/114 dB reference). Display scale. About screen. |

Settings are saved in `localStorage`. Live input uses `getUserMedia` with AGC, echo cancellation and noise suppression turned off, feeding an 8192-point AnalyserNode for the RTA/waterfall and a 2048-point AnalyserNode for SPL (IEC 61672 A/C curves, exponential time weighting).

## Files

```
index.html, css/app.css, js/app.js   the prototype (no dependencies, fonts bundled in fonts/)
assets/icon/
  pocket-rta-icon.svg                vector master (full-bleed, for App Store / Play)
  pocket-rta-icon-rounded.svg        rounded-corner version for marketing and the web
  pocket-rta-mark.svg                mark only, transparent
  pocket-rta-icon-1024-appstore.png  App Store icon (opaque)
  ios/icon-{1024,180,167,152,120,87,80,76,58,40,29}.png
  android/playstore-icon-512.png
  android/adaptive-{foreground,background,monochrome}.svg / -432.png   adaptive icon layers (108 dp @ xxxhdpi)
  android/ic_launcher-{mdpi..xxxhdpi}.png                              legacy launcher icons
  web/icon-192.png, icon-512.png
assets/logo/
  pocket-rta-wordmark-{dark,light}.svg / -4096.png   dark = for dark backgrounds, light = for light backgrounds (transparent PNG)
  pocket-rta-mark-2048.png
assets/brand/                        Balance Digital parent brand
  balance-digital-logo-{dark,light}.svg / -4096.png  "bo" lockup, rebuilt as vector from the official artwork
  balance-digital-mark-dark.svg
  balance-digital-waveform-logo.svg / -4096.png      waveform lockup, rebuilt as vector
  source/                                            the original logo files as supplied
assets/splash/splash-1290x2796.png, splash-1242x2688.png
assets/screenshots/appstore/         5 captioned App Store screenshots, 1290 × 2796
assets/screenshots/raw/              the same 5 screens without captions, 1290 × 2796 (rendered from the prototype)
assets/feature/play-feature-graphic-1024x500.png
previews/                            headless verification captures of every screen
tools/                               scripts that rebuild every asset (see below)
```

Palette: teal `#1A8FC0` / `#2BB3E8`, steel blue `#6F86B8` and lavender `#A98BD0` / `#C3AEEA` come from the Balance Digital logos. Green `#3DDC84`, amber `#FFB020` and red `#FF4D4F` are used for metering. Fonts are Inter (UI), JetBrains Mono (readouts) and Montserrat (wordmark), all SIL OFL (licences in `fonts/`).

## Rebuilding the assets

Needs Node 18+ and `npm i playwright sharp opentype.js @fontsource/montserrat && npx playwright install chromium`.

```bash
python3 -m http.server 8765 &                      # from the project root
node tools/build-vectors.js      # SVG masters (text converted to outlines)
node tools/render-icons.js       # all icon / logo PNG sizes
node tools/render-marketing.js   # screenshots, splash screens, feature graphic
node tools/verify.js             # headless test of every screen and control, writes previews/
```

## Measurement limits

- **Uncalibrated by default.** The default 120 dB offset assumes a typical phone MEMS mic (94 dB SPL ≈ −26 dBFS). Actual mics vary by several dB, so calibrate with an acoustic calibrator for absolute SPL. Phone and browser inputs are not Class 1 or Class 2 instruments.
- Browsers and operating systems may still filter the input (for example a low-cut filter on some phones) even with processing turned off. Below ~40 Hz and above ~16 kHz, phone mics roll off.
- The analyzer window is 171 ms at 48 kHz, so the lowest 1/12-octave bands are interpolated from FFT bins. SPL Fast/Slow are computed per animation frame from a 43 ms window. That is close to, but not the same as, a sample-accurate IEC meter.
- The SPL meter weights each bin of a 2048-point FFT, which reads about +0.9 dB high for a pure tone near 63 Hz (IEC 61672 Class 2 allows ±1.5 dB there). Time-domain weighting filters would remove this.
- Generator noise levels are RMS and stop at −12 dBFS so 12 dB peaks never clip. Sine and sweep stop at −3 dBFS RMS (0 dBFS peak).
- The simulated signal is labelled **SIM** everywhere it is in use and is never mixed with a live mic input.

© 2026 Balance Digital LLC · Mississippi, USA

## Tests and deployment

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` runs the real app in Chromium and plays generated WAV files through Chromium's fake microphone, then checks the meter state: absolute level and A/C/Z weighting (a −26 dBFS 1 kHz tone must read 94 dB), Leq as an energy average, Fast time weighting on a 100 ms burst, and 1/3-octave band levels for a tone and for flat noise (including the lowest bands). Fixtures are generated at test time.

CI runs the tests on every pull request. On `main`, passing tests publish the app (not the store artwork or tooling) to GitHub Pages; Settings → Pages → Source must be "GitHub Actions".
