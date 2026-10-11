The flag font, `TwemojiCountryFlags.woff2`, is from
[country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill)
0.1.10, an npm package (`package.json` pins it): `scripts/dist.sh` copies its
`dist/TwemojiCountryFlags.woff2` to `fonts/` on the site. Windows has no flag
emoji (it shows 🇬🇷 as "GR"), so `site.css`'s `@font-face` uses this font for
flag characters only; browsers download it only when a flag is on screen.

The flag art is [Twemoji](https://github.com/twitter/twemoji), © Twitter,
used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
