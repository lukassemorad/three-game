# ThreeGame

Angular 22 + Three.js projekt pro experimentování s 3D hrou z pohledu první osoby — hráč se sekyrou kácející stromy v lese. **Aktuální stav: raný PoC** — ověřuje se pohyb, ovládání a základní vykreslování, žádná herní logika (kácení, inventář, ekonomika) zatím neexistuje.

## Struktura projektu (`src/app`)

```
core/
  engine/
    three-scene.service.ts   Three.js scéna, kamera, renderer, ovládání a render loop (jediné místo, kde žije Three.js logika)
features/
  game-canvas/               Hostitelská komponenta - <canvas>, "klikni pro start" overlay, napojuje ThreeSceneService
  hud/                       Crosshair + průsvitné "stat chips" nahoře (zlato, čas) - zatím placeholder hodnoty
  main-menu/                 Prázdný placeholder (bez obsahu/logiky)
  inventory/                 Prázdný placeholder (bez obsahu/logiky)
shared/                      Zatím prázdné - připraveno pro budoucí sdílené komponenty/utility
```

Routing (`app.routes.ts`): `''` → main-menu, `/game` → 3D scéna, `/inventory` → inventář.

## Ovládání (v `/game`)

- Klik do scény → aktivuje pointer lock (myš zamčená pro rozhlížení)
- **W/A/S/D** — pohyb po rovině
- **Myš** — rozhlížení
- **Mezerník** — skok (jednoduchá gravitace, žádné kolize s objekty)
- **Esc** — uvolní kurzor (zobrazí se zpět start overlay i HUD zmizí)

Ladicí konstanty jsou nahoře v `three-scene.service.ts`: `MOVE_SPEED`, `LOOK_SENSITIVITY`, `EYE_HEIGHT`, `GRAVITY`, `JUMP_SPEED`.

## Co v tomto PoC záměrně chybí

- Kolize se scénou (aktuálně se dá procházet skrz kvádry-orientační body i cokoliv jiného)
- Jakákoliv grafika/modely — jen základní Three.js primitiva (box, plane), žádné textury/GLTF modely
- Herní logika — kácení stromů, inventář, měna/čas v HUDu jsou jen natvrdo zapsané placeholder hodnoty

## Další fáze (plán)

Další v pořadí je **raycasting z kamery** — zjištění, na jaký objekt se hráč dívá a v jaké je vzdálenosti. To je základ pro:
- interakci se stromy (budoucí kácení sekerou)
- reaktivní crosshair (např. změna barvy, když se hráč dívá na interaktivní objekt)

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
