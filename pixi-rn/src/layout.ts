// Importing @pixi/layout registers its renderer extension. Its LayoutSystem
// loads Yoga during renderer.init(), which is why the app imports this module
// before creating the renderer. This module provides a small explicit API so
// consumers do not need to know that implementation detail.
import '@pixi/layout';

/** Side-effect marker for consumers that need to guarantee layout registration. */
export const pixiLayoutReady = true;