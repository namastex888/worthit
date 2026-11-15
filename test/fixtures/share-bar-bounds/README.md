# Share bar bounds (#70)

`node test/fixtures/share-bar-bounds/check.mjs` invokes the real `share value`
CLI against a synthetic saved run in an isolated HOME and WORTHIT_HOME, with
cache disabled and `--ai no --no-files`. The runner requires this fixture in
`make check`.

The first case is a $6 weekly allowance against a $46 weekly plan price.
The source ratio is deliberately still 46/6: it compares price with allowance
value, so exceeding 1 is valid. Only the terminal drawing is bounded. The
fixture pins the source currencies, headline multiple and printed post, and
also covers zero allowance (infinity), zero/zero (NaN), negative allowance and
an ordinary ratio. No source logs, accounts, network, clipboard or desktop
session are used.

`terminal.png` is an inspected rendering of the actual corrected `share value
--ai no --no-files` terminal output for the $6/$46 case, captured in a scratch
pseudo-terminal and rasterized from its ANSI text. Both rows contain 20 cells;
$6, $46 and 0.13× remain unchanged. The X prompt was answered `n`. Headless
Chrome wrote this image, then exited 2 during teardown; the CLI itself exited
0. This is terminal drawing evidence, not a successful image-export check.
