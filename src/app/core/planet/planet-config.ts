import * as THREE from 'three';

// Jediný zdroj pravdy pro rozměry a ladicí konstanty planetky - stejný princip jako
// world-config.ts u plochého světa. Prototyp je záměrně izolovaný, takže se s plochým
// světem nesdílí nic (viz plán) - `GRAVITY` je tady vlastní konstanta, ne import.

// Poloměr planety. Na kouli je měřítko přímý trade-off: horizont je vzdálený jen
// sqrt(2 * R * výška očí), takže při R=60 by byl ~14 m (stání na balvanu). Při R=150 je
// ~23 m a obvod 2*pi*150 = 942 m, tedy ~2,6 min obchůzky při MOVE_SPEED.
export const PLANET_RADIUS = 150;

// Frekvence subdivision geodesické koule. Level N dá 10*4^N+2 dlaždic (= vrcholů icosphere)
// a 20*4^N trojúhelníků topologie. Level 5 => 10 242 dlaždic, ~6,5 m napříč dlaždicí při
// R=150, ~61 440 trojúhelníků výsledného meshe (dnešní plochý terén má ~132 000).
// Zvednutí na 6 počet dlaždic zčtyřnásobí - dlaždice ~3,3 m, ale ~246k trojúhelníků.
export const PLANET_SUBDIVISION_LEVEL = 5;

// Chunky pro culling obsahu. 10 242 dlaždic je na rozhodování „zobrazit/skrýt" příliš jemné,
// takže se dlaždice seskupují podle nejbližšího vrcholu hrubší icosphere. Level 2 dá 162
// chunků, tj. ~63 dlaždic na chunk a ~1 700 m² na chunk při R=150.
export const CHUNK_SUBDIVISION_LEVEL = 2;

export const PLANET_CENTER = new THREE.Vector3(0, 0, 0);

// --- Relief ---
// Noise se vzorkuje na jednotkovém *směru*, takže "frekvence" znamená, na jak velké kouli
// v noise prostoru se vzorkuje. Útvary ImprovedNoise mají velikost ~1 jednotky, takže
// frekvence f dá po obvodu ~2*pi*f útvarů; při obvodu 942 m (R=150) je vlnová délka
// ~942/(2*pi*f) metrů. U všech hodnot níž je ta délka dopočítaná v komentáři.

// Velkoplošné zvlnění, ~67 m na útvar.
export const RELIEF_BASE_FREQ = 2.2;
export const RELIEF_BASE_AMPLITUDE = 5;

// Drobná členitost, ~15 m (~2,3 dlaždice). Jemnější už nemá smysl - dlaždice je ~6,5 m,
// takže kratší vlna by se vzorkováním po rozích aliasovala.
export const RELIEF_DETAIL_FREQ = 10;
export const RELIEF_DETAIL_AMPLITUDE = 1.2;

// Maska horských masivů, ~115 m na útvar - tedy útvary velikosti kontinentu, ne kopce.
// Tahle jedna maska řídí zároveň relief (kde vyrůstají hřebeny) i biom, takže hory a jejich
// biom jsou automaticky na stejném místě. Stejný princip jako getMountainBlend v plochém
// světě, jen s doménou `dir`.
export const MASSIF_FREQ = 1.3;
export const MASSIF_THRESHOLD_LOW = 0.05;
export const MASSIF_THRESHOLD_HIGH = 0.45;
export const MASSIF_ELEVATION = 18;

// Hřebeny (ridged noise) jen uvnitř masivů. Dvě frekvence smíchané dohromady rozbijí
// izolované ostré "jehly", které by dělala jediná oktáva - stejný trik jako
// MOUNTAIN_RIDGE_FREQ_1/2 v terrain-generator.ts.
export const RIDGE_FREQ_1 = 3.1;
export const RIDGE_FREQ_2 = 6.7;
export const RIDGE_EXPONENT = 1.6;
export const RIDGE_AMPLITUDE = 8;

// Horní hranice výšky nad PLANET_RADIUS - pro normalizaci barev do 0..1.
export const MAX_ELEVATION =
  RELIEF_BASE_AMPLITUDE + RELIEF_DETAIL_AMPLITUDE + MASSIF_ELEVATION + RIDGE_AMPLITUDE;

// --- Biomy ---
// Prahy na masivové masce. Biom se určuje primárně z ní (ne z absolutní výšky), aby biomy
// tvořily spojité oblasti, a ne šum dlaždice po dlaždici.
export const BIOME_HIGHLANDS_MASSIF = 0.18;
export const BIOME_MOUNTAINS_MASSIF = 0.58;
// Izolovaný vysoký hřeben se počítá jako hory i mimo masivovou oblast.
export const BIOME_MOUNTAINS_ELEVATION = 0.72;

// Barvy: dva odstíny trávy, mezi kterými se plocha přelévá noisem (aby nebyla jednolitá),
// pak skála a sníh podle výšky. Obdoba GROUND_*_COLOR v terrain-generator.ts.
export const COLOR_MEADOW = 0x4a7c3f;
export const COLOR_MEADOW_ALT = 0x5b852e;
export const COLOR_HIGHLANDS = 0x5f7042;
export const COLOR_ROCK = 0x6b6152;
export const COLOR_SNOW = 0xdcdce4;
export const COLOR_PENTAGON_DEBUG = 0xcc4444;

// Barevný patch noise - vyšší frekvence než tvar terénu, jinak by skvrny kopírovaly relief
// a působily jako jeho "duch" místo nezávislé variace.
export const COLOR_PATCH_FREQ = 6;
export const SNOW_START_ELEVATION = 0.62;
export const SNOW_FULL_ELEVATION = 0.85;

// --- Vegetace ---
// Instancí ground-coveru na m² povrchu. Plochý svět má hustoty jako absolutní počty na biom
// (biome.config.ts: groundCoverDensity 70000), což na kouli nejde použít - plocha je jiná.
// Přepočet z plochého světa vychází ~2/m², tady je záměrně méně: celkem to dělá ~185 tisíc
// instancí, z nichž je při dohledu 70 m vidět jen ~5 % povrchu. Klidně doladit podle oka.
export const GROUND_COVER_PER_SQUARE_METER = 1;

// Dohled vegetace s hysterezí (skrýt dál / zobrazit blíž), aby chunky na hranici neblikaly.
// Stejné hodnoty jako vegetace v plochém světě.
export const VEGETATION_HIDE_DISTANCE = 70;
export const VEGETATION_SHOW_DISTANCE = 55;
// Jak často se přepočítává viditelnost chunků - ne každý frame, stačí několikrát za sekundu.
export const VISIBILITY_SWEEP_INTERVAL = 0.2;

export const GRAVITY = 20;
export const MOVE_SPEED = 6;
export const JUMP_SPEED = 7;

// Kapsle hráče. Rapier `capsule(halfHeight, radius)` bere poloviční výšku *válcové části*,
// celková výška kapsle je tedy 2*(halfHeight+radius).
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.6;
export const PLAYER_CAPSULE_RADIUS = 0.35;
// Kamera nad středem kapsle - střed je v polovině výšky, oči těsně pod jejím vrcholem.
export const EYE_OFFSET = 0.6;
// Vzdálenost od středu kapsle k chodidlům. Odvozená hodnota, ale patří sem jako jediný
// zdroj pravdy - potřebuje ji kontrolér (přisazení k povrchu) i scéna (spawn).
export const FEET_OFFSET = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
// Spawn o kousek nad povrchem, ať hráč dosedne gravitací a je hned vidět, že funguje.
export const SPAWN_CLEARANCE = 3;

// Rapier character controller: `offset` je mezera, kterou si drží od okolí (musí být > 0),
// autostep dovolí vyjít malý schod, snap-to-ground drží hráče přilepeného při chůzi z kopce.
export const CHARACTER_OFFSET = 0.02;
export const AUTOSTEP_MAX_HEIGHT = 0.5;
export const AUTOSTEP_MIN_WIDTH = 0.2;
export const SNAP_TO_GROUND_DISTANCE = 0.5;
export const MAX_SLOPE_CLIMB_ANGLE = (55 * Math.PI) / 180;
export const MIN_SLOPE_SLIDE_ANGLE = (35 * Math.PI) / 180;

// Startovní směr na kouli (normalizuje se) - "severní pól" planetky.
export const SPAWN_DIRECTION = new THREE.Vector3(0, 1, 0);

// Hvězdné pozadí - planetka s běžnou oblohou by vypadala špatně.
export const STAR_COUNT = 3000;
export const STAR_FIELD_RADIUS = 1500;

// Kamera musí dohlédnout přes planetu (průměr 300) až na hvězdy.
export const CAMERA_FAR = 4000;

// Testovací dynamická tělesa - důkaz, že radiální gravitace funguje i pro ne-hráčská tělesa.
export const TEST_BODY_COUNT = 6;
export const TEST_BODY_HALF_EXTENT = 0.5;
export const TEST_BODY_DROP_HEIGHT = 12;
