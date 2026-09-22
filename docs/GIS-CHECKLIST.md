# GIS software acceptance checklist (manual)

Automated tests validate these services with GDAL (the library QGIS uses): OGC API - Features collections, items, paging,
export to GeoPackage, and Mapbox Vector Tiles. Desktop GIS applications still need a manual check on the office network.
Replace `http://maps.local` with the server address. Record the software name and version for each run.

## QGIS (3.28 or newer)

| # | Step | Expected |
|---|---|---|
| 1 | *Layer → Add Layer → Add WFS / OGC API - Features Layer* → New connection, URL `http://maps.local/api/v1/ogc`, version *OGC API - Features* → Connect | Every drawing layer is listed by name |
| 2 | Add a layer that has pins, lines and polygons | Features appear in the right places; attribute table shows `name`, `kind`, `description` |
| 3 | Zoom to a small area, refresh | Only features in the view are requested (bbox) |
| 4 | *Layer → Add Layer → Vector Tile Layer* → New generic connection: URL `http://maps.local/api/v1/tiles/region/{z}/{x}/{y}.mvt`, max zoom 15, style URL `http://maps.local/api/v1/styles/light.json` | Basemap with roads, water, labels over the region |
| 5 | Same with `.../tiles/world/{z}/{x}/{y}.mvt`, max zoom 7 | World overview |
| 6 | *XYZ Tiles* → New connection `http://maps.local/api/v1/tiles/terrain/{z}/{x}/{y}.webp`, max zoom 12, interpretation *Terrarium terrain RGB* (if offered) | Elevation raster; if WebP is unsupported by the build, note it and use `GET /api/v1/elevation` instead |
| 7 | Browser → download `http://maps.local/api/v1/layers/<id>/export.kml` and `export.geojson`, drag into QGIS | Same features as step 2 |
| 8 | Create a GeoJSON in QGIS, POST it to `/api/v1/layers/<id>/import` (e.g. with curl) | Features appear live in the web map |

## ArcGIS Pro (3.x)

| # | Step | Expected |
|---|---|---|
| 1 | *Insert → Connections → Server → New OGC API Server*, URL `http://maps.local/api/v1/ogc` | Collections listed |
| 2 | Add a collection to a map | Features and attributes shown |
| 3 | *Add Data → Data From Path* `http://maps.local/api/v1/layers/<id>/export.geojson` | Features shown |
| 4 | Vector tile basemap | ArcGIS Pro expects Esri vector tile services; this is **not expected to work**. If a basemap is required in ArcGIS, request the optional WMTS raster service. |

## Google Earth Pro

| # | Step | Expected |
|---|---|---|
| 1 | *File → Open* a downloaded `export.kml` | Placemarks, lines and polygons with names and colours |
