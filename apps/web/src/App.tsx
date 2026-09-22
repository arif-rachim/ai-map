import { useEffect } from 'react';
import { PanelLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from './lib/api';
import { connectRealtime } from './lib/ws';
import { embed, useStore } from './store';
import { startEmbedBridge } from './lib/embedBridge';
import { featureBounds } from './lib/featureGeo';
import { whenMapReady } from './mapRef';
import { FeaturePanel } from './components/FeaturePanel';
import { LayerPanel } from './components/LayerPanel';
import { MapView } from './components/MapView';
import { MeasurePanel } from './components/MeasurePanel';
import { SearchBox } from './components/SearchBox';
import { StatusBar } from './components/StatusBar';
import { SymbolPicker } from './components/SymbolPicker';
import { Toolbar } from './components/Toolbar';
import { useLayout } from './components/useLayout';
import { AlertDialog, IconButton, Section } from './components/ui';

let initialSelectDone = false;

async function resync() {
  const [layers, features] = await Promise.all([api.layers(), api.features()]);
  useStore.getState().loadAll(layers, features);
  // /embed?select=<featureId>: select and zoom once on first load.
  const id = embed.params.select;
  if (id && !initialSelectDone) {
    initialSelectDone = true;
    const f = useStore.getState().features[id];
    if (f) {
      useStore.getState().select(id);
      whenMapReady((map) => map.fitBounds(featureBounds(f), { padding: 80, maxZoom: 15, duration: 0 }));
    }
  }
}

export function App() {
  const { t } = useTranslation();
  const theme = useStore((s) => s.resolvedTheme);
  const tool = useStore((s) => s.tool);
  const milSidc = useStore((s) => s.milSidc);
  const notice = useStore((s) => s.notice);
  const layout = useLayout();

  useEffect(() => {
    const s = useStore.getState();
    const stopBridge = embed.enabled ? startEmbedBridge() : () => {};
    api.capabilities().then(s.setCapabilities, () => s.setCapabilities({ region: false, world: false, terrain: false, terrainMaxzoom: null, terrainBounds: null, geocoder: false }));
    const stopRealtime = connectRealtime(
      (m) => useStore.getState().applyServerMessage(m),
      (online) => {
        useStore.getState().setOnline(online);
        // Load (or reload after reconnect) the shared drawings.
        if (online) resync().catch((err: Error) => useStore.getState().notify(err.message));
      },
    );
    return () => {
      stopRealtime();
      stopBridge();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useStore.getState().notify(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const showSidebar = layout.layers && sidebarOpen;
  const inspectorOpen = tool.type === 'measure' || (tool.type === 'draw' && tool.kind === 'milsymbol') || (tool.type === 'none' && layout.featurePanel);

  return (
    <div className={`app ${embed.enabled ? 'embedded' : ''} ${layout.status ? 'has-status' : ''}`} data-theme={theme}>
      <MapView />
      <div className="overlay">
        {(layout.search || layout.layers) && (
          <div className="top-leading">
            {layout.layers && (
              <div className="tool-group glass">
                <IconButton icon={PanelLeft} label={t(sidebarOpen ? 'layers.hidePanel' : 'layers.showPanel')} pressed={sidebarOpen} onClick={() => useStore.getState().setSidebarOpen(!sidebarOpen)} className={`sidebar-toggle ${sidebarOpen ? 'selected' : ''}`} />
              </div>
            )}
            {layout.search && <SearchBox />}
          </div>
        )}
        {showSidebar && (
          <aside className="sidebar-float sidebar" aria-label={t('layers.title')}>
            <LayerPanel />
          </aside>
        )}
        <div className="top-trailing">
          <Toolbar />
          {inspectorOpen && (
            <>
              <MeasurePanel />
              {tool.type === 'draw' && tool.kind === 'milsymbol' && (
                <div className="panel glass inspector">
                  <div className="panel-header">
                    <h2>
                      {t('tools.milsymbol')}
                      <span className="subtitle">{t('mil.hint')}</span>
                    </h2>
                    <button type="button" className="close-button" onClick={() => useStore.getState().setTool({ type: 'none' })} aria-label={t('tools.cancel')}>
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  </div>
                  <div className="panel-body">
                    <Section>
                      <SymbolPicker sidc={milSidc} onChange={(sidc) => useStore.getState().setMilSidc(sidc)} />
                    </Section>
                  </div>
                </div>
              )}
              {tool.type === 'none' && layout.featurePanel && <FeaturePanel />}
            </>
          )}
        </div>
        {layout.status && (
          <div className="bottom-leading">
            <StatusBar />
          </div>
        )}
        {notice && layout.notices && (
          <div className="toast-region">
            <div className="toast glass" role="status" onClick={() => useStore.getState().notify(null)}>
              {notice}
            </div>
          </div>
        )}
      </div>
      <AlertDialog />
    </div>
  );
}
