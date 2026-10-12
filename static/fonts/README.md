The site's fonts come from npm packages (`package.json` pins them; Dependabot
bumps them): `site-fonts` in `site.el` names each and the build publishes it
under a hashed name in `fonts/` on the site, kept by browsers for good, so a
new version is a new name. `site.css`'s `@font-face` rules name them.

`Bricolage Grotesque`, the site's typeface, is
[@fontsource-variable/bricolage-grotesque](https://fontsource.org/fonts/bricolage-grotesque):
the variable font (weight, width and optical size) in its latin and latin-ext
subsets; the second is fetched only for a character the first lacks. Served
from here rather than Google Fonts, so no page waits on a third party's
stylesheet. © The Bricolage Grotesque Project Authors
(https://github.com/ateliertriay/bricolage), under the
[SIL Open Font License 1.1](https://openfontlicense.org).

The flag font, `TwemojiCountryFlags.woff2`, is from
[country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill).
Windows has no flag emoji (it shows 🇬🇷 as "GR"), so `site.css`'s `@font-face`
uses this font for flag characters only; browsers download it only when a flag
is on screen. The flag art is [Twemoji](https://github.com/twitter/twemoji),
© Twitter, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
