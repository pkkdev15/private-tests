# Blind Date Language Test 💘

Romantic-date themed language proficiency tests. Mobile-first, plain HTML/CSS/JS, no build step.

## Run

- **From a web server** (recommended): `powershell -ExecutionPolicy Bypass -File serve.ps1`, then open http://localhost:8080.
  Any static hosting works the same way. Tests are always read live from the JSON files.
- **Straight from disk** (double-click `index.html`): works too, using `tests-data.js`, a bundled copy of the JSON files.
  Browsers block reading JSON from `file://`, so after editing tests run:

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

`serve.ps1` runs `build.ps1` automatically on start. Don't edit `tests-data.js` by hand.
`build.ps1` also stamps `?v=<timestamp>` on the CSS/JS links in `index.html`, so visitors get fresh files after each deploy - run it before every commit that changes code.

## Adding a test

1. Put the test file in `tests/` (copy an existing one as a template).
2. Register it in `tests.json`:

```json
{ "id": "polish", "file": "tests/polish-a1-c2.json", "emoji": "🇵🇱",
  "title": "Randka po polsku", "language": "Polish", "levels": "A1 - C2",
  "description": "Shown on the picker card." }
```

3. Run `build.ps1` (only needed for opening the page from disk).

The test list is always the first screen. Direct link to a test: `index.html?test=<id>`.

## Interface languages

The EN / PL / RU switch (top right) translates the interface. The choice is remembered in the browser;
the first visit picks the browser's language. Interface texts live in `i18n.js` - to add a language,
add it to `languages` and add a matching block in `strings`.

Any text in `tests.json` or a test file can be either a plain string or a per-language object.
The object is used for content that should follow the interface language (explanations, result descriptions):

```json
"explanation": { "en": "...", "pl": "...", "ru": "..." }
```

Missing languages fall back to `en`. Questions themselves are normally plain strings in the language being tested.

## Gender variants

The first screen asks the user's gender (man / woman / rather not say; remembered in the browser).
Any question may override fields per gender - `m` and `f`; "rather not say" uses the base version,
so keep the base text gender-neutral where possible:

```json
{
  "question": "Mam 32 lata, własne mieszkanie i ____ duszę.",
  "options": ["romantyczną", "..."],
  "variants": {
    "m": { "question": "Jestem ____, mam 32 lata...", "options": ["romantykiem", "..."] },
    "f": { "question": "Jestem ____, mam 32 lata...", "options": ["romantyczką", "..."] }
  }
}
```

Interface texts in `i18n.js` can be gendered the same way: `{ m: "...", f: "...", x: "..." }`.
Professor Pigeon's lines (praise, threats, final warnings, result verdicts) are also in `i18n.js`.

## Test file format

| Key | Meaning |
| --- | --- |
| `lang` | Language code for the page while the test runs (e.g. `pl`) |
| `title`, `subtitle` | Text on the test's welcome screen |
| `settings.shuffleQuestions` | Randomise question order |
| `settings.shuffleOptions` | Randomise answer order |
| `settings.questionsPerTest` | Number of questions per run (`null` = all) |
| `reactions.correct` / `.wrong` | Random date reactions after each answer |
| `levels[]` | `minPercent`, `code`, `emoji`, `title`, `description` - result by score % |
| `questions[]` | `level`, `scenario`, `question`, `options[]`, `answer` (0-based index), `explanation` |

## Color themes

The swatches next to the language switch change the color theme: Pink, Graphite (dark, the default),
Dark green and Burgundy. The choice is remembered in the browser and applied before the first paint.

All colors in `style.css` come from CSS variables defined once per theme at the top of the file
(`:root` = Pink, `:root[data-theme="graphite"]`, `...="green"`, `...="burgundy"`).
To add a theme: copy one of those blocks with a new name, add a swatch class (`.swatch-<name>`)
and an entry in `THEMES` in `app.js`, plus its name in `i18n.js`.

## Lessons

The start screen has two tabs: **Tests** and **Lessons**. Lessons are short (3 cards + 3 exercises),
and progress (completed lessons + best score) is saved per browser in `localStorage`.

`lessons.json` lists the courses; each course file (e.g. `lessons/polish.json`) looks like this:

```json
{
  "id": "polish", "lang": "pl", "emoji": "🇵🇱", "title": "Polski na randce",
  "subtitle": { "en": "...", "pl": "...", "ru": "..." },
  "categories": [
    { "id": "sayings", "emoji": "🦉", "title": { "en": "Sayings", "pl": "Powiedzenia", "ru": "..." },
      "lessons": [
        { "id": "sayings-love", "level": "B1", "title": { "...": "..." },
          "cards": [ { "phrase": "Kto się czubi, ten się lubi.", "meaning": { "en": "...", "pl": "...", "ru": "..." }, "example": "...", "note": "optional" } ],
          "practice": [ { "question": "...", "options": ["...", "..."], "answer": 0, "explanation": { "...": "..." } } ] }
      ] }
  ]
}
```

Progress is keyed by `course id / lesson id` - keep ids stable when editing, or users lose that lesson's progress.
Cards and exercises support the same `variants` (m/f) and per-language texts as tests. Run `build.ps1` after editing.
