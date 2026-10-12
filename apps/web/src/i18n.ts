import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = {
  appName: 'AI Map',
  common: { cancel: 'Cancel', delete: 'Delete', close: 'Close' },
  options: { title: 'Map display', appearance: 'Display', units: 'Units' },
  search: { placeholder: 'Search place, address, airport (DXB / OMDB) or coordinates', coordinates: 'Coordinates', airports: 'Airports', places: 'Places', none: 'No results', geocoderOff: 'Address search unavailable', pin: 'Save as Pin', removePin: 'Remove', clear: 'Clear search' },
  tools: { toolbar: 'Map tools', draw: 'Draw', measure: 'Measure', rectangle: 'Rectangle', polygon: 'Polygon', circle: 'Circle', line: 'Line', point: 'Pin', text: 'Text', milsymbol: 'Military symbol', distance: 'Distance', area: 'Area', rings: 'Range rings', cancel: 'Cancel (Esc)' },
  settings: { unit: 'Distance', coords: 'Coordinates', theme: 'Appearance', auto: 'Automatic', light: 'Light', dark: 'Dark' },
  layers: { title: 'Layers', add: 'New layer', newName: 'New layer', rename: 'Rename', delete: 'Delete layer', confirmDeleteTitle: 'Delete “{{name}}”?', confirmDelete: 'Its {{count}} objects will be deleted for everyone.', active: 'Make active layer (new drawings go here)', activeBadge: 'Active layer', hide: 'Show / hide', empty: 'No objects', actions: 'Layer actions', expand: 'Expand', collapse: 'Collapse', showPanel: 'Show layers', hidePanel: 'Hide layers' },
  feature: { title: 'Object', symbol: 'Symbol', style: 'Style', info: 'Details', name: 'Name', description: 'Description', layer: 'Layer', stroke: 'Line color', strokeWidth: 'Line width', strokeOpacity: 'Line opacity', dashed: 'Dashed', fill: 'Fill color', fillOpacity: 'Fill opacity', textColor: 'Text color', textSize: 'Text size', iconSize: 'Symbol size', editShape: 'Edit Shape', finishEdit: 'Done', cancelEdit: 'Cancel', delete: 'Delete', confirmDelete: 'Delete this object?', zoom: 'Zoom To', length: 'Length', area: 'Area', perimeter: 'Perimeter', radius: 'Radius', center: 'Center', position: 'Position', conflict: 'This object was changed by another user. Latest version loaded.', untitled: 'Untitled' },
  kinds: { rectangle: 'Rectangle', polygon: 'Polygon', circle: 'Circle', line: 'Line', point: 'Pin', text: 'Text', milsymbol: 'Symbol' },
  measure: { title: 'Measurement', hintDistance: 'Click to add points, double-click to finish.', hintArea: 'Click to add vertices, click first point to close.', hintRings: 'Click the map to place the ring center.', total: 'Total', segment: 'Segment', bearing: 'Bearing', radii: 'Radii', radiiHint: 'Separate values with commas.', segments: '{{count}} segments', clear: 'Clear', save: 'Save as Drawing', perimeter: 'Perimeter', area: 'Area' },
  mil: { identity: 'Identity', set: 'Symbol set', entity: 'Entity', echelon: 'Echelon', status: 'Status', present: 'Present', planned: 'Planned', hq: 'Headquarters', sidc: 'SIDC (2525D/E)', invalid: 'Invalid SIDC', friend: 'Friend', hostile: 'Hostile', neutral: 'Neutral', unknown: 'Unknown', suspect: 'Suspect', assumedFriend: 'Assumed friend', landUnit: 'Land unit', landEquipment: 'Land equipment', landInstallation: 'Land installation', air: 'Air', seaSurface: 'Sea surface', seaSubsurface: 'Sea subsurface', hint: 'Click the map to place the symbol.' },
  status: { online: 'Live', offline: 'Reconnecting…', zoom: 'Zoom', noTiles: 'Map tiles not installed', elevation: 'Elevation under cursor' },
  terrain: { group: 'Terrain', hillshade: 'Hillshade', contours: 'Contour lines', terrain3d: '3D terrain', tiltHint: 'Tilt the map with right-drag or Ctrl+drag.' },
  profile: { title: 'Elevation profile', loading: 'Loading elevation…', noData: 'No elevation data along this line', min: 'Lowest', max: 'Highest', ascent: 'Total ascent', descent: 'Total descent', table: 'Show data table', distance: 'Distance', elevation: 'Elevation' },
};

export function initI18n() {
  return i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    interpolation: { escapeValue: false },
  });
}

export default i18n;
