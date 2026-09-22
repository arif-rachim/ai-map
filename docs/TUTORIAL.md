# Tutorial: memakai AI Map di aplikasi lain

Tutorial ini untuk dua jenis pengguna:

- **Bagian A — Pengguna iframe (tanpa coding):** menampilkan peta di halaman web lain cukup dengan satu tag `<iframe>` dan parameter URL.
- **Bagian B — Developer JavaScript:** mengendalikan peta dari kode (marker kendaraan, menyimpan objek, mendengarkan klik), atau membangun peta MapLibre sendiri.

Versi interaktif (dengan pembuat URL dan demo yang bisa dicoba langsung) tersedia di server peta: **`http://<server>/sdk/examples/tutorial.html`**.
Semua contoh di bawah memakai `http://maps.local`; ganti dengan alamat server Anda. Semua berjalan tanpa internet.

## Memilih cara

| Kebutuhan | Cara | Butuh coding? |
|---|---|---|
| Menampilkan peta (dengan atau tanpa tool) di dashboard/portal | A. iframe + parameter URL | Tidak |
| Menampilkan peta **dan** mengendalikannya (marker, fokus lokasi, event klik) | B1. iframe + SDK `AiMapEmbed` | Sedikit JavaScript |
| Peta milik aplikasi sendiri dengan basemap dan gambar yang sama | B2. MapLibre + SDK `addDrawings` | JavaScript |
| Sistem backend (Java/.NET/Python/Node) membaca/menulis data | B3. REST API / `AiMapClient` | Ya |

---

## Bagian A — Pengguna iframe

### A1. Iframe dasar

```html
<iframe src="http://maps.local/embed" style="width:100%; height:600px; border:0" title="Peta"></iframe>
```

Ini menampilkan peta lengkap dengan semua tool, sama seperti aplikasi utama.

### A2. Posisi awal peta

| Parameter | Arti | Contoh |
|---|---|---|
| `center` | Titik tengah `bujur,lintang` | `center=46.6753,24.7136` (Riyadh) |
| `zoom` | 0 (dunia) – 19 (gedung) | `zoom=11` |
| `bearing` | Rotasi (derajat) | `bearing=30` |
| `pitch` | Kemiringan 0–60 (3D) | `pitch=45` |

```html
<iframe src="http://maps.local/embed?center=55.2708,25.2048&zoom=12" ...></iframe>
```

> Perhatikan urutan: **bujur dulu, lalu lintang** (`center=55.27,25.20` untuk Dubai).

### A3. Tampilan

| Parameter | Nilai |
|---|---|
| `theme` | `auto` (ikut sistem), `light`, `dark` |
| `lang` | Bahasa label peta: `en`, `ar` |
| `ui` | Bahasa tombol/menu: `en`, `ar` (Arab otomatis kanan-ke-kiri) |
| `unit` | Satuan jarak: `km`, `nm`, `mi` |
| `coords` | Format koordinat: `dd`, `dms`, `mgrs`, `utm` |
| `hillshade`, `contours`, `terrain3d` | `1` atau `0` |

### A4. Memilih komponen yang tampil (`controls`)

Tanpa parameter `controls`, semua komponen tampil. Dengan `controls`, **hanya yang disebut** yang tampil.

| Nama grup | Isi (bisa disebut satu per satu) |
|---|---|
| `search` | Kotak pencarian |
| `draw` | `draw.point`, `draw.line`, `draw.rectangle`, `draw.polygon`, `draw.circle`, `draw.text`, `draw.milsymbol` |
| `measure` | `measure.distance`, `measure.area`, `measure.rings` |
| `terrain` | `terrain.hillshade`, `terrain.contours`, `terrain.3d` |
| `settings` | `settings.unit`, `settings.coords`, `settings.theme`, `settings.labels`, `settings.ui` |
| `layers` | Panel daftar layer |
| `status` | Pil status (koordinat kursor, elevasi, zoom) |
| `zoom`, `compass`, `scale` | Tombol zoom, kompas, skala |
| `featurePanel` | Panel detail objek saat diklik |
| `select` | Objek bisa dipilih dengan klik |
| `notices` | Pesan notifikasi |

Aturan penulisan:

- `controls=none` → **peta murni**, tanpa komponen apa pun.
- `controls=search,zoom,layers` → hanya itu.
- `controls=draw.point,draw.polygon,measure.distance` → tombol tertentu saja.
- `controls=-draw,-status` → semua **kecuali** yang diberi tanda minus.
- `controls=draw,-draw.milsymbol` → semua tool gambar kecuali simbol militer.

### A5. Baca saja dan mengunci peta

| Parameter | Arti |
|---|---|
| `readonly=1` | Pengguna tidak bisa membuat/mengubah/menghapus gambar (lihat saja) |
| `interactive=0` | Peta tidak bisa digeser/zoom oleh pengguna (cocok untuk layar TV) |
| `minZoom`, `maxZoom` | Batas zoom |
| `maxBounds` | Batas area `barat,selatan,timur,utara`, mis. `maxBounds=34,12,60,32` |

### A6. Fokus ke layer atau objek

| Parameter | Arti |
|---|---|
| `layers=<id>,<id>` | Hanya layer ini yang terlihat (ID layer: lihat `http://maps.local/api/v1/layers`) |
| `select=<id objek>` | Buka dan zoom ke objek tertentu |

### A7. Resep siap pakai

**Peta murni untuk dashboard** (hanya peta, tanpa tombol):
```
http://maps.local/embed?controls=none&center=46.67,24.71&zoom=10
```

**Peta monitoring baca saja** (cari lokasi, lihat layer, tidak bisa mengedit):
```
http://maps.local/embed?controls=search,layers,zoom,status,featurePanel,select&readonly=1
```

**Layar TV / kios** (terkunci, gelap, relief 3D):
```
http://maps.local/embed?controls=none&interactive=0&theme=dark&terrain3d=1&pitch=50&center=42.5,18.2&zoom=10
```

**Peta kerja untuk tim lapangan** (tanpa simbol militer dan tanpa pengaturan):
```
http://maps.local/embed?controls=-draw.milsymbol,-settings&unit=km&coords=mgrs
```

**Wilayah terbatas** (hanya GCC, zoom minimal 5):
```
http://maps.local/embed?maxBounds=34,12,60,32&minZoom=5&center=48,24&zoom=5
```

---

## Bagian B — Developer JavaScript

### B0. Memuat SDK (offline, dari server peta)

Sebagai script biasa (variabel global `AiMap`):
```html
<script src="http://maps.local/sdk/aimap-sdk.js"></script>
```
Sebagai ES module:
```js
import { AiMapEmbed, AiMapClient, addDrawings } from 'http://maps.local/sdk/aimap-sdk.mjs';
```
Tipe TypeScript: `http://maps.local/sdk/aimap-sdk.d.ts`.

### B1. Peta embed yang dikendalikan dari kode

```html
<div id="peta" style="height:600px"></div>
<script src="http://maps.local/sdk/aimap-sdk.js"></script>
<script>
  const map = AiMap.AiMapEmbed.create('#peta', {
    baseUrl: 'http://maps.local',
    center: [46.6753, 24.7136],
    zoom: 11,
    controls: ['search', 'zoom', 'layers'],
    readonly: true,
  });

  map.ready.then(() => console.log('peta siap'));
  map.on('click', (e) => console.log('klik di', e.lat, e.lon));
</script>
```

Semua parameter Bagian A bisa dipakai sebagai opsi (`theme`, `controls`, `interactive`, `maxBounds`, dst).

#### Perintah (semua mengembalikan Promise)

| Perintah | Contoh |
|---|---|
| Pindah lokasi | `map.setView({ center: [55.27, 25.2], zoom: 12 })` |
| Zoom ke area | `map.fitBounds([46.5, 24.5, 46.9, 24.9])` |
| Posisi sekarang | `const v = await map.getView()` |
| Cari | `const hasil = await map.search('Riyadh')` |
| Marker sementara milik halaman Anda | `map.setMarkers([{ id: 'truk-7', lon: 46.7, lat: 24.7, label: 'Truk 7' }])` |
| Hapus marker | `map.removeMarkers(['truk-7'])` atau `map.removeMarkers()` |
| Simpan objek (dibagikan ke semua user) | `await map.addFeature({ kind: 'point', geometry: {...}, name: 'Pos 1' })` |
| Ubah / hapus objek | `map.updateFeature(id, { name: 'Pos 1B' })`, `map.deleteFeature(id)` |
| Pilih objek | `map.selectFeature(id, true)` |
| Layer | `map.listLayers()`, `map.setLayerVisible(id, false)`, `map.setActiveLayer(id)` |
| Tool | `map.setTool('measure:distance')`, `map.setTool('draw:polygon')`, `map.setTool('none')` |
| Tampilan | `map.setOptions({ theme: 'dark', unit: 'nm', terrain3d: true })` |
| Komponen saat runtime | `map.setControls(['none'])`, `map.setControls(['all', '-draw'], true)` |
| Kunci/batas peta | `map.setInteraction({ interactive: false, maxBounds: [34, 12, 60, 32] })` |

#### Event

| Event | Data |
|---|---|
| `ready` | posisi awal |
| `click` | `lon`, `lat`, `featureId`, `markerId` |
| `moveend` | posisi setelah peta digeser |
| `select` | objek yang dipilih (atau `null`) |
| `featureCreated`, `featureUpdated`, `featureDeleted` | perubahan objek, **termasuk oleh user lain** |
| `measure` | hasil pengukuran (`meters`, `squareMeters`) |

#### Contoh: posisi kendaraan real-time

```js
const map = AiMap.AiMapEmbed.create('#peta', { baseUrl: 'http://maps.local', controls: ['zoom', 'layers'], readonly: true });
await map.ready;

async function refresh() {
  const kendaraan = await fetch('/api/kendaraan').then((r) => r.json()); // sistem Anda sendiri
  await map.setMarkers(
    kendaraan.map((k) => ({ id: k.id, lon: k.lon, lat: k.lat, label: k.nama, color: k.aktif ? '#34c759' : '#8e8e93' })),
    true, // replace: hapus marker yang sudah tidak ada
  );
}
setInterval(refresh, 5000);
map.on('click', (e) => e.markerId && console.log('kendaraan diklik:', e.markerId));
```

Marker bisa berupa simbol militer: `{ id: 'hq', lon: 46.7, lat: 24.7, sidc: '10031000001211000000', label: 'HQ' }`.

#### Contoh: menyimpan area dari sistem Anda

```js
const zona = await map.addFeature({
  kind: 'polygon',
  name: 'Zona Operasi A',
  geometry: { type: 'Polygon', coordinates: [[[46.6, 24.6], [46.8, 24.6], [46.8, 24.8], [46.6, 24.8], [46.6, 24.6]]] },
  style: { strokeColor: '#ff3b30', fillColor: '#ff3b30', fillOpacity: 0.15 },
});
await map.selectFeature(zona.id, true);
```

#### Contoh: tombol mode "presentasi"

```js
document.querySelector('#presentasi').onclick = async () => {
  await map.setControls(['none']);
  await map.setInteraction({ interactive: false });
};
document.querySelector('#kerja').onclick = async () => {
  await map.setControls(['all']);
  await map.setInteraction({ interactive: true });
};
```

#### Contoh React

```jsx
import { useEffect, useRef } from 'react';

export function Peta({ center }) {
  const box = useRef(null);
  const map = useRef(null);
  useEffect(() => {
    map.current = window.AiMap.AiMapEmbed.create(box.current, { baseUrl: 'http://maps.local', center, zoom: 10 });
    return () => map.current.destroy();
  }, []);
  useEffect(() => void map.current?.ready.then(() => map.current.setView({ center })), [center]);
  return <div ref={box} style={{ height: 500 }} />;
}
```

### B2. Peta MapLibre milik sendiri

Pakai ini bila aplikasi Anda sudah punya peta sendiri.

```html
<link rel="stylesheet" href="http://maps.local/vendor/maplibre/maplibre-gl.css" />
<div id="peta" style="height:600px"></div>
<script type="module">
  import * as maplibregl from 'http://maps.local/vendor/maplibre/maplibre-gl.mjs';
  import { AiMapClient, addDrawings } from 'http://maps.local/sdk/aimap-sdk.mjs';

  const client = new AiMapClient('http://maps.local');
  const map = new maplibregl.Map({
    container: 'peta',
    style: client.styleUrl({ theme: 'light', lang: 'en', terrain: 'hillshade' }), // terrain: none | hillshade | 3d
    center: [46.67, 24.71],
    zoom: 9,
  });

  map.on('load', async () => {
    // Gambar bersama (pin, area, simbol) ikut tampil dan diperbarui otomatis.
    const gambar = await addDrawings(map, client, { layerIds: undefined });
    map.on('click', gambar.layerIds, (e) => alert(e.features[0].properties.name));
  });

  // Elevasi dan pencarian
  map.on('click', async (e) => console.log('elevasi', await client.elevation(e.lngLat.lng, e.lngLat.lat), 'm'));
  console.log(await client.search('Jeddah'));
</script>
```

### B3. Dari backend (Node.js)

```js
import { AiMapClient } from './aimap-sdk.mjs'; // salin dari http://maps.local/sdk/aimap-sdk.mjs

const client = new AiMapClient('http://maps.local');
const [layer] = await client.layers();
await client.createFeature({ layerId: layer.id, kind: 'point', name: 'Checkpoint 4', geometry: { type: 'Point', coordinates: [46.7, 24.7] } });

client.subscribe((pesan) => console.log(pesan.type), { onOpen: () => console.log('terhubung') });
```

Bahasa lain (Java, .NET, Python): pakai REST API langsung. Dokumentasi lengkap dan pembuat client otomatis: `http://maps.local/api/v1/docs/` dan `http://maps.local/api/v1/openapi.json`. Detail teknis lain: [INTEGRATION.md](INTEGRATION.md).

---

## Masalah umum

| Gejala | Penyebab / solusi |
|---|---|
| Iframe kosong / abu-abu | Buka `http://maps.local/api/v1/health` dari komputer yang sama; periksa `aimapctl status` di server |
| `map.ready` tidak pernah selesai | `baseUrl` harus sama persis dengan alamat di `src` iframe (skema, host, port) |
| Perintah gagal "Map is not ready yet" | Panggil perintah setelah `await map.ready` |
| Perintah gagal "Unknown controls" | Nama komponen salah; lihat tabel A4 |
| `updateFeature` gagal "Version conflict" | Objek diubah user lain; ambil ulang (`listFeatures`) lalu ulangi |
| Halaman HTTPS memuat peta HTTP diblokir | Sajikan peta dan halaman dengan skema yang sama (browser memblokir *mixed content*) |
| Marker hilang setelah reload halaman | Marker dari `setMarkers` sengaja sementara; untuk data permanen pakai `addFeature` |
