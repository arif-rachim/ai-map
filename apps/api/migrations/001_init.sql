CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_id uuid NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rectangle','polygon','circle','line','point','text','milsymbol')),
  geom geometry(Geometry, 4326) NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  style jsonb NOT NULL DEFAULT '{}'::jsonb,
  radius_m double precision,
  center geometry(Point, 4326),
  sidc text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX features_layer_idx ON features(layer_id);
CREATE INDEX features_geom_idx ON features USING gist(geom);

CREATE TABLE airports (
  ident text PRIMARY KEY,
  iata text,
  icao text,
  name text NOT NULL,
  type text NOT NULL,
  country text NOT NULL,
  municipality text,
  geom geometry(Point, 4326) NOT NULL
);
CREATE INDEX airports_iata_idx ON airports(iata);
CREATE INDEX airports_icao_idx ON airports(icao);
CREATE INDEX airports_name_trgm ON airports USING gin(name gin_trgm_ops);
CREATE INDEX airports_muni_trgm ON airports USING gin(municipality gin_trgm_ops);

INSERT INTO layers(name, sort_order) VALUES ('Default', 0);
