# Pocket RTA prototype

Single-page web prototype of the Pocket RTA spectrum analyzer / SPL meter.
Audio is processed entirely in the browser; nothing is recorded or sent anywhere.

Live: https://davidtroia.github.io/pocket-rta/

Open the site, tap Start measuring, allow the microphone.

Not a certified measurement instrument. Readings are only meaningful after the
calibration offset (Cal) has been matched to a reference meter or calibrator.

## Development

    npm test

Runs the DSP checks against the real code in `index.html`. No dependencies.
Pushing to `main` runs the tests and, if they pass, publishes `index.html` to
GitHub Pages (Settings > Pages > Source must be "GitHub Actions").
