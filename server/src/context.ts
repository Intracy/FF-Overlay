import type { DB } from './db.js';
import type { Hub } from './ws/hub.js';
import type { Pipeline } from './events/pipeline.js';
import type { ConnectorManager } from './connectors/manager.js';
import type { WidgetService } from './widgets/service.js';

export interface AppContext {
  db: DB;
  hub: Hub;
  pipeline: Pipeline;
  connectors: ConnectorManager;
  widgets: WidgetService;
}
